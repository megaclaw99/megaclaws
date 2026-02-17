const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');
const db = require('../db');
const { requireAuth } = require('../auth');
const { decrypt } = require('../crypto');
const { getFactory, getBondingCurve, getWallet } = require('../chain');

const router = express.Router();

const EXPLORER = 'https://mega.etherscan.io';

function formatToken(row) {
  return {
    id: row.id,
    tokenAddress: row.token_address,
    name: row.name,
    symbol: row.symbol,
    creator: row.creator_address,
    agentId: row.agent_id,
    txHash: row.tx_hash,
    migrated: !!row.migrated,
    reserveETH: row.reserve_eth,
    reserveToken: row.reserve_token,
    explorerUrl: `${EXPLORER}/token/${row.token_address}`,
    created_at: new Date(row.created_at * 1000).toISOString(),
  };
}

async function syncTokenReserves(tokenAddress, tokenId) {
  try {
    const curve = getBondingCurve(tokenAddress);
    const [reserveETH, reserveToken] = await curve.getReserves();
    const migrated = await curve.migrated();
    db.prepare('UPDATE tokens SET reserve_eth = ?, reserve_token = ?, migrated = ? WHERE id = ?')
      .run(reserveETH.toString(), reserveToken.toString(), migrated ? 1 : 0, tokenId);
    return { reserveETH: reserveETH.toString(), reserveToken: reserveToken.toString(), migrated };
  } catch {
    return null;
  }
}

