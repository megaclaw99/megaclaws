const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');
const db = require('../db');
const { encrypt, decrypt } = require('../crypto');
const { requireAuth } = require('../auth');
const { getETHBalance } = require('../chain');

const router = express.Router();

// POST /api/agents/register
router.post('/register', async (req, res) => {
  try {
    const { name, description = '' } = req.body;

    if (!name || typeof name !== 'string' || name.length < 2 || name.length > 32) {
      return res.status(400).json({ error: 'Validation', message: 'name must be 2-32 characters' });
    }

    const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(name);
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: 'Agent name already exists — choose a different name' });
    }

    // Generate wallet
    const wallet = ethers.Wallet.createRandom();
    const encryptedPk = encrypt(wallet.privateKey);

    // Generate API key
    const apiKey = `megaclaw_${uuidv4().replace(/-/g, '')}`;
    const agentId = uuidv4();

    db.prepare(`
      INSERT INTO agents (id, name, description, api_key, wallet_address, encrypted_pk)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId, name, description, apiKey, wallet.address, encryptedPk);

    res.json({
      success: true,
      agent: {
        id: agentId,
        name,
        description,
        wallet_address: wallet.address,
        created_at: new Date().toISOString(),
      },
      api_key: apiKey,
    });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// GET /api/agents/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { agent } = req;
    const balanceWei = await getETHBalance(agent.wallet_address);

    // Count tokens and trades
    const tokenCount = db.prepare('SELECT COUNT(*) as c FROM tokens WHERE agent_id = ?').get(agent.id).c;
    const tradeCount = db.prepare('SELECT COUNT(*) as c FROM trades WHERE agent_id = ?').get(agent.id).c;

    res.json({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      wallet_address: agent.wallet_address,
      balance_wei: balanceWei.toString(),
      balance_eth: ethers.formatEther(balanceWei),
      stats: {
        tokens_deployed: tokenCount,
        trades_executed: tradeCount,
      },
      created_at: new Date(agent.created_at * 1000).toISOString(),
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// POST /api/agents/me/api-key/rotate
router.post('/me/api-key/rotate', requireAuth, (req, res) => {
  try {
    const newKey = `megaclaw_${uuidv4().replace(/-/g, '')}`;
    db.prepare('UPDATE agents SET api_key = ? WHERE id = ?').run(newKey, req.agent.id);
    res.json({ success: true, api_key: newKey });
  } catch (err) {
    console.error('rotate error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// GET /api/agents/:address — public profile (no auth required)
router.get('/:address', async (req, res) => {
  try {
    const addr = req.params.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const agent = db.prepare(
      'SELECT id, name, description, wallet_address, created_at FROM agents WHERE LOWER(wallet_address) = ?'
    ).get(addr);

    // Trade stats
    const tradeStats = db.prepare(`
      SELECT
        COUNT(*) as total_trades,
        COUNT(CASE WHEN direction='BUY' THEN 1 END) as buy_count,
        COUNT(CASE WHEN direction='SELL' THEN 1 END) as sell_count,
        COALESCE(SUM(CASE WHEN direction='BUY' THEN CAST(amount_in AS REAL) ELSE 0 END), 0) as vol_buy_wei,
        COALESCE(SUM(CASE WHEN direction='SELL' THEN CAST(amount_out AS REAL) ELSE 0 END), 0) as vol_sell_wei
      FROM trades WHERE LOWER(trader_address) = ?
    `).get(addr);

    const since24h = Math.floor(Date.now() / 1000) - 86400;
    const stats24h = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN direction='BUY' THEN CAST(amount_in AS REAL) ELSE 0 END), 0) as vol_24h_wei
      FROM trades WHERE LOWER(trader_address) = ? AND created_at >= ?
    `).get(addr, since24h);

    // Deployed tokens
    const tokenCount = db.prepare(
      'SELECT COUNT(*) as c FROM tokens WHERE LOWER(creator_address) = ?'
    ).get(addr).c;
    const graduatedCount = db.prepare(
      'SELECT COUNT(*) as c FROM tokens WHERE LOWER(creator_address) = ? AND migrated = 1'
    ).get(addr).c;

    const volTotalEth = ((tradeStats.vol_buy_wei + tradeStats.vol_sell_wei) / 1e18).toFixed(6);
    const vol24hEth   = (stats24h.vol_24h_wei / 1e18).toFixed(6);

    res.json({
      address: addr,
      registered: !!agent,
      name:        agent ? agent.name        : null,
      description: agent ? agent.description : null,
      joined:      agent ? new Date(agent.created_at * 1000).toISOString() : null,
      stats: {
        tokens_deployed:   tokenCount,
        tokens_graduated:  graduatedCount,
        total_trades:      tradeStats.total_trades,
        buy_count:         tradeStats.buy_count,
        sell_count:        tradeStats.sell_count,
        vol_total_eth:     volTotalEth,
        vol_24h_eth:       vol24hEth,
      },
    });
  } catch (err) {
    console.error('profile error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

module.exports = router;
