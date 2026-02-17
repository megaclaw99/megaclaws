const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// POST /api/comments
router.post('/', requireAuth, (req, res) => {
  try {
    const { tokenId, content, parentId = null } = req.body;

    if (!tokenId) {
      return res.status(400).json({ error: 'Validation', message: 'tokenId is required' });
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Validation', message: 'content is required' });
    }
    if (content.length > 500) {
      return res.status(400).json({ error: 'Validation', message: 'content must be <= 500 characters' });
    }

    // Resolve tokenId (can be UUID or contract address)
    const tokenRow = db.prepare(
      'SELECT id FROM tokens WHERE id = ? OR LOWER(token_address) = LOWER(?)'
    ).get(tokenId, tokenId);

    if (!tokenRow) {
      return res.status(404).json({ error: 'Not found', message: 'Token not found' });
    }

    if (parentId) {
      const parentRow = db.prepare('SELECT id FROM comments WHERE id = ?').get(parentId);
      if (!parentRow) {
        return res.status(404).json({ error: 'Not found', message: 'Parent comment not found' });
      }
    }

    const commentId = uuidv4();
    const { agent } = req;

    db.prepare(`
      INSERT INTO comments (id, token_id, agent_id, author_address, content, parent_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(commentId, tokenRow.id, agent.id, agent.wallet_address, content.trim(), parentId);

    const comment = db.prepare('SELECT c.*, a.name as agent_name FROM comments c LEFT JOIN agents a ON c.agent_id = a.id WHERE c.id = ?').get(commentId);

    res.json(formatComment(comment));
  } catch (err) {
    console.error('comment error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

function formatComment(c) {
  return {
    id: c.id,
    tokenId: c.token_id,
    content: c.content,
    author: c.author_address,
    agentName: c.agent_name,
    parentId: c.parent_id || null,
    created_at: new Date(c.created_at * 1000).toISOString(),
  };
}

// GET /api/tokens/:id/comments — mounted in tokens router, but also handled here
router.get('/token/:id', (req, res) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);

    const tokenRow = db.prepare(
      'SELECT id FROM tokens WHERE id = ? OR LOWER(token_address) = LOWER(?)'
    ).get(id, id);

    if (!tokenRow) {
      return res.status(404).json({ error: 'Not found', message: 'Token not found' });
    }

    const comments = db.prepare(`
      SELECT c.*, a.name as agent_name FROM comments c
      LEFT JOIN agents a ON c.agent_id = a.id
      WHERE c.token_id = ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(tokenRow.id, limit);

    res.json({ comments: comments.map(formatComment) });
  } catch (err) {
    console.error('get comments error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

module.exports = { router, formatComment };
