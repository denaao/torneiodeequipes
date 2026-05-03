import bcrypt from 'bcryptjs';
import db from '../database.js';

const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'TorneiAdmin2026!';

export function getAdminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD
  };
}

export function syncAdminCredentials() {
  const { username, password } = getAdminCredentials();
  const passwordHash = bcrypt.hashSync(password, 10);
  const existing = db.prepare('SELECT id FROM admin WHERE username = ?').get(username);

  if (existing) {
    db.prepare('UPDATE admin SET password_hash = ? WHERE username = ?').run(passwordHash, username);
    return { username, created: false };
  }

  db.prepare('INSERT INTO admin (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  return { username, created: true };
}
