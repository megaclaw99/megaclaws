/**
 * Blockchain event indexer for MegaClaw V4 Factory
 * 
 * All events (TokenCreated, TokensPurchased, TokensSold, TokenGraduated) 
 * are on the factory contract itself.
 */
const { ethers } = require('ethers');
const { v4: uuidv4 } = require('uuid');
const { provider, getFactory, FACTORY_ABI } = require('./chain');
const db = require('./db');
const { broadcast, getStats } = require('./ws');

const POLL_INTERVAL = parseInt(process.env.INDEXER_POLL_MS || '8000');
const FACTORY_ADDRESS = (process.env.FACTORY_CONTRACT || '').toLowerCase();

let lastBlock = 0;

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
  setMigrated: db.prepare(
    'UPDATE tokens SET migrated = 1, pool_address = ? WHERE LOWER(token_address) = LOWER(?)'
  ),
  getTokenByAddress: db.prepare(
    'SELECT name, symbol FROM tokens WHERE LOWER(token_address) = LOWER(?)'
  ),
};

// ── Resolve agent_id from trader wallet ───────────────────────────────────────
function resolveAgent(traderAddress) {
  const row = stmts.getAgentByWallet.get(traderAddress);
  return row ? row.id : null; // NULL for external traders (no agent)
}

// ── Handle TokenCreated ────────────────────────────────────────────────────────
async function handleTokenCreated(log, factory) {
  try {
    const parsed = factory.interface.parseLog(log);
    if (!parsed) return;

    const { token, creator, name, symbol, timestamp } = parsed.args;
    const tokenAddr = token.toLowerCase();
    const ts = Number(timestamp || 0) || Math.floor(Date.now() / 1000);

    // Insert into DB
    stmts.upsertToken.run(
      uuidv4(), tokenAddr, name, symbol,
      creator.toLowerCase(), log.transactionHash || null, ts
    );

    // Broadcast deploy event
    broadcast('event', {
      type: 'deploy',
      token: { address: tokenAddr, name, symbol, creator: creator.toLowerCase() },
      ts: new Date(ts * 1000).toISOString(),
      txHash: log.transactionHash,
    });

    broadcast('stats', getStats(db));
    console.log(`[indexer] TokenCreated: ${symbol} (${tokenAddr})`);
  } catch (e) {
    console.error('[indexer] handleTokenCreated error:', e.message);
  }
}

// ── Handle TokensPurchased ─────────────────────────────────────────────────────
async function handleTokensPurchased(log, factory) {
  try {
    const parsed = factory.interface.parseLog(log);
    if (!parsed) return;

    const { token, buyer, ethIn, tokensOut, fee, newReserveETH, newReserveTokens } = parsed.args;
    const tokenAddr = token.toLowerCase();
    const ts = Math.floor(Date.now() / 1000);
    const agentId = resolveAgent(buyer);

    // Insert trade
    stmts.insertTrade.run(
      uuidv4(), tokenAddr, agentId,
      buyer.toLowerCase(), 'BUY',
      ethIn.toString(), tokensOut.toString(),
      fee.toString(),
      log.transactionHash || null, ts
    );

    // Update reserves
    stmts.updateReserves.run(
      newReserveETH.toString(),
      newReserveTokens.toString(),
      0, // not migrated
      tokenAddr
    );

    // Get token info for broadcast
    const tok = stmts.getTokenByAddress.get(tokenAddr);

    broadcast('event', {
      type: 'buy',
      token: {
        address: tokenAddr,
        symbol: tok?.symbol || '???',
        name: tok?.name || 'Unknown',
      },
      trader: buyer.toLowerCase(),
      amountEth: ethers.formatEther(ethIn),
      amountTokens: ethers.formatEther(tokensOut),
      ts: new Date(ts * 1000).toISOString(),
      txHash: log.transactionHash,
    });

    broadcast('stats', getStats(db));
    console.log(`[indexer] Buy: ${ethers.formatEther(ethIn)} ETH -> ${tok?.symbol || tokenAddr}`);
  } catch (e) {
    console.error('[indexer] handleTokensPurchased error:', e.message);
  }
}

