import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join, parse } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveDbPath() {
  const requestedPath = process.env.DB_PATH
    || process.env.DATABASE_PATH
    || (process.env.NODE_ENV === 'production' ? '/app/db/torneio.db' : join(__dirname, 'db', 'torneio.db'));

  const parsed = parse(requestedPath);
  const hasExtension = parsed.ext.length > 0;
  let resolvedPath = requestedPath;

  if (!hasExtension) {
    resolvedPath = join(requestedPath, 'torneio.db');
  } else if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isDirectory()) {
    resolvedPath = join(requestedPath, 'torneio.db');
  }

  try {
    fs.mkdirSync(dirname(resolvedPath), { recursive: true });
  } catch (_) {}

  return resolvedPath;
}

function openDatabase() {
  const primaryPath = resolveDbPath();
  const fallbacks = [primaryPath, '/app/db/torneio.db', '/app/torneio.db', '/tmp/torneio.db'];

  let lastError = null;
  for (const candidate of fallbacks) {
    try {
      fs.mkdirSync(dirname(candidate), { recursive: true });
      return new Database(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const db = openDatabase();

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS etapas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    status TEXT DEFAULT 'registration',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS global_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS etapa_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    etapa_id INTEGER NOT NULL REFERENCES etapas(id),
    global_team_id INTEGER NOT NULL REFERENCES global_teams(id),
    registration_token TEXT UNIQUE NOT NULL,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(etapa_id, global_team_id)
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    etapa_team_id INTEGER,
    nome TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tables_t (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    etapa_id INTEGER NOT NULL REFERENCES etapas(id),
    numero INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'qualifying'
  );

  CREATE TABLE IF NOT EXISTS seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id INTEGER NOT NULL REFERENCES tables_t(id),
    player_id INTEGER NOT NULL,
    elimination_order INTEGER,
    points INTEGER DEFAULT 0
  );
`);

export default db;
