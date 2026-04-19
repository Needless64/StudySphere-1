const express = require('express');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const sql     = require('../db');
const pusher  = require('../lib/pusher');
const { put } = require('@vercel/blob');

const router = express.Router({ mergeParams: true });

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

// Memory storage — Vercel has a read-only filesystem
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|md|png|jpg|jpeg|gif|webp)$/i;
    if (allowed.test(path.extname(file.originalname))) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

// GET /api/rooms/:roomId/resources
router.get('/', async (req, res) => {
  try {
    const resources = await sql`
      SELECT r.*, u.first_name || ' ' || u.last_name AS shared_by
      FROM resources r
      JOIN users u ON u.id = r.user_id
      WHERE r.room_id = ${req.params.roomId}
      ORDER BY r.created_at DESC
    `;
    res.json({ resources });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

// POST /api/rooms/:roomId/resources
router.post('/', upload.single('file'), async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  let fileUrl = '';
  let detectedType = 'link';

  if (req.file) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(503).json({ error: 'File storage not configured. Share a URL instead.' });
    }
    try {
      const blob = await put(req.file.originalname, req.file.buffer, { access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN });
      fileUrl = blob.url;
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)) detectedType = 'image';
      else if (ext === '.pdf') detectedType = 'pdf';
      else detectedType = 'file';
    } catch (e) {
      console.error('Blob upload error:', e);
      return res.status(500).json({ error: 'File upload failed' });
    }
  }

  const { title, url, file_type } = req.body;
  const finalUrl = fileUrl || url || '';
  const finalType = file_type || detectedType;
  if (!title && !finalUrl) return res.status(400).json({ error: 'Title or URL required' });

  try {
    const [resource] = await sql`
      INSERT INTO resources (room_id, user_id, title, url, file_type)
      VALUES (${req.params.roomId}, ${user.id}, ${title || req.file?.originalname || 'Untitled'}, ${finalUrl}, ${finalType})
      RETURNING *
    `;
    await sql`
      UPDATE user_stats SET resources_shared = resources_shared + 1
      WHERE user_id = ${user.id}
    `;
    const full = { ...resource, shared_by: `${user.first_name || ''} ${user.last_name || ''}`.trim() };
    await pusher.trigger(`room-${req.params.roomId}`, 'new-resource', full);
    res.status(201).json({ resource: full });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save resource' });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10 MB)' });
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
