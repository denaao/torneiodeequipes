import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pool, { initSchema } from './database.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';

const app = express();
const PORT = process.env.PORT || 3011;
const PgSession = connectPgSimple(session);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'torneio-equipes-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

// Landing page e páginas públicas na raiz
app.use(express.static('public'));

// Admin em /admin
app.use('/admin', express.static('admin'));

// Fallback: qualquer rota /admin/* não encontrada → index do admin
app.get('/admin*', (req, res) => {
  res.sendFile('admin/index.html', { root: '.' });
});

app.get('/health', (req, res) => res.send('Torneio de Equipes — OK'));

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Erro ao inicializar banco:', err);
    process.exit(1);
  });