// ── Handle TokensSold ──────────────────────────────────────────────────────────
async function handleTokensSold(log, factory) {
  try {
    const parsed = factory.interface.parseLog(log);
    if (!parsed) return;

    const { token, seller, tokensIn, ethOut, newReserveETH, newReserveTokens } = parsed.args;
    const tokenAddr = token.toLowerCase();
    const ts = Math.floor(Date.now() / 1000);
    const agentId = resolveAgent(seller);

    // Insert trade
    stmts.insertTrade.run(
      uuidv4(), tokenAddr, agentId,
      seller.toLowerCase(), 'SELL',
      tokensIn.toString(), ethOut.toString(),
      '0', // no fee on sells
      log.transactionHash || null, ts
    );

    // Update reserves
    stmts.updateReserves.run(
      newReserveETH.toString(),
      newReserveTokens.toString(),
      0,
      tokenAddr
    );

    const tok = stmts.getTokenByAddress.get(tokenAddr);

    broadcast('event', {
      type: 'sell',
      token: {
        address: tokenAddr,
        symbol: tok?.symbol || '???',
        name: tok?.name || 'Unknown',
      },
      trader: seller.toLowerCase(),
      amountEth: ethers.formatEther(ethOut),
      amountTokens: ethers.formatEther(tokensIn),
      ts: new Date(ts * 1000).toISOString(),
      txHash: log.transactionHash,
    });

    broadcast('stats', getStats(db));
    console.log(`[indexer] Sell: ${tok?.symbol || tokenAddr} -> ${ethers.formatEther(ethOut)} ETH`);
  } catch (e) {
    console.error('[indexer] handleTokensSold error:', e.message);
  }
}

// ── Handle TokenGraduated ──────────────────────────────────────────────────────
async function handleTokenGraduated(log, factory) {
  try {
    const parsed = factory.interface.parseLog(log);
    if (!parsed) return;

    const { token, pool, ethLiquidity, tokenLiquidity, positionId } = parsed.args;
    const tokenAddr = token.toLowerCase();

    stmts.setMigrated.run(pool.toLowerCase(), tokenAddr);

    const tok = stmts.getTokenByAddress.get(tokenAddr);

    broadcast('event', {
      type: 'graduate',
      token: {
        address: tokenAddr,
        symbol: tok?.symbol || '???',
        name: tok?.name || 'Unknown',
      },
      pool: pool.toLowerCase(),
      ethLiquidity: ethers.formatEther(ethLiquidity),
      tokenLiquidity: ethers.formatEther(tokenLiquidity),
      ts: new Date().toISOString(),
      txHash: log.transactionHash,
    });

    broadcast('stats', getStats(db));
    console.log(`[indexer] Graduated: ${tok?.symbol || tokenAddr} -> pool ${pool}`);
  } catch (e) {
    console.error('[indexer] handleTokenGraduated error:', e.message);
  }
}

// ── Poll factory for all events ────────────────────────────────────────────────
async function poll() {
  try {
    const factory = getFactory();
    const latest = Number(await provider.getBlockNumber());
    
    if (lastBlock === 0) {
      // On first run, look back ~500 blocks
      lastBlock = Math.max(0, latest - 500);
    }
    
    if (latest <= lastBlock) return;

    const fromBlock = lastBlock + 1;
    const toBlock = Math.min(latest, fromBlock + 999); // max 1000 blocks per call

    // Query all event types
    const [createLogs, buyLogs, sellLogs, gradLogs] = await Promise.all([
      factory.queryFilter(factory.filters.TokenCreated(), fromBlock, toBlock),
      factory.queryFilter(factory.filters.TokensPurchased(), fromBlock, toBlock),
      factory.queryFilter(factory.filters.TokensSold(), fromBlock, toBlock),
      factory.queryFilter(factory.filters.TokenGraduated(), fromBlock, toBlock),
    ]);

    // Process in order: creates first, then trades, then graduations
    for (const log of createLogs) await handleTokenCreated(log, factory);
    for (const log of buyLogs)    await handleTokensPurchased(log, factory);
    for (const log of sellLogs)   await handleTokensSold(log, factory);
    for (const log of gradLogs)   await handleTokenGraduated(log, factory);

    lastBlock = toBlock;
    
    if (createLogs.length || buyLogs.length || sellLogs.length || gradLogs.length) {
      console.log(`[indexer] Block ${fromBlock}-${toBlock}: ${createLogs.length} creates, ${buyLogs.length} buys, ${sellLogs.length} sells, ${gradLogs.length} graduations`);
    }
  } catch (e) {
    console.error('[indexer] poll error:', e.message);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await poll();
  } finally {
    running = false;
  }
}

function startIndexer() {
  if (!process.env.RPC_URL || !process.env.FACTORY_CONTRACT) {
    console.warn('[indexer] RPC_URL or FACTORY_CONTRACT not set — indexer disabled');
    return;
  }
  console.log(`[indexer] Starting — polling every ${POLL_INTERVAL}ms`);
  console.log(`[indexer] Factory: ${process.env.FACTORY_CONTRACT}`);
  tick();
  setInterval(tick, POLL_INTERVAL);
}

module.exports = { startIndexer, getStats };
