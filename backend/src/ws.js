/**
 * WebSocket broadcast server
 * Clients connect to ws://host/ws
 * Server pushes JSON messages: { type, data }
 * Types: 'event', 'stats', 'ping'
 */
const { WebSocketServer, OPEN } = require('ws');

let wss = null;

function createWss(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;

    // Send current stats immediately on connect
    const db = require('./db');
    try {
      ws.send(JSON.stringify({ type: 'stats', data: getStats(db) }));
    } catch (_) {}

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (msg) => {
      try {
        const { type } = JSON.parse(msg);
        if (type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch (_) {}
    });
    ws.on('error', () => {});
  });

  // Heartbeat — drop dead connections
  const interval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
  console.log('WebSocket server ready at /ws');
  return wss;
}

function broadcast(type, data) {
  if (!wss) return;
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(ws => {
    if (ws.readyState === OPEN) {
      try { ws.send(msg); } catch (_) {}
    }
  });
}

function getStats(db) {
  const now = Math.floor(Date.now() / 1000);
  const day = now - 86400;
  const week = now - 604800;

  const totalTokens = db.prepare('SELECT COUNT(*) as c FROM tokens').get().c;
  const totalAgents = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
  const totalTrades = db.prepare('SELECT COUNT(*) as c FROM trades').get().c;
  const graduated   = db.prepare('SELECT COUNT(*) as c FROM tokens WHERE migrated = 1').get().c;

  const volAll = db.prepare(`
    SELECT COALESCE(SUM(CAST(amount_in AS REAL)), 0) as v FROM trades WHERE direction = 'BUY'
  `).get().v;

  const vol24h = db.prepare(`
    SELECT COALESCE(SUM(CAST(amount_in AS REAL)), 0) as v FROM trades
    WHERE direction = 'BUY' AND created_at >= ?
  `).get(day).v;

  const trades24h = db.prepare(
    'SELECT COUNT(*) as c FROM trades WHERE created_at >= ?'
  ).get(day).c;

  const tradesHour = db.prepare(
    'SELECT COUNT(*) as c FROM trades WHERE created_at >= ?'
  ).get(now - 3600).c;

  // Top token by 24h volume
  const topToken = db.prepare(`
    SELECT t.symbol, t.name, t.token_address,
           SUM(CAST(tr.amount_in AS REAL)) as vol
    FROM trades tr JOIN tokens t ON LOWER(tr.token_address) = LOWER(t.token_address)
    WHERE tr.created_at >= ? AND tr.direction = 'BUY'
    GROUP BY t.token_address ORDER BY vol DESC LIMIT 1
  `).get(day);

  // Agent fees = 80% of 1% of total ETH buy volume
  const agentFeesEth = volAll * 0.008;
  const agentFees24hEth = vol24h * 0.008;

  return {
    totalTokens,
    totalAgents,
    totalTrades,
    graduated,
    volAllEth: (volAll / 1e18).toFixed(4),
    vol24hEth: (vol24h / 1e18).toFixed(4),
    agentFeesEth: (agentFeesEth / 1e18).toFixed(4),
    agentFees24hEth: (agentFees24hEth / 1e18).toFixed(4),
    trades24h,
    tradesPerMin: (tradesHour / 60).toFixed(2),
    topToken: topToken ? {
      symbol: topToken.symbol,
      name: topToken.name,
      address: topToken.token_address,
      vol24hEth: (topToken.vol / 1e18).toFixed(4),
    } : null,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { createWss, broadcast, getStats };
