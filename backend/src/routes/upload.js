const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { requireAuth } = require('../auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// POST /api/upload
router.post('/', requireAuth, async (req, res) => {
  try {
    const { image, type } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Validation', message: 'image is required (URL or base64)' });
    }
    if (!['icon', 'banner'].includes(type)) {
      return res.status(400).json({ error: 'Validation', message: 'type must be icon or banner' });
    }

    let buffer, ext;

    if (image.startsWith('data:')) {
      // base64 data URL
      const matches = image.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ error: 'Validation', message: 'Invalid base64 data URL' });
      }
      const mimeType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
      ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    } else if (image.startsWith('http')) {
      const { buffer: dlBuffer, contentType } = await downloadUrl(image);
      buffer = dlBuffer;
      ext = (contentType || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    } else {
      return res.status(400).json({ error: 'Validation', message: 'image must be a URL or base64 data URL' });
    }

    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Validation', message: 'Image too large (max 5MB)' });
    }

    const filename = `${req.agent.id}-${type}-${Date.now()}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    // In production, serve from a CDN or public path. Here we return a local-relative URL.
    const url = `/uploads/${filename}`;

    res.json({ success: true, url, type, size: buffer.length });
  } catch (err) {
    console.error('upload error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

module.exports = router;
