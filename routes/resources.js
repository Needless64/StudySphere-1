const express = require('express');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const sql     = require('../db');

const router = express.Router({ mergeParams: true });

function getUser(req) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `r${req.params.roomId}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|md|png|jpg|jpeg|gif|webp|zip|rar|7z)$/i;
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

// POST /api/rooms/:roomId/resources  — file upload or URL
router.post('/', upload.single('file'), async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });

  const file = req.file;
  const { title, url, file_type } = req.body;

  if (!file && !title && !url) return res.status(400).json({ error: 'File or title required' });

  const resourceUrl  = file ? `/uploads/${file.filename}` : (url || '');
  const resourceType = file ? path.extname(file.originalname).toLowerCase().slice(1) : (file_type || 'link');
  const resourceSize = file ? file.size : 0;
  const displayTitle = title || file?.originalname || 'Untitled';
  const origName     = file?.originalname || '';

  try {
    const [resource] = await sql`
      INSERT INTO resources (room_id, user_id, title, url, file_type, file_size, original_name)
      VALUES (${req.params.roomId}, ${user.id}, ${displayTitle}, ${resourceUrl}, ${resourceType}, ${resourceSize}, ${origName})
      RETURNING *
    `;
    await sql`
      UPDATE user_stats SET resources_shared = resources_shared + 1
      WHERE user_id = ${user.id}
    `;
    res.status(201).json({ resource });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save resource' });
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 50 MB)' });
    return res.status(400).json({ error: err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
