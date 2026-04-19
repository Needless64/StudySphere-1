require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS friendships (
      id           SERIAL PRIMARY KEY,
      requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status       VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS saved_resources (
      user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resource_id INT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, resource_id)
    )
  `;
  await sql`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS last_study_date DATE`;
  await sql`ALTER TABLE user_stats ADD COLUMN IF NOT EXISTS completed_sessions INT NOT NULL DEFAULT 0`;
  console.log('Migration 2 done.');
}

migrate().catch(console.error);
