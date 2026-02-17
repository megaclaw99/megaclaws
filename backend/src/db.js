const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'megaclaw.db')
  : path.join(__dirname, '../megaclaw.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    api_key TEXT UNIQUE NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    encrypted_pk TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    token_address TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    creator_address TEXT NOT NULL,
    agent_id TEXT,
    tx_hash TEXT,
    migrated INTEGER NOT NULL DEFAULT 0,
    reserve_eth TEXT NOT NULL DEFAULT '0',
    reserve_token TEXT NOT NULL DEFAULT '0',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    token_address TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    trader_address TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
    amount_in TEXT NOT NULL,
    amount_out TEXT NOT NULL,
    fee TEXT NOT NULL DEFAULT '0',
    tx_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    token_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    author_address TEXT NOT NULL,
    content TEXT NOT NULL,
    parent_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (agent_id) REFERENCES agents(id),
    FOREIGN KEY (parent_id) REFERENCES comments(id)
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_creator ON tokens(creator_address);
  CREATE INDEX IF NOT EXISTS idx_tokens_agent ON tokens(agent_id);
  CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token_address);
  CREATE INDEX IF NOT EXISTS idx_trades_agent ON trades(agent_id);
  CREATE INDEX IF NOT EXISTS idx_comments_token ON comments(token_id);
`);

module.exports = db;
