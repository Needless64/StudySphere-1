require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const path         = require('path');

const authRoutes      = require('./routes/auth');
const roomRoutes      = require('./routes/rooms');
const messageRoutes   = require('./routes/messages');
const resourceRoutes  = require('./routes/resources');
const statsRoutes     = require('./routes/stats');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// API routes
app.use('/api/auth',                      authRoutes);
app.use('/api/rooms',                     roomRoutes);
app.use('/api/rooms/:roomId/messages',    messageRoutes);
app.use('/api/rooms/:roomId/resources',   resourceRoutes);
app.use('/api/stats',                     statsRoutes);

// Serve static files (HTML/CSS/JS) and uploaded files
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Fallback to index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`StudySphere server running at http://localhost:${PORT}`);
});
