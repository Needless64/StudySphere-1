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

module.exports = router;
