import { Router } from 'express';
import pool from '../database.js';

const router = Router();

// ── REGISTRO DE EQUIPES (público via token) ──

router.get('/register/:token', async (req, res) => {
  try {
    const { rows: [etapaTeam] } = await pool.query(`
      SELECT et.id, et.etapa_id, gt.nome, e.nome as etapa_nome, e.status as etapa_status,
             et.registration_token
      FROM etapa_teams et
      JOIN global_teams gt ON et.global_team_id = gt.id
      JOIN etapas e ON et.etapa_id = e.id
      WHERE et.registration_token = $1
    `, [req.params.token]);

    if (!etapaTeam) return res.status(404).json({ error: 'Link inválido' });

    const { rows: players } = await pool.query(
      'SELECT * FROM players WHERE etapa_team_id = $1 ORDER BY id', [etapaTeam.id]
    );
    res.json({ ...etapaTeam, players });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/register/:token', async (req, res) => {
  try {
    const { rows: [etapaTeam] } = await pool.query(`
      SELECT et.id, e.status as etapa_status
      FROM etapa_teams et
      JOIN etapas e ON et.etapa_id = e.id
      WHERE et.registration_token = $1
    `, [req.params.token]);

    if (!etapaTeam) return res.status(404).json({ error: 'Link inválido' });
    if (etapaTeam.etapa_status !== 'registration') return res.status(400).json({ error: 'Inscrições encerradas' });

    const { players } = req.body;
    if (!players || players.length !== 8) return res.status(400).json({ error: 'Precisa de exatamente 8 jogadores' });
    for (const name of players) {
      if (!name?.trim()) return res.status(400).json({ error: 'Todos os nomes são obrigatórios' });
    }

    await pool.query('DELETE FROM players WHERE etapa_team_id = $1', [etapaTeam.id]);
    for (const name of players) {
      await pool.query('INSERT INTO players (etapa_team_id, nome) VALUES ($1, $2)', [etapaTeam.id, name.trim()]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RANKING PÚBLICO (via etapa ID) ──

router.get('/public/etapas/:id/ranking', async (req, res) => {
  const etapaId = req.params.id;
  try {
    const { rows: teams } = await pool.query(`
      SELECT et.id as team_id, gt.nome as team_nome
      FROM etapa_teams et
      JOIN global_teams gt ON et.global_team_id = gt.id
      WHERE et.etapa_id = $1
      ORDER BY et.id
    `, [etapaId]);

    const ranking = [];
    for (const team of teams) {
      const qp = (await pool.query(`
        SELECT COALESCE(SUM(s.points), 0) as total
        FROM seats s JOIN tables_t t ON s.table_id = t.id JOIN players p ON s.player_id = p.id
        WHERE p.etapa_team_id = $1 AND t.etapa_id = $2 AND t.phase = 'qualifying'
      `, [team.team_id, etapaId])).rows[0];

      const fp = (await pool.query(`
        SELECT COALESCE(SUM(s.points), 0) as total
        FROM seats s JOIN tables_t t ON s.table_id = t.id JOIN players p ON s.player_id = p.id
        WHERE p.etapa_team_id = $1 AND t.etapa_id = $2 AND t.phase = 'final'
      `, [team.team_id, etapaId])).rows[0];

      const { rows: details } = await pool.query(`
        SELECT p.nome as player_nome, tb.numero as mesa, tb.phase, s.points,
               (SELECT COUNT(*) FROM seats WHERE table_id = s.table_id) + 1 - s.elimination_order as position
        FROM seats s JOIN players p ON s.player_id = p.id JOIN tables_t tb ON s.table_id = tb.id
        WHERE p.etapa_team_id = $1 AND tb.etapa_id = $2 AND s.elimination_order IS NOT NULL
        ORDER BY tb.phase, tb.numero
      `, [team.team_id, etapaId]);

      ranking.push({
        team_id: team.team_id,
        team_nome: team.team_nome,
        qualifying_points: parseInt(qp.total),
        final_points: parseInt(fp.total),
        total_points: parseInt(qp.total) + parseInt(fp.total),
        details
      });
    }

    ranking.sort((a, b) => b.total_points - a.total_points);
    res.json(ranking);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/public/etapas/:id/tables', async (req, res) => {
  try {
    const { rows: tables } = await pool.query(
      'SELECT * FROM tables_t WHERE etapa_id = $1 ORDER BY phase, numero', [req.params.id]
    );
    for (const table of tables) {
      const { rows } = await pool.query(`
        SELECT s.id as seat_id, s.elimination_order, s.points,
               p.id as player_id, p.nome as player_nome,
               gt.id as team_id, gt.nome as team_nome
        FROM seats s
        JOIN players p ON s.player_id = p.id
        JOIN etapa_teams et ON p.etapa_team_id = et.id
        JOIN global_teams gt ON et.global_team_id = gt.id
        WHERE s.table_id = $1 ORDER BY s.id
      `, [table.id]);
      table.seats = rows;
    }
    res.json(tables);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/public/etapas/:id/info', async (req, res) => {
  try {
    const { rows: [etapa] } = await pool.query(
      'SELECT id, nome, status FROM etapas WHERE id = $1', [req.params.id]
    );
    if (!etapa) return res.status(404).json({ error: 'Etapa não encontrada' });
    res.json(etapa);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
