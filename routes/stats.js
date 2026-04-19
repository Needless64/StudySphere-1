const express = require('express');
const jwt     = require('jsonwebtoken');
const sql     = require('../db');

const router = express.Router();

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

// GET /api/stats  — current user's stats
router.get('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  try {
    const [stats] = await sql`SELECT * FROM user_stats WHERE user_id = ${user.id}`;
    if (!stats) return res.json({ day_streak: 0, total_study_mins: 0, resources_shared: 0, leaderboard_rank: 0 });

    const mins = stats.total_study_mins;
    const hours = Math.floor(mins / 60);
    const display = mins < 60 ? `${mins}m` : `${hours}h`;

    res.json({
      day_streak:       stats.day_streak,
      study_time:       display,
      resources_shared: stats.resources_shared,
      leaderboard_rank: stats.leaderboard_rank || '—'
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST /api/stats/session  — log completed focus session
router.post('/session', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const minutes = Math.max(1, Math.min(120, parseInt(req.body.minutes) || 25));
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [stats] = await sql`SELECT * FROM user_stats WHERE user_id = ${user.id}`;
    if (!stats) return res.status(404).json({ error: 'Stats not found' });

    const lastDate = stats.last_study_date ? stats.last_study_date.toISOString?.()?.slice(0,10) ?? String(stats.last_study_date).slice(0,10) : null;
    let newStreak = stats.day_streak || 0;
    if (!lastDate || lastDate < today) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      newStreak = (lastDate === yesterday) ? newStreak + 1 : 1;
    }

    await sql`
      UPDATE user_stats SET
        total_study_mins   = total_study_mins + ${minutes},
        completed_sessions = completed_sessions + 1,
        day_streak         = ${newStreak},
        last_study_date    = ${today}
      WHERE user_id = ${user.id}
    `;
    res.json({ ok: true, minutes, streak: newStreak });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to log session' });
  }
});

module.exports = router;
