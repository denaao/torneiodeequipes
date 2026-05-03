import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import { syncAdminCredentials } from './services/admin-bootstrap.js';

const app = express();
const PORT = process.env.PORT || 3011;
const adminSync = syncAdminCredentials();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'torneio-equipes-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

// Serve os arquivos estáticos do admin na raiz
app.use(express.static('admin'));

app.get('/health', (req, res) => {
  res.send('Torneio de Equipes Backend — OK');
});

app.listen(PORT, () => {
  console.log(`Admin ${adminSync.created ? 'criado' : 'atualizado'}: ${adminSync.username}`);
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
