-- StudySphere Database Schema
-- Run this in the Neon SQL Editor

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_rooms (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT 'General',
  description TEXT,
  host_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  max_members INTEGER DEFAULT 20,
  is_public       BOOLEAN DEFAULT TRUE,
  notes           TEXT DEFAULT '',
  whiteboard_data JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_members (
  id        SERIAL PRIMARY KEY,
  room_id   INTEGER REFERENCES study_rooms(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER REFERENCES study_rooms(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resources (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER REFERENCES study_rooms(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  url        TEXT,
  file_type  TEXT DEFAULT 'link',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  day_streak        INTEGER DEFAULT 0,
  total_study_mins  INTEGER DEFAULT 0,
  resources_shared  INTEGER DEFAULT 0,
  leaderboard_rank  INTEGER DEFAULT 0
);
