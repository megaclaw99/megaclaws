/**
 * Blockchain event indexer
 * Polls MegaETH for TokenCreated + TokensPurchased/TokensSold events
 * Stores into SQLite and broadcasts via WebSocket
 */
const { ethers } = require('ethers');
const { v4: uuidv4 } = require('uuid');
const { provider, getFactory, getBondingCurve, FACTORY_ABI } = require('./chain');
const db = require('./db');
const { broadcast, getStats } = require('./ws');

const POLL_INTERVAL = parseInt(process.env.INDEXER_POLL_MS || '8000');
const FACTORY_ADDRESS = (process.env.FACTORY_CONTRACT || '').toLowerCase();

// Track which token addresses we're watching
const watchedTokens = new Set();
let lastFactoryBlock = 0;
const tokenBlockMap = {}; // tokenAddress → last polled block

// ── DB helpers ─────────────────────────────────────────────────────────────────
const stmts = {
  upsertToken: db.prepare(`
    INSERT OR IGNORE INTO tokens
      (id, token_address, name, symbol, creator_address, agent_id, tx_hash, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `),
  updateReserves: db.prepare(`
    UPDATE tokens SET reserve_eth = ?, reserve_token = ?, migrated = ?
    WHERE LOWER(token_address) = LOWER(?)
  `),
  insertTrade: db.prepare(`
    INSERT OR IGNORE INTO trades
      (id, token_address, agent_id, trader_address, direction, amount_in, amount_out, fee, tx_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getAgentByWallet: db.prepare(
    'SELECT id FROM agents WHERE LOWER(wallet_address) = LOWER(?)'
  ),
  getAllTokenAddresses: db.prepare('SELECT token_address FROM tokens'),
  getLastBlockForToken: db.prepare(
    'SELECT MAX(created_at) as ts FROM trades WHERE LOWER(token_address) = LOWER(?)'
  ),
  setMigrated: db.prepare(
    'UPDATE tokens SET migrated = 1 WHERE LOWER(token_address) = LOWER(?)'
  ),
};

// ── Resolve agent_id from trader wallet ───────────────────────────────────────
function resolveAgent(traderAddress) {
  const row = stmts.getAgentByWallet.get(traderAddress);
  return row ? row.id : 'external';
}

// ── Handle TokenCreated ────────────────────────────────────────────────────────
async function handleTokenCreated(log, factory) {
  try {
    const parsed = factory.interface.parseLog(log);
    if (!parsed) return;

    const { token, creator, name, symbol, timestamp } = parsed.args;
    const tokenAddr = token.toLowerCase();
    const ts = Number(timestamp || 0) || Math.floor(Date.now() / 1000);

    // Insert into DB (ignore if already exists)
    stmts.upsertToken.run(
      uuidv4(), tokenAddr, name, symbol,
      creator.toLowerCase(), log.transactionHash || null, ts
    );

    // Start watching this token
    watchedTokens.add(tokenAddr);

    // Broadcast deploy event
    broadcast('event', {
      type: 'deploy',
      token: { address: tokenAddr, name, symbol, creator: creator.toLowerCase() },
      ts: new Date(ts * 1000).toISOString(),
      txHash: log.transactionHash,
    });

    // Broadcast updated stats
    broadcast('stats', getStats(db));

    console.log(`[indexer] TokenCreated: ${symbol} (${tokenAddr})`);
  } catch (e) {
    console.error('[indexer] handleTokenCreated error:', e.message);
  }
}

// ── Handle TokensPurchased / TokensSold ────────────────────────────────────────
async function handleTrade(log, curve, tokenAddress, direction) {
  try {
    const parsed = curve.interface.parseLog(log);
    if (!parsed) return;

    const ts = Math.floor(Date.now() / 1000);
    let trader, amountIn, amountOut, fee;

    if (direction === 'BUY') {
      ({ buyer: trader, ethIn: amountIn, tokensOut: amountOut, fee } = parsed.args);
    } else {
      ({ seller: trader, tokensIn: amountIn, ethOut: amountOut, fee } = parsed.args);
    }

    const agentId = resolveAgent(trader) || 'external';
    const tradeId = uuidv4();

    stmts.insertTrade.run(
      tradeId, tokenAddress.toLowerCase(), agentId,
      trader.toLowerCase(), direction,
      amountIn.toString(), amountOut.toString(),
      (fee || 0n).toString(),
      log.transactionHash || null, ts
    );

    // Refresh reserves
    try {
      const bc = getBondingCurve(tokenAddress);
      const [rEth, rTok] = await bc.getReserves();
      const migrated = await bc.migrated();
      stmts.updateReserves.run(rEth.toString(), rTok.toString(), migrated ? 1 : 0, tokenAddress);
      if (migrated) stmts.setMigrated.run(tokenAddress);
    } catch (_) {}

    // Look up token info
    const tok = db.prepare(
      'SELECT name, symbol FROM tokens WHERE LOWER(token_address) = LOWER(?)'
    ).get(tokenAddress);

    // Broadcast trade event
    broadcast('event', {
      type: direction === 'BUY' ? 'buy' : 'sell',
      token: {
        address: tokenAddress.toLowerCase(),
        symbol: tok?.symbol || '???',
        name: tok?.name || 'Unknown',
      },
      trader: trader.toLowerCase(),
      amountEth: direction === 'BUY'
        ? ethers.formatEther(amountIn)
        : ethers.formatEther(amountOut),
      ts: new Date(ts * 1000).toISOString(),
      txHash: log.transactionHash,
    });

    broadcast('stats', getStats(db));
  } catch (e) {
    console.error('[indexer] handleTrade error:', e.message);
  }
}

// ── Poll factory for new TokenCreated events ───────────────────────────────────
async function pollFactory() {
  try {
    const factory = getFactory();
    const latest = Number(await provider.getBlockNumber());
    if (lastFactoryBlock === 0) {
      // On first run, look back ~500 blocks (~1 hour at ~7s/block)
      lastFactoryBlock = Math.max(0, latest - 500);
    }
    if (latest <= lastFactoryBlock) return;

    const fromBlock = lastFactoryBlock + 1;
    const toBlock = Math.min(latest, fromBlock + 999); // max 1000 blocks per call

    const filter = factory.filters.TokenCreated();
    const logs = await factory.queryFilter(filter, fromBlock, toBlock);
    for (const log of logs) {
      await handleTokenCreated(log, factory);
    }

    lastFactoryBlock = toBlock;
  } catch (e) {
    console.error('[indexer] pollFactory error:', e.message);
  }
}

// ── Poll each known token for new trades ───────────────────────────────────────
async function pollTokenTrades() {
  if (watchedTokens.size === 0) return;

  try {
    const latest = Number(await provider.getBlockNumber());

    for (const tokenAddress of watchedTokens) {
      try {
        const fromBlock = (tokenBlockMap[tokenAddress] || Math.max(0, latest - 200)) + 1;
        if (fromBlock > latest) continue;
        const toBlock = Math.min(latest, fromBlock + 999);

        const curve = getBondingCurve(tokenAddress);

        const [buyLogs, sellLogs, migrateLogs] = await Promise.all([
          curve.queryFilter(curve.filters.TokensPurchased(), fromBlock, toBlock),
          curve.queryFilter(curve.filters.TokensSold(), fromBlock, toBlock),
          curve.queryFilter(curve.filters.Migrated(), fromBlock, toBlock),
        ]);

        for (const log of buyLogs)   await handleTrade(log, curve, tokenAddress, 'BUY');
        for (const log of sellLogs)  await handleTrade(log, curve, tokenAddress, 'SELL');
        for (const log of migrateLogs) {
          stmts.setMigrated.run(tokenAddress);
          broadcast('event', {
            type: 'migrate',
            token: { address: tokenAddress },
            ts: new Date().toISOString(),
            txHash: log.transactionHash,
          });
        }

        tokenBlockMap[tokenAddress] = toBlock;
      } catch (_) {}
    }
  } catch (e) {
    console.error('[indexer] pollTokenTrades error:', e.message);
  }
}

// ── Bootstrap: load existing tokens from DB ───────────────────────────────────
function loadKnownTokens() {
  const rows = stmts.getAllTokenAddresses.all();
  for (const { token_address } of rows) {
    watchedTokens.add(token_address.toLowerCase());
  }
  console.log(`[indexer] Loaded ${watchedTokens.size} known tokens to watch`);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await pollFactory();
    await pollTokenTrades();
  } finally {
    running = false;
  }
}

function startIndexer() {
  if (!process.env.RPC_URL || !process.env.FACTORY_CONTRACT) {
    console.warn('[indexer] RPC_URL or FACTORY_CONTRACT not set — indexer disabled');
    return;
  }
  loadKnownTokens();
  console.log(`[indexer] Starting — polling every ${POLL_INTERVAL}ms`);
  tick(); // immediate first tick
  setInterval(tick, POLL_INTERVAL);
}

module.exports = { startIndexer, getStats };
