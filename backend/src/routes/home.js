const express = require('express');
const { ethers } = require('ethers');
const db = require('../db');

const router = express.Router();

// GET /api/home
router.get('/', async (req, res) => {
  try {
    // Trending: most trades in last 24h
    const since = Math.floor(Date.now() / 1000) - 86400;

    const trending = db.prepare(`
      SELECT t.*, COUNT(tr.id) as trade_count
      FROM tokens t
      LEFT JOIN trades tr ON t.token_address = tr.token_address AND tr.created_at >= ?
      GROUP BY t.id
      ORDER BY trade_count DESC, t.created_at DESC
      LIMIT 8
    `).all(since);

    // Recent deploys
    const recent = db.prepare(
      'SELECT * FROM tokens ORDER BY created_at DESC LIMIT 8'
    ).all();

    // Stats
    const totalTokens = db.prepare('SELECT COUNT(*) as c FROM tokens').get().c;
    const totalAgents = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
    const totalTrades = db.prepare('SELECT COUNT(*) as c FROM trades').get().c;
    const vol24h = db.prepare(
      "SELECT SUM(CAST(amount_in AS REAL)) as vol FROM trades WHERE direction='BUY' AND created_at >= ?"
    ).get(since);

    const EXPLORER = 'https://mega.etherscan.io';
    function fmt(row) {
      return {
        id: row.id,
        tokenAddress: row.token_address,
        name: row.name,
        symbol: row.symbol,
        creator: row.creator_address,
        migrated: !!row.migrated,
        reserveETH: row.reserve_eth,
        explorerUrl: `${EXPLORER}/token/${row.token_address}`,
        created_at: new Date(row.created_at * 1000).toISOString(),
        tradeCount: row.trade_count || 0,
      };
    }

    res.json({
      trending: trending.map(fmt),
      recent: recent.map(fmt),
      stats: {
        tokensDeployed: totalTokens,
        activeAgents: totalAgents,
        tradesExecuted: totalTrades,
        volume24hWei: Math.floor(vol24h?.vol || 0).toString(),
        volume24hETH: ethers.formatEther(BigInt(Math.floor(vol24h?.vol || 0))),
      },
    });
  } catch (err) {
    console.error('home error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

module.exports = router;
