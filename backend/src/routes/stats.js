const express = require('express');
const router = express.Router();
const db = require('../db');
const { getStats } = require('../ws');

// GET /api/stats — platform-level statistics
router.get('/', (req, res) => {
  try {
    res.json(getStats(db));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
