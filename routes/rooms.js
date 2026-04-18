const express = require('express');
const jwt     = require('jsonwebtoken');
const sql     = require('../db');
const pusher  = require('../lib/pusher');

const router = express.Router();

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

// GET /api/rooms/my — rooms where current user is member or host
router.get('/my', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const rooms = await sql`
      SELECT r.*, u.first_name || ' ' || u.last_name AS host_name,
             COUNT(rm2.user_id)::int AS member_count
      FROM study_rooms r
      JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ${user.id}
      LEFT JOIN users u ON u.id = r.host_id
      LEFT JOIN room_members rm2 ON rm2.room_id = r.id
      GROUP BY r.id, u.first_name, u.last_name
      ORDER BY r.created_at DESC
    `;
    res.json({ rooms });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// GET /api/rooms  — list public rooms with member count
router.get('/', async (req, res) => {
  try {
    const rooms = await sql`
      SELECT r.*, u.first_name || ' ' || u.last_name AS host_name,
             COUNT(rm.user_id)::int AS member_count
      FROM study_rooms r
      LEFT JOIN users u ON u.id = r.host_id
      LEFT JOIN room_members rm ON rm.room_id = r.id
      WHERE r.is_public = true
      GROUP BY r.id, u.first_name, u.last_name
      ORDER BY r.created_at DESC
    `;
    res.json({ rooms });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// POST /api/rooms  — create a room
router.post('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const { name, subject, description, max_members, is_public } = req.body;
  if (!name) return res.status(400).json({ error: 'Room name required' });

  try {
    const [room] = await sql`
      INSERT INTO study_rooms (name, subject, description, host_id, max_members, is_public)
      VALUES (${name}, ${subject||'General'}, ${description||''}, ${user.id}, ${max_members||20}, ${is_public!==false})
      RETURNING *
    `;
    await sql`INSERT INTO room_members (room_id, user_id) VALUES (${room.id}, ${user.id})`;
    res.status(201).json({ room });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// GET /api/rooms/:id
router.get('/:id', async (req, res) => {
  try {
    const [room] = await sql`
      SELECT r.*, u.first_name || ' ' || u.last_name AS host_name,
             COUNT(rm.user_id)::int AS member_count
      FROM study_rooms r
      LEFT JOIN users u ON u.id = r.host_id
      LEFT JOIN room_members rm ON rm.room_id = r.id
      WHERE r.id = ${req.params.id}
      GROUP BY r.id, u.first_name, u.last_name
    `;
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

// GET /api/rooms/:id/members
router.get('/:id/members', async (req, res) => {
  try {
    const members = await sql`
      SELECT u.id, u.first_name, u.last_name,
             CASE WHEN r.host_id = u.id THEN 'Host' ELSE 'Member' END AS role
      FROM room_members rm
      JOIN users u ON u.id = rm.user_id
      JOIN study_rooms r ON r.id = rm.room_id
      WHERE rm.room_id = ${req.params.id}
      ORDER BY role DESC, u.first_name
    `;
    res.json({ members });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// POST /api/rooms/:id/join
router.post('/:id/join', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    await sql`
      INSERT INTO room_members (room_id, user_id) VALUES (${req.params.id}, ${user.id})
      ON CONFLICT DO NOTHING
    `;
    await pusher.trigger(`room-${req.params.id}`, 'member-joined', {
      id: user.id, first_name: user.first_name, last_name: user.last_name
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// GET /api/rooms/:id/notes
router.get('/:id/notes', async (req, res) => {
  try {
    const [room] = await sql`SELECT notes FROM study_rooms WHERE id = ${req.params.id}`;
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ notes: room.notes || '' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// PUT /api/rooms/:id/notes
router.put('/:id/notes', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const { notes } = req.body;
  try {
    await sql`UPDATE study_rooms SET notes = ${notes || ''} WHERE id = ${req.params.id}`;
    await pusher.trigger(`room-${req.params.id}`, 'notes-update', {
      notes: notes || '',
      updated_by: user.id,
      updated_by_name: `${user.first_name || ''} ${user.last_name || ''}`.trim()
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save notes' });
  }
});

// POST /api/rooms/:id/typing
router.post('/:id/typing', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  await pusher.trigger(`room-${req.params.id}`, 'typing', {
    user_id: user.id,
    name: `${user.first_name || ''}`.trim()
  });
  res.json({ ok: true });
});

// GET /api/rooms/:id/whiteboard
router.get('/:id/whiteboard', async (req, res) => {
  try {
    const [room] = await sql`SELECT whiteboard_data FROM study_rooms WHERE id = ${req.params.id}`;
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ data: room.whiteboard_data || null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch whiteboard' });
  }
});

// PUT /api/rooms/:id/whiteboard
router.put('/:id/whiteboard', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const { data } = req.body;
  try {
    await sql`UPDATE study_rooms SET whiteboard_data = ${data || null} WHERE id = ${req.params.id}`;
    await pusher.trigger(`room-${req.params.id}`, 'whiteboard-update', {
      data: data || null,
      updated_by: user.id
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save whiteboard' });
  }
});

module.exports = router;
