const express = require('express');
const jwt     = require('jsonwebtoken');
const sql     = require('../db');

const router = express.Router();

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

function computeLevel(xp) { return Math.max(1, Math.floor(1 + Math.sqrt(xp / 10))); }
function xpForLevel(level) { return (level - 1) * (level - 1) * 10; }

// GET /api/analytics
router.get('/', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const [stats] = await sql`SELECT * FROM user_stats WHERE user_id = ${user.id}`;
    const xp   = stats?.total_study_mins || 0;
    const level = computeLevel(xp);
    const levelXp   = xp - xpForLevel(level);
    const nextLevelXp = xpForLevel(level + 1) - xpForLevel(level);

    // Top 10 leaderboard
    const leaderboard = await sql`
      SELECT u.first_name, u.last_name, s.total_study_mins AS xp, s.user_id
      FROM user_stats s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.total_study_mins DESC
      LIMIT 10
    `;

    // Rooms the user is in
    const roomCount = await sql`SELECT COUNT(*)::int AS cnt FROM room_members WHERE user_id = ${user.id}`;

    res.json({
      xp,
      level,
      levelXp,
      nextLevelXp,
      day_streak:         stats?.day_streak || 0,
      total_study_mins:   xp,
      resources_shared:   stats?.resources_shared || 0,
      completed_sessions: stats?.completed_sessions || 0,
      rooms_joined:       roomCount[0]?.cnt || 0,
      leaderboard: leaderboard.map((u, i) => ({
        rank: i + 1,
        name: u.first_name + ' ' + (u.last_name?.charAt(0) || '') + '.',
        xp: u.xp,
        level: computeLevel(u.xp),
        is_me: Number(u.user_id) === Number(user.id)
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
