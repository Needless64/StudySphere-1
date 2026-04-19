require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'offline'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ`;
  console.log('Migration 5 done.');
}

migrate().catch(console.error);
