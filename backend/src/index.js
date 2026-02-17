require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const http = require('http');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT || '300'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = req.headers['authorization'] || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    return key || req.ip;
  },
  message: { error: 'Rate limit exceeded', message: 'Too many requests — back off for 60 seconds' },
});
app.use('/api/', limiter);

// ── Routes ────────────────────────────────────────────────────────────────────
const agentsRouter   = require('./routes/agents');
const tokensRouter   = require('./routes/tokens');
const tradesRouter   = require('./routes/trades');
const { router: commentsRouter } = require('./routes/comments');
const homeRouter     = require('./routes/home');
const uploadRouter   = require('./routes/upload');
const transferRouter = require('./routes/transfer');
const healthRouter   = require('./routes/health');
const statsRouter    = require('./routes/stats');
const feedRouter     = require('./routes/feed');

app.use('/api/agents',   agentsRouter);
app.use('/api/tokens',   tokensRouter);
app.use('/api/trades',   tradesRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/home',     homeRouter);
app.use('/api/upload',   uploadRouter);
app.use('/api/transfer', transferRouter);
app.use('/api/health',   healthRouter);
app.use('/api/stats',    statsRouter);
app.use('/api/feed',     feedRouter);
app.get('/api/oracle/eth', require('./routes/health').stack
  ? (req, res) => res.redirect('/api/health/oracle/eth')
  : (req, res, next) => next()
);

// Wire token comments endpoint
tokensRouter.get('/:id/comments', (req, res) => {
  req.params.id = req.params.id;
  // re-use comments logic
  const db = require('./db');
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const { id } = req.params;
  const tokenRow = db.prepare(
    'SELECT id FROM tokens WHERE id = ? OR LOWER(token_address) = LOWER(?)'
  ).get(id, id);
  if (!tokenRow) return res.status(404).json({ error: 'Not found', message: 'Token not found' });
  const comments = db.prepare(`
    SELECT c.*, a.name as agent_name FROM comments c
    LEFT JOIN agents a ON c.agent_id = a.id
    WHERE c.token_id = ?
    ORDER BY c.created_at DESC LIMIT ?
  `).all(tokenRow.id, limit);
  res.json({ comments: comments.map(c => ({
    id: c.id, tokenId: c.token_id, content: c.content,
    author: c.author_address, agentName: c.agent_name,
    parentId: c.parent_id || null,
    created_at: new Date(c.created_at * 1000).toISOString(),
  }))});
});

// ── Root info ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'MegaClaw API',
    version: '1.0.0',
    docs: 'https://megaclaw.io/docs',
    skill: 'https://megaclaw.io/skill.md',
    openapi: 'https://megaclaw.io/openapi.json',
    chain: 'MegaETH Mainnet',
    chainId: 4326,
    factory: process.env.FACTORY_CONTRACT,
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', message: `${req.method} ${req.path} not found` });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000');
const server = http.createServer(app);

// WebSocket — must attach before listen
const { createWss } = require('./ws');
createWss(server);

server.listen(PORT, () => {
  console.log(`MegaClaw API running on port ${PORT}`);
  console.log(`WebSocket available at ws://<host>/ws`);
  console.log(`Chain: MegaETH Mainnet (${process.env.CHAIN_ID})`);
  console.log(`Factory: ${process.env.FACTORY_CONTRACT}`);
  console.log(`RPC: ${process.env.RPC_URL}`);

  // Start blockchain indexer after server is ready
  const { startIndexer } = require('./indexer');
  startIndexer();
});

module.exports = app;
