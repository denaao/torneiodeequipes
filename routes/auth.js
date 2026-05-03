import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../database.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha obrigatórios' });
  }

  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }

  req.session.admin = { id: admin.id, username: admin.username };
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/check', (req, res) => {
  if (req.session && req.session.admin) {
    return res.json({ authenticated: true, username: req.session.admin.username });
  }
  res.json({ authenticated: false });
});

export default router;
