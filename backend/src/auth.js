const db = require('./db');

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing Authorization header' });
  }

  const agent = db.prepare('SELECT * FROM agents WHERE api_key = ?').get(token);
  if (!agent) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
  }

  req.agent = agent;
  next();
}

module.exports = { requireAuth };
