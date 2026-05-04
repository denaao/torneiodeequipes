import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS etapas (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      status TEXT DEFAULT 'registration',
      players_per_team INTEGER DEFAULT 4,
      final_spots INTEGER DEFAULT 6,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE etapas ADD COLUMN IF NOT EXISTS players_per_team INTEGER DEFAULT 4;
    ALTER TABLE etapas ADD COLUMN IF NOT EXISTS final_spots INTEGER DEFAULT 6;

    CREATE TABLE IF NOT EXISTS global_teams (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, nome)
    );

    CREATE TABLE IF NOT EXISTS etapa_teams (
      id SERIAL PRIMARY KEY,
      etapa_id INTEGER NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
      global_team_id INTEGER NOT NULL REFERENCES global_teams(id) ON DELETE CASCADE,
      registration_token TEXT UNIQUE NOT NULL,
      registered_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(etapa_id, global_team_id)
    );

    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      etapa_team_id INTEGER REFERENCES etapa_teams(id) ON DELETE CASCADE,
      nome TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tables_t (
      id SERIAL PRIMARY KEY,
      etapa_id INTEGER NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
      numero INTEGER NOT NULL,
      phase TEXT NOT NULL DEFAULT 'qualifying'
    );

    CREATE TABLE IF NOT EXISTS seats (
      id SERIAL PRIMARY KEY,
      table_id INTEGER NOT NULL REFERENCES tables_t(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      elimination_order INTEGER,
      points INTEGER DEFAULT 0
    );
  `);
  console.log('[DB] Schema inicializado');
}

export default pool;
