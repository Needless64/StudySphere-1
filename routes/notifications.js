const express = require('express');
const jwt     = require('jsonwebtoken');
const sql     = require('../db');

const router = express.Router();

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

// GET /api/notifications
router.get('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const notifs = await sql`
      SELECT * FROM notifications WHERE user_id = ${user.id}
      ORDER BY created_at DESC LIMIT 30
    `;
    const unread = notifs.filter(n => !n.is_read).length;
    res.json({ notifications: notifs, unread });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PUT /api/notifications/read  — mark all read
router.put('/read', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    await sql`UPDATE notifications SET is_read = true WHERE user_id = ${user.id} AND is_read = false`;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

module.exports = router;
