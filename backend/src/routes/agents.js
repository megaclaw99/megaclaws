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

module.exports = router;
