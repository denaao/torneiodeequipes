import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../database.js';

const router = Router();

router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });
  if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Email já cadastrado' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email.toLowerCase(), hash, name || email.split('@')[0]]
    );
    const user = result.rows[0];
    req.session.user = { id: user.id, email: user.email, name: user.name };
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }
    req.session.user = { id: user.id, email: user.email, name: user.name };
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/check', (req, res) => {
  if (req.session?.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  res.json({ authenticated: false });
});

export default router;
