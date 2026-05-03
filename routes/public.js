import { Router } from 'express';
import db from '../database.js';

const router = Router();

// Registro de jogadores via token
router.get('/register/:token', (req, res) => {
  const etapaTeam = db.prepare(`
    SELECT et.id, et.etapa_id, gt.nome, e.nome as etapa_nome, e.status as etapa_status,
           et.registration_token
    FROM etapa_teams et
    JOIN global_teams gt ON et.global_team_id = gt.id
    JOIN etapas e ON et.etapa_id = e.id
    WHERE et.registration_token = ?
  `).get(req.params.token);

  if (!etapaTeam) return res.status(404).json({ error: 'Link inválido' });

  const players = db.prepare('SELECT * FROM players WHERE etapa_team_id = ? ORDER BY id').all(etapaTeam.id);
  res.json({ ...etapaTeam, players });
});

router.post('/register/:token', (req, res) => {
  const etapaTeam = db.prepare(`
    SELECT et.id, et.etapa_id, e.status as etapa_status
    FROM etapa_teams et
    JOIN etapas e ON et.etapa_id = e.id
    WHERE et.registration_token = ?
  `).get(req.params.token);

  if (!etapaTeam) return res.status(404).json({ error: 'Link inválido' });
  if (etapaTeam.etapa_status !== 'registration') return res.status(400).json({ error: 'Inscrições encerradas para esta etapa' });

  const { players } = req.body;
  if (!players || players.length !== 8) return res.status(400).json({ error: 'Precisa de exatamente 8 jogadores' });
  for (const name of players) {
    if (!name?.trim()) return res.status(400).json({ error: 'Todos os nomes são obrigatórios' });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM players WHERE etapa_team_id = ?').run(etapaTeam.id);
    const ins = db.prepare('INSERT INTO players (etapa_team_id, nome) VALUES (?, ?)');
    for (const name of players) ins.run(etapaTeam.id, name.trim());
  })();

  res.json({ ok: true });
});

// Ranking público por etapa
router.get('/public/etapas', (req, res) => {
  const etapas = db.prepare("SELECT id, nome, status FROM etapas ORDER BY id DESC").all();
  res.json(etapas);
});

router.get('/public/etapas/:id/ranking', (req, res) => {
  const etapaId = req.params.id;
  const teams = db.prepare(`
    SELECT et.id as team_id, gt.nome as team_nome
    FROM etapa_teams et
    JOIN global_teams gt ON et.global_team_id = gt.id
    WHERE et.etapa_id = ?
    ORDER BY et.id
  `).all(etapaId);

  const ranking = [];
  for (const team of teams) {
    const qp = db.prepare(`
      SELECT COALESCE(SUM(s.points), 0) as total
      FROM seats s JOIN tables_t t ON s.table_id = t.id JOIN players p ON s.player_id = p.id
      WHERE p.etapa_team_id = ? AND t.etapa_id = ? AND t.phase = 'qualifying'
    `).get(team.team_id, etapaId);

    const fp = db.prepare(`
      SELECT COALESCE(SUM(s.points), 0) as total
      FROM seats s JOIN tables_t t ON s.table_id = t.id JOIN players p ON s.player_id = p.id
      WHERE p.etapa_team_id = ? AND t.etapa_id = ? AND t.phase = 'final'
    `).get(team.team_id, etapaId);

    ranking.push({
      team_id: team.team_id,
      team_nome: team.team_nome,
      qualifying_points: qp.total,
      final_points: fp.total,
      total_points: qp.total + fp.total
    });
  }

  ranking.sort((a, b) => b.total_points - a.total_points);
  res.json(ranking);
});

export default router;
