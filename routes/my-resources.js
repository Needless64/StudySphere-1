const express = require('express');
const jwt     = require('jsonwebtoken');
const sql     = require('../db');

const router = express.Router();

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

// GET /api/my-resources  — all resources uploaded by current user
router.get('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const resources = await sql`
      SELECT r.*, sr.name AS room_name, sr.id AS room_id,
             EXISTS(SELECT 1 FROM saved_resources sv WHERE sv.user_id = ${user.id} AND sv.resource_id = r.id) AS is_saved
      FROM resources r
      JOIN study_rooms sr ON sr.id = r.room_id
      WHERE r.user_id = ${user.id}
      ORDER BY r.created_at DESC
    `;
    res.json({ resources });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

// GET /api/my-resources/saved
router.get('/saved', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const resources = await sql`
      SELECT r.*, sr.name AS room_name, sr.id AS room_id,
             u.first_name || ' ' || u.last_name AS shared_by,
             true AS is_saved
      FROM saved_resources sv
      JOIN resources r ON r.id = sv.resource_id
      JOIN study_rooms sr ON sr.id = r.room_id
      JOIN users u ON u.id = r.user_id
      WHERE sv.user_id = ${user.id}
      ORDER BY sv.saved_at DESC
    `;
    res.json({ resources });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch saved resources' });
  }
});

// POST /api/my-resources/:id/save  — toggle save
router.post('/:id/save', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const [existing] = await sql`SELECT 1 FROM saved_resources WHERE user_id = ${user.id} AND resource_id = ${req.params.id}`;
    if (existing) {
      await sql`DELETE FROM saved_resources WHERE user_id = ${user.id} AND resource_id = ${req.params.id}`;
      return res.json({ saved: false });
    }
    await sql`INSERT INTO saved_resources (user_id, resource_id) VALUES (${user.id}, ${req.params.id}) ON CONFLICT DO NOTHING`;
    res.json({ saved: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to toggle save' });
  }
});

module.exports = router;
