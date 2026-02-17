const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/feed?limit=40&before=<unix_ts>&type=all|buy|sell|deploy&address=0x...
// Returns mixed trade + deploy events, newest first
// address param filters to a specific trader/creator
router.get('/', (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit) || 40, 100);
    const before  = parseInt(req.query.before) || Math.floor(Date.now() / 1000) + 1;
    const type    = req.query.type || 'all';
    const address = req.query.address ? req.query.address.toLowerCase() : null;

    const events = [];

    // ── Trades ──────────────────────────────────────────────────────────────
    if (type === 'all' || type === 'buy' || type === 'sell') {
      const dirClause  = type === 'buy'  ? "AND tr.direction = 'BUY'"
                       : type === 'sell' ? "AND tr.direction = 'SELL'"
                       : '';
      const addrClause = address ? "AND LOWER(tr.trader_address) = ?" : '';
      const params     = address ? [before, address, limit] : [before, limit];
      const trades = db.prepare(`
        SELECT
          tr.id, tr.direction, tr.trader_address,
          tr.amount_in, tr.amount_out, tr.fee,
          tr.tx_hash, tr.created_at,
          t.token_address, t.symbol, t.name,
          a.name as agent_name
        FROM trades tr
        LEFT JOIN tokens t ON LOWER(tr.token_address) = LOWER(t.token_address)
        LEFT JOIN agents a ON tr.agent_id = a.id
        WHERE tr.created_at < ? ${dirClause} ${addrClause}
        ORDER BY tr.created_at DESC LIMIT ?
      `).all(...params);

      for (const t of trades) {
        const isETHIn = t.direction === 'BUY';
        events.push({
          id: t.id,
          type: t.direction === 'BUY' ? 'buy' : 'sell',
          token: {
            address: t.token_address,
            symbol: t.symbol || '???',
            name: t.name || 'Unknown',
          },
          trader: t.trader_address,
          agentName: t.agent_name || null,
          amountEth: isETHIn
            ? (parseFloat(t.amount_in) / 1e18).toFixed(6)
            : (parseFloat(t.amount_out) / 1e18).toFixed(6),
          amountToken: isETHIn
            ? (parseFloat(t.amount_out) / 1e18).toFixed(2)
            : (parseFloat(t.amount_in) / 1e18).toFixed(2),
          txHash: t.tx_hash || null,
          ts: new Date(t.created_at * 1000).toISOString(),
          created_at: t.created_at,
        });
      }
    }

    // ── Deploys ──────────────────────────────────────────────────────────────
    if (type === 'all' || type === 'deploy') {
      const addrClause2 = address ? "AND LOWER(t.creator_address) = ?" : '';
      const params2     = address ? [before, address, Math.floor(limit / 4)] : [before, Math.floor(limit / 4)];
      const deploys = db.prepare(`
        SELECT
          t.id, t.token_address, t.name, t.symbol,
          t.creator_address, t.tx_hash, t.created_at, t.migrated,
          a.name as agent_name
        FROM tokens t
        LEFT JOIN agents a ON LOWER(t.creator_address) = LOWER(a.wallet_address)
        WHERE t.created_at < ? ${addrClause2}
        ORDER BY t.created_at DESC LIMIT ?
      `).all(...params2);

      for (const d of deploys) {
        events.push({
          id: d.id,
          type: 'deploy',
          token: {
            address: d.token_address,
            symbol: d.symbol,
            name: d.name,
          },
          trader: d.creator_address,
          agentName: d.agent_name || null,
          migrated: !!d.migrated,
          txHash: d.tx_hash || null,
          ts: new Date(d.created_at * 1000).toISOString(),
          created_at: d.created_at,
        });
      }
    }

    // Sort by created_at desc, trim to limit
    events.sort((a, b) => b.created_at - a.created_at);
    const page = events.slice(0, limit);
    const oldest = page.length ? page[page.length - 1].created_at : null;

    res.json({
      events: page,
      nextBefore: oldest,
      count: page.length,
    });
  } catch (e) {
    console.error('[feed]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/feed/tokens — top tokens by 24h volume; optional ?creator=0x...
router.get('/tokens', (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.limit) || 20, 50);
    const since   = Math.floor(Date.now() / 1000) - 86400;
    const creator = req.query.creator ? req.query.creator.toLowerCase() : null;

    const creatorClause = creator ? 'AND LOWER(t.creator_address) = ?' : '';
    const params = creator ? [since, creator, limit] : [since, limit];

    const tokens = db.prepare(`
      SELECT
        t.token_address, t.name, t.symbol,
        t.reserve_eth, t.migrated, t.created_at,
        t.creator_address,
        COUNT(tr.id) as trade_count,
        COALESCE(SUM(CASE WHEN tr.direction='BUY' THEN CAST(tr.amount_in AS REAL) ELSE 0 END), 0) as vol_24h
      FROM tokens t
      LEFT JOIN trades tr ON LOWER(t.token_address) = LOWER(tr.token_address)
        AND tr.created_at >= ?
      WHERE 1=1 ${creatorClause}
      GROUP BY t.token_address
      ORDER BY vol_24h DESC, t.created_at DESC
      LIMIT ?
    `).all(...params);

    res.json({
      tokens: tokens.map(t => ({
        address: t.token_address,
        name: t.name,
        symbol: t.symbol,
        creatorAddress: t.creator_address,
        reserveEth: (parseFloat(t.reserve_eth || '0') / 1e18).toFixed(6),
        migrated: !!t.migrated,
        tradeCount: t.trade_count,
        vol24hEth: (t.vol_24h / 1e18).toFixed(6),
        createdAt: new Date(t.created_at * 1000).toISOString(),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