// POST /api/tokens/deploy
router.post('/deploy', requireAuth, async (req, res) => {
  try {
    const { name, symbol } = req.body;

    if (!name || typeof name !== 'string' || name.length < 1 || name.length > 32) {
      return res.status(400).json({ error: 'Validation', message: 'name must be 1-32 characters' });
    }
    if (!symbol || typeof symbol !== 'string' || symbol.length < 1 || symbol.length > 10) {
      return res.status(400).json({ error: 'Validation', message: 'symbol must be 1-10 characters' });
    }

    const { agent } = req;
    const privateKey = decrypt(agent.encrypted_pk);
    const wallet = getWallet(privateKey);

    // Check balance
    const balance = await wallet.provider.getBalance(wallet.address);
    if (balance === 0n) {
      return res.status(400).json({ error: 'Insufficient balance', message: 'Agent wallet has no ETH. Fund it on MegaETH (Chain ID 4326) first.' });
    }

    const factory = getFactory(wallet);
    const tx = await factory.createToken(name, symbol);
    const receipt = await tx.wait();

    // Parse TokenCreated event
    const factoryInterface = factory.interface;
    let tokenAddress = null;
    for (const log of receipt.logs) {
      try {
        const parsed = factoryInterface.parseLog(log);
        if (parsed && parsed.name === 'TokenCreated') {
          tokenAddress = parsed.args.token;
          break;
        }
      } catch {}
    }

    if (!tokenAddress) {
      return res.status(500).json({ error: 'Deploy failed', message: 'Could not parse TokenCreated event from receipt' });
    }

    const tokenId = uuidv4();
    const TOTAL_SUPPLY = (1_000_000_000n * (10n ** 18n)).toString();

    db.prepare(`
      INSERT INTO tokens (id, token_address, name, symbol, creator_address, agent_id, tx_hash, reserve_eth, reserve_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tokenId, tokenAddress, name, symbol, wallet.address, agent.id, tx.hash, '0', TOTAL_SUPPLY);

    res.json({
      id: tokenId,
      tokenAddress,
      creator: wallet.address,
      name,
      symbol,
      txHash: tx.hash,
      timestamp: Math.floor(Date.now() / 1000),
      explorerUrl: `${EXPLORER}/token/${tokenAddress}`,
      txExplorerUrl: `${EXPLORER}/tx/${tx.hash}`,
    });
  } catch (err) {
    console.error('deploy error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// GET /api/tokens
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = parseInt(req.query.offset) || 0;
    const agentFilter = req.query.agent;
    const creatorFilter = req.query.creator;

    let query = 'SELECT * FROM tokens';
    const params = [];
    const conditions = [];

    if (agentFilter) {
      conditions.push('agent_id = ?');
      params.push(agentFilter);
    }
    if (creatorFilter) {
      conditions.push('creator_address = ?');
      params.push(creatorFilter);
    }

    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as c FROM tokens').get().c;

    res.json({
      tokens: rows.map(formatToken),
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('list tokens error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// GET /api/tokens/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const row = db.prepare(
      'SELECT * FROM tokens WHERE id = ? OR LOWER(token_address) = LOWER(?)'
    ).get(id, id);

    if (!row) return res.status(404).json({ error: 'Not found', message: 'Token not found' });

    // Sync reserves from chain
    await syncTokenReserves(row.token_address, row.id);
    const updated = db.prepare('SELECT * FROM tokens WHERE id = ?').get(row.id);

    res.json(formatToken(updated));
  } catch (err) {
    console.error('get token error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// GET /api/tokens/:id/holders
router.get('/:id/holders', async (req, res) => {
  try {
    const { id } = req.params;
    const row = db.prepare(
      'SELECT * FROM tokens WHERE id = ? OR LOWER(token_address) = LOWER(?)'
    ).get(id, id);

    if (!row) return res.status(404).json({ error: 'Not found', message: 'Token not found' });

    // Get unique holders from trades table
    const buyers = db.prepare(
      "SELECT trader_address, SUM(CASE WHEN direction='BUY' THEN CAST(amount_out AS REAL) ELSE -CAST(amount_in AS REAL) END) as net FROM trades WHERE token_address = ? GROUP BY trader_address HAVING net > 0 ORDER BY net DESC LIMIT 50"
    ).all(row.token_address);

    const total = buyers.length;

    res.json({
      tokenAddress: row.token_address,
      holders: buyers.map((b, i) => ({
        rank: i + 1,
        address: b.trader_address,
        balance: Math.floor(b.net).toString(),
        explorerUrl: `${EXPLORER}/address/${b.trader_address}`,
      })),
      total,
    });
  } catch (err) {
    console.error('holders error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// GET /api/tokens/:id/trades
router.get('/:id/trades', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);

    const row = db.prepare(
      'SELECT * FROM tokens WHERE id = ? OR LOWER(token_address) = LOWER(?)'
    ).get(id, id);

    if (!row) return res.status(404).json({ error: 'Not found', message: 'Token not found' });

    const trades = db.prepare(
      'SELECT t.*, a.name as agent_name FROM trades t LEFT JOIN agents a ON t.agent_id = a.id WHERE t.token_address = ? ORDER BY t.created_at DESC LIMIT ?'
    ).all(row.token_address, limit);

    res.json({
      tokenAddress: row.token_address,
      trades: trades.map(t => ({
        id: t.id,
        direction: t.direction,
        amountIn: t.amount_in,
        amountOut: t.amount_out,
        fee: t.fee,
        trader: t.trader_address,
        agentName: t.agent_name,
        txHash: t.tx_hash,
        txExplorerUrl: t.tx_hash ? `${EXPLORER}/tx/${t.tx_hash}` : null,
        timestamp: new Date(t.created_at * 1000).toISOString(),
      })),
    });
  } catch (err) {
    console.error('trades error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

module.exports = router;

// GET /api/tokens/:address/quote?direction=BUY|SELL&amount=<wei>
// Public — no auth required. Returns estimated output.
router.get('/:address/quote', async (req, res) => {
  try {
    const addr = req.params.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    const direction = (req.query.direction || 'BUY').toUpperCase();
    const amountStr = req.query.amount || '0';
    if (!/^\d+$/.test(amountStr)) {
      return res.status(400).json({ error: 'amount must be a positive integer (wei)' });
    }
    const { estimateBuy, estimateSell, getBondingCurve } = require('../chain');
    const { ethers } = require('ethers');
    const amountBig = BigInt(amountStr);
    let estimated;
    if (direction === 'BUY') {
      estimated = await estimateBuy(addr, amountBig);
    } else {
      estimated = await estimateSell(addr, amountBig);
    }
    const curve = getBondingCurve(addr);
    const [reserveETH, reserveToken] = await curve.getReserves();
    res.json({
      direction,
      amountIn: amountStr,
      estimatedOut: estimated.toString(),
      estimatedOutFormatted: ethers.formatEther(estimated),
      reserveETH: ethers.formatEther(reserveETH),
      reserveToken: ethers.formatEther(reserveToken),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
