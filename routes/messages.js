const express = require('express');
const jwt     = require('jsonwebtoken');
const sql     = require('../db');
const pusher  = require('../lib/pusher');

const router = express.Router({ mergeParams: true });

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

// GET /api/rooms/:roomId/messages
router.get('/', async (req, res) => {
  try {
    const msgs = await sql`
      SELECT m.*, u.first_name || ' ' || u.last_name AS sender_name
      FROM messages m
      JOIN users u ON u.id = m.user_id
      WHERE m.room_id = ${req.params.roomId}
      ORDER BY m.created_at ASC
      LIMIT 100
    `;
    res.json({ messages: msgs });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/rooms/:roomId/messages
router.post('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

  try {
    const [msg] = await sql`
      INSERT INTO messages (room_id, user_id, content)
      VALUES (${req.params.roomId}, ${user.id}, ${content.trim()})
      RETURNING *
    `;
    // Update study time stat (1 message = 1 min activity)
    await sql`
      UPDATE user_stats SET total_study_mins = total_study_mins + 1
      WHERE user_id = ${user.id}
    `;
    const fullMsg = { ...msg, sender_name: `${user.first_name || 'User'} ${user.last_name || ''}`.trim() };
    await pusher.trigger(`room-${req.params.roomId}`, 'new-message', fullMsg);
    res.status(201).json({ message: fullMsg });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
