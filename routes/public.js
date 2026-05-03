import { Router } from 'express';
import db from '../database.js';

const router = Router();

// ── REGISTRO ──

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

// ── PÚBLICO ──

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

    const details = db.prepare(`
      SELECT p.nome as player_nome, tb.numero as mesa, tb.phase, s.points,
             ((SELECT COUNT(*) FROM seats WHERE table_id = s.table_id) + 1 - s.elimination_order) as position
      FROM seats s JOIN players p ON s.player_id = p.id JOIN tables_t tb ON s.table_id = tb.id
      WHERE p.etapa_team_id = ? AND tb.etapa_id = ? AND s.elimination_order IS NOT NULL
      ORDER BY tb.phase, tb.numero
    `).all(team.team_id, etapaId);

    ranking.push({
      team_id: team.team_id,
      team_nome: team.team_nome,
      qualifying_points: qp.total,
      final_points: fp.total,
      total_points: qp.total + fp.total,
      details
    });
  }

  ranking.sort((a, b) => b.total_points - a.total_points);
  res.json(ranking);
});

router.get('/public/etapas/:id/tables', (req, res) => {
  const tables = db.prepare('SELECT * FROM tables_t WHERE etapa_id = ? ORDER BY phase, numero').all(req.params.id);
  for (const table of tables) {
    table.seats = db.prepare(`
      SELECT s.id as seat_id, s.elimination_order, s.points,
             p.id as player_id, p.nome as player_nome,
             gt.id as team_id, gt.nome as team_nome
      FROM seats s
      JOIN players p ON s.player_id = p.id
      JOIN etapa_teams et ON p.etapa_team_id = et.id
      JOIN global_teams gt ON et.global_team_id = gt.id
      WHERE s.table_id = ?
      ORDER BY s.id
    `).all(table.id);
  }
  res.json(tables);
});

router.get('/public/ranking-geral', (req, res) => {
  const teamTotals = {};

  const etapas = db.prepare("SELECT * FROM etapas WHERE status = 'finished' ORDER BY id").all();
  for (const etapa of etapas) {
    const teams = db.prepare(`
      SELECT et.id as etapa_team_id, gt.nome as team_nome
      FROM etapa_teams et
      JOIN global_teams gt ON et.global_team_id = gt.id
      WHERE et.etapa_id = ?
    `).all(etapa.id);

    for (const team of teams) {
      const pts = db.prepare(`
        SELECT COALESCE(SUM(s.points), 0) as total
        FROM seats s
        JOIN tables_t t ON s.table_id = t.id
        JOIN players p ON s.player_id = p.id
        WHERE p.etapa_team_id = ? AND t.etapa_id = ?
      `).get(team.etapa_team_id, etapa.id);

      if (pts.total <= 0) continue;

      if (!teamTotals[team.team_nome]) {
        teamTotals[team.team_nome] = { team_nome: team.team_nome, total_points: 0, etapas: [] };
      }
      teamTotals[team.team_nome].total_points += pts.total;
      teamTotals[team.team_nome].etapas.push({ nome: etapa.nome, points: pts.total });
    }
  }

  res.json(Object.values(teamTotals).sort((a, b) => b.total_points - a.total_points));
});

export default router;
