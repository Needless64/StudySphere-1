const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const sql      = require('../db');

const router = express.Router();

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

// GET /api/settings/profile
router.get('/profile', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const [u] = await sql`SELECT id, first_name, last_name, email, created_at FROM users WHERE id = ${user.id}`;
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ user: u });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/settings/profile
router.put('/profile', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const { first_name, last_name, email } = req.body;
  if (!first_name?.trim()) return res.status(400).json({ error: 'First name required' });
  try {
    if (email && email !== user.email) {
      const [exists] = await sql`SELECT id FROM users WHERE email = ${email.trim()} AND id != ${user.id}`;
      if (exists) return res.status(409).json({ error: 'Email already in use' });
    }
    await sql`
      UPDATE users SET first_name = ${first_name.trim()}, last_name = ${(last_name||'').trim()},
        email = ${email?.trim() || user.email}
      WHERE id = ${user.id}
    `;
    // Reissue token with updated name
    const newPayload = { id: user.id, email: email?.trim() || user.email, first_name: first_name.trim(), last_name: (last_name||'').trim() };
    const token = jwt.sign(newPayload, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'none', maxAge: 7*24*60*60*1000 });
    res.json({ ok: true, user: newPayload });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/settings/password
router.put('/password', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const [u] = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`;
    const ok = await bcrypt.compare(current_password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// PUT /api/settings/status  — set online/idle/dnd/offline
router.put('/status', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const { status } = req.body;
  if (!['online', 'idle', 'dnd', 'offline'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  try {
    await sql`UPDATE users SET status = ${status}, status_updated_at = NOW() WHERE id = ${user.id}`;
    res.json({ ok: true, status });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// POST /api/settings/status-beacon  — called by sendBeacon on page unload
router.post('/status-beacon', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(200).end();
  try {
    await sql`UPDATE users SET status = 'offline', status_updated_at = NOW() WHERE id = ${user.id}`;
  } catch(e) {}
  res.status(200).end();
});

// POST /api/settings/heartbeat  — keep status alive (called every 2min while tab open)
router.post('/heartbeat', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ ok: true }); // silent fail if not logged in
  try {
    await sql`UPDATE users SET status_updated_at = NOW() WHERE id = ${user.id} AND status != 'offline'`;
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

module.exports = router;
