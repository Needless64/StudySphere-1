const express = require('express');
const jwt     = require('jsonwebtoken');
const sql     = require('../db');
const pusher  = require('../lib/pusher');

async function notify(userId, type, title, body, data) {
  try {
    await sql`INSERT INTO notifications (user_id, type, title, body, data) VALUES (${userId}, ${type}, ${title}, ${body||null}, ${data||null})`;
    await pusher.trigger(`notify-${userId}`, 'notification', { type, title, body, data });
  } catch(e) { console.error('notify error:', e.message); }
}

const router = express.Router();

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

function computeLevel(xp) {
  return Math.max(1, Math.floor(1 + Math.sqrt(xp / 10)));
}

// GET /api/community/users?q=
router.get('/users', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const q = (req.query.q || '').trim();
  try {
    const statusExpr = `CASE WHEN u.status_updated_at IS NOT NULL AND u.status_updated_at > NOW() - INTERVAL '5 minutes' THEN u.status ELSE 'offline' END`;
    const users = q
      ? await sql`
          SELECT u.id, u.first_name, u.last_name,
                 COALESCE(s.total_study_mins, 0) AS xp,
                 f.id AS friendship_id, f.status AS friendship_status, f.requester_id,
                 CASE WHEN u.status_updated_at IS NOT NULL AND u.status_updated_at > NOW() - INTERVAL '5 minutes' THEN u.status ELSE 'offline' END AS presence
          FROM users u
          LEFT JOIN user_stats s ON s.user_id = u.id
          LEFT JOIN friendships f ON (
            (f.requester_id = ${user.id} AND f.addressee_id = u.id) OR
            (f.addressee_id = ${user.id} AND f.requester_id = u.id)
          )
          WHERE u.id != ${user.id}
            AND (u.first_name ILIKE ${'%'+q+'%'} OR u.last_name ILIKE ${'%'+q+'%'})
          ORDER BY xp DESC LIMIT 30`
      : await sql`
          SELECT u.id, u.first_name, u.last_name,
                 COALESCE(s.total_study_mins, 0) AS xp,
                 f.id AS friendship_id, f.status AS friendship_status, f.requester_id,
                 CASE WHEN u.status_updated_at IS NOT NULL AND u.status_updated_at > NOW() - INTERVAL '5 minutes' THEN u.status ELSE 'offline' END AS presence
          FROM users u
          LEFT JOIN user_stats s ON s.user_id = u.id
          LEFT JOIN friendships f ON (
            (f.requester_id = ${user.id} AND f.addressee_id = u.id) OR
            (f.addressee_id = ${user.id} AND f.requester_id = u.id)
          )
          WHERE u.id != ${user.id}
          ORDER BY xp DESC LIMIT 30`;
    res.json({ users: users.map(u => ({ ...u, level: computeLevel(u.xp) })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/community/friends
router.get('/friends', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const friends = await sql`
      SELECT u.id, u.first_name, u.last_name,
             COALESCE(s.total_study_mins, 0) AS xp,
             f.id AS friendship_id, f.status, f.requester_id,
             CASE WHEN u.status_updated_at IS NOT NULL AND u.status_updated_at > NOW() - INTERVAL '5 minutes' THEN u.status ELSE 'offline' END AS presence
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requester_id = ${user.id} THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE (f.requester_id = ${user.id} OR f.addressee_id = ${user.id})
        AND f.status = 'accepted'
      ORDER BY u.first_name
    `;
    const pending = await sql`
      SELECT u.id, u.first_name, u.last_name,
             COALESCE(s.total_study_mins, 0) AS xp,
             f.id AS friendship_id
      FROM friendships f
      JOIN users u ON u.id = f.requester_id
      LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE f.addressee_id = ${user.id} AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `;
    res.json({
      friends: friends.map(u => ({ ...u, level: computeLevel(u.xp) })),
      pending: pending.map(u => ({ ...u, level: computeLevel(u.xp) }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// POST /api/community/friend-request  { addressee_id }
router.post('/friend-request', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  const { addressee_id } = req.body;
  if (!addressee_id || Number(addressee_id) === Number(user.id))
    return res.status(400).json({ error: 'Invalid user' });
  try {
    // Check if reverse request exists → auto-accept
    const [reverse] = await sql`
      SELECT id FROM friendships WHERE requester_id = ${addressee_id} AND addressee_id = ${user.id} AND status = 'pending'
    `;
    if (reverse) {
      await sql`UPDATE friendships SET status = 'accepted' WHERE id = ${reverse.id}`;
      const [sender] = await sql`SELECT first_name, last_name FROM users WHERE id = ${user.id}`;
      const senderName = `${sender.first_name} ${sender.last_name||''}`.trim();
      await notify(addressee_id, 'friend_accepted', `${senderName} accepted your friend request`, `You and ${senderName} are now friends 🎉`, { user_id: user.id });
      await notify(user.id, 'friend_accepted', `You're now friends with someone`, `Your friend request was auto-accepted 🎉`, { user_id: addressee_id });
      return res.json({ ok: true, status: 'accepted' });
    }
    await sql`
      INSERT INTO friendships (requester_id, addressee_id) VALUES (${user.id}, ${addressee_id})
      ON CONFLICT (requester_id, addressee_id) DO NOTHING
    `;
    const [sender2] = await sql`SELECT first_name, last_name FROM users WHERE id = ${user.id}`;
    const senderName2 = `${sender2.first_name} ${sender2.last_name||''}`.trim();
    await notify(addressee_id, 'friend_request', `${senderName2} sent you a friend request`, 'Go to Community → Requests to accept', { user_id: user.id, friendship_requester: user.id });
    res.json({ ok: true, status: 'pending' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// PUT /api/community/friend-request/:id/accept
router.put('/friend-request/:id/accept', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    const [fr] = await sql`SELECT requester_id FROM friendships WHERE id = ${req.params.id} AND addressee_id = ${user.id} AND status = 'pending'`;
    if (!fr) return res.status(404).json({ error: 'Request not found' });
    await sql`UPDATE friendships SET status = 'accepted' WHERE id = ${req.params.id}`;
    const [accepter] = await sql`SELECT first_name, last_name FROM users WHERE id = ${user.id}`;
    const accepterName = `${accepter.first_name} ${accepter.last_name||''}`.trim();
    await notify(fr.requester_id, 'friend_accepted', `${accepterName} accepted your friend request`, `You and ${accepterName} are now friends 🎉`, { user_id: user.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to accept' });
  }
});

// DELETE /api/community/friend-request/:id
router.delete('/friend-request/:id', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    await sql`
      DELETE FROM friendships
      WHERE id = ${req.params.id}
        AND (requester_id = ${user.id} OR addressee_id = ${user.id})
    `;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove' });
  }
});

// GET /api/community/recommendations
router.get('/recommendations', async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  try {
    // IDs to exclude (self + already connected)
    const connected = await sql`
      SELECT CASE WHEN requester_id = ${user.id} THEN addressee_id ELSE requester_id END AS uid
      FROM friendships WHERE requester_id = ${user.id} OR addressee_id = ${user.id}
    `;
    const excludeIds = [user.id, ...connected.map(r => r.uid)];

    // Studied together — shared room membership
    const studiedTogether = await sql`
      SELECT u.id, u.first_name, u.last_name,
             COALESCE(s.total_study_mins, 0) AS xp,
             COUNT(DISTINCT rm1.room_id)::int AS shared_rooms
      FROM room_members rm1
      JOIN room_members rm2 ON rm2.room_id = rm1.room_id AND rm2.user_id = ${user.id}
      JOIN users u ON u.id = rm1.user_id
      LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE rm1.user_id != ${user.id}
        AND u.id != ALL(${excludeIds})
      GROUP BY u.id, u.first_name, u.last_name, s.total_study_mins
      ORDER BY shared_rooms DESC
      LIMIT 8
    `;

    // Friends of friends via CTE
    const fof = await sql`
      WITH my_friends AS (
        SELECT CASE WHEN requester_id = ${user.id} THEN addressee_id ELSE requester_id END AS uid
        FROM friendships
        WHERE (requester_id = ${user.id} OR addressee_id = ${user.id}) AND status = 'accepted'
      ),
      candidates AS (
        SELECT CASE WHEN f.requester_id = mf.uid THEN f.addressee_id ELSE f.requester_id END AS cid,
               COUNT(*)::int AS mutual_count
        FROM my_friends mf
        JOIN friendships f ON (f.requester_id = mf.uid OR f.addressee_id = mf.uid) AND f.status = 'accepted'
        WHERE CASE WHEN f.requester_id = mf.uid THEN f.addressee_id ELSE f.requester_id END != ${user.id}
        GROUP BY cid
      )
      SELECT u.id, u.first_name, u.last_name,
             COALESCE(s.total_study_mins, 0) AS xp,
             c.mutual_count
      FROM candidates c
      JOIN users u ON u.id = c.cid
      LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE c.cid != ALL(${excludeIds})
      ORDER BY c.mutual_count DESC
      LIMIT 8
    `;

    const studiedLabels = [
      "Perfect study synergy — you've locked in together before 🔥",
      "You two crossed paths in a study session ⚡",
      "Study session alumni — been in the same room 📚",
      "Concentration vibes already matched once 🧠",
      "You two have grinded in the same room 💪",
      "Shared study space detected — great minds collide 🎯",
    ];
    const fofLabels = [
      "Yo friend's friend — it's a small study world 👥",
      "Connected through your study circle 🌐",
      "Your friend knows this person — bridge the gap 🤝",
      "One degree away from your study squad 🎯",
      "Friend network overlap detected 🕸️",
    ];

    const studiedSet = new Set(studiedTogether.map(u => u.id));
    const recs = [
      ...studiedTogether.map((u, i) => ({
        ...u, level: computeLevel(u.xp),
        reason_type: 'studied_together',
        reason: studiedLabels[i % studiedLabels.length],
        detail: `${u.shared_rooms} shared room${u.shared_rooms !== 1 ? 's' : ''}`,
      })),
      ...fof.filter(u => !studiedSet.has(u.id)).map((u, i) => ({
        ...u, level: computeLevel(u.xp),
        reason_type: 'friend_of_friend',
        reason: fofLabels[i % fofLabels.length],
        detail: `${u.mutual_count} mutual friend${u.mutual_count !== 1 ? 's' : ''}`,
      })),
    ];

    res.json({ recommendations: recs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

module.exports = router;
