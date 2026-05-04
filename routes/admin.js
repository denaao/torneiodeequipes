import { Router } from 'express';
import crypto from 'crypto';
import pool from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { executeDraw } from '../services/draw.js';
import { getQualifyingPoints, getFinalPoints, eliminationToPosition } from '../services/scoring.js';

const router = Router();
router.use(requireAuth);

const uid = req => req.session.user.id;

// ── ETAPAS ──

router.get('/etapas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM etapas WHERE user_id = $1 ORDER BY id DESC',
      [uid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/etapas', async (req, res) => {
  const { nome, players_per_team, final_spots } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
  const ppt = parseInt(players_per_team) || 4;
  const fs = parseInt(final_spots) || 6;
  try {
    const r = await pool.query(
      'INSERT INTO etapas (user_id, nome, players_per_team, final_spots) VALUES ($1, $2, $3, $4) RETURNING *',
      [uid(req), nome, ppt, fs]
    );
    const etapaId = r.rows[0].id;

    const globalTeams = await pool.query(
      'SELECT id FROM global_teams WHERE user_id = $1', [uid(req)]
    );
    for (const gt of globalTeams.rows) {
      await pool.query(
        'INSERT INTO etapa_teams (etapa_id, global_team_id, registration_token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [etapaId, gt.id, crypto.randomUUID()]
      );
    }
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/etapas/:id', async (req, res) => {
  const { status } = req.body;
  const valid = ['registration', 'qualifying', 'final', 'finished'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  try {
    await pool.query(
      'UPDATE etapas SET status = $1 WHERE id = $2 AND user_id = $3',
      [status, req.params.id, uid(req)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/etapas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM etapas WHERE id = $1 AND user_id = $2', [req.params.id, uid(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TEAMS ──

router.get('/etapas/:id/teams', async (req, res) => {
  try {
    const { rows: teams } = await pool.query(`
      SELECT et.id, et.registration_token, gt.nome, gt.id as global_team_id
      FROM etapa_teams et
      JOIN global_teams gt ON et.global_team_id = gt.id
      JOIN etapas e ON et.etapa_id = e.id
      WHERE et.etapa_id = $1 AND e.user_id = $2
      ORDER BY et.id
    `, [req.params.id, uid(req)]);

    for (const team of teams) {
      const { rows } = await pool.query(
        'SELECT * FROM players WHERE etapa_team_id = $1 ORDER BY id', [team.id]
      );
      team.players = rows;
    }
    res.json(teams);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/etapas/:id/teams', async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome da equipe obrigatório' });
  try {
    let gt = (await pool.query(
      'SELECT id FROM global_teams WHERE user_id = $1 AND nome = $2', [uid(req), nome]
    )).rows[0];

    if (!gt) {
      gt = (await pool.query(
        'INSERT INTO global_teams (user_id, nome) VALUES ($1, $2) RETURNING id', [uid(req), nome]
      )).rows[0];
    }

    const existing = (await pool.query(
      'SELECT id FROM etapa_teams WHERE etapa_id = $1 AND global_team_id = $2', [req.params.id, gt.id]
    )).rows[0];
    if (existing) return res.status(400).json({ error: 'Equipe já adicionada nesta etapa' });

    const token = crypto.randomUUID();
    const r = await pool.query(
      'INSERT INTO etapa_teams (etapa_id, global_team_id, registration_token) VALUES ($1, $2, $3) RETURNING id',
      [req.params.id, gt.id, token]
    );
    res.json({ id: r.rows[0].id, nome, registration_token: token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/teams/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM etapa_teams WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DRAW ──

router.post('/etapas/:id/draw', async (req, res) => {
  const etapaId = req.params.id;
  try {
    const etapa = (await pool.query(
      'SELECT * FROM etapas WHERE id = $1 AND user_id = $2', [etapaId, uid(req)]
    )).rows[0];
    if (!etapa) return res.status(404).json({ error: 'Etapa não encontrada' });

    const existing = (await pool.query(
      "SELECT COUNT(*) as count FROM tables_t WHERE etapa_id = $1 AND phase = 'qualifying'", [etapaId]
    )).rows[0];
    if (parseInt(existing.count) > 0) return res.status(400).json({ error: 'Sorteio já realizado.' });

    const { rows: teams } = await pool.query(`
      SELECT et.id, gt.nome
      FROM etapa_teams et
      JOIN global_teams gt ON et.global_team_id = gt.id
      WHERE et.etapa_id = $1
    `, [etapaId]);

    for (const team of teams) {
      const { rows } = await pool.query(
        'SELECT * FROM players WHERE etapa_team_id = $1 ORDER BY id', [team.id]
      );
      team.players = rows;
    }

    const tables = executeDraw(teams, etapa.players_per_team || 4);

    for (const table of tables) {
      const r = await pool.query(
        'INSERT INTO tables_t (etapa_id, numero, phase) VALUES ($1, $2, $3) RETURNING id',
        [etapaId, table.numero, 'qualifying']
      );
      const tableId = r.rows[0].id;
      for (const player of table.players) {
        await pool.query('INSERT INTO seats (table_id, player_id) VALUES ($1, $2)', [tableId, player.id]);
      }
    }

    await pool.query("UPDATE etapas SET status = 'qualifying' WHERE id = $1", [etapaId]);
    res.json({ ok: true, tables: tables.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/etapas/:id/tables', async (req, res) => {
  try {
    await pool.query('DELETE FROM tables_t WHERE etapa_id = $1', [req.params.id]);
    await pool.query("UPDATE etapas SET status = 'registration' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TABLES & SEATS ──

router.get('/etapas/:id/tables', async (req, res) => {
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

router.patch('/seats/:id/eliminate', async (req, res) => {
  const rawOrder = Number(req.body?.elimination_order);
  if (!Number.isInteger(rawOrder) || rawOrder < 1) {
    return res.status(400).json({ error: 'Ordem de eliminação inválida' });
  }
  try {
    const seat = (await pool.query(`
      SELECT s.*, t.phase, t.etapa_id FROM seats s
      JOIN tables_t t ON s.table_id = t.id
      JOIN etapas e ON t.etapa_id = e.id
      WHERE s.id = $1 AND e.user_id = $2
    `, [req.params.id, uid(req)])).rows[0];
    if (!seat) return res.status(404).json({ error: 'Seat não encontrado' });

    const etapa = (await pool.query('SELECT status FROM etapas WHERE id = $1', [seat.etapa_id])).rows[0];
    if (etapa?.status === 'finished') return res.status(400).json({ error: 'Etapa encerrada.' });
    if (seat.elimination_order !== null) return res.status(400).json({ error: 'Jogador já eliminado' });

    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*) as count FROM seats WHERE table_id = $1 AND elimination_order IS NOT NULL', [seat.table_id]
    );
    const expectedOrder = parseInt(count) + 1;
    if (rawOrder !== expectedOrder) return res.status(409).json({ error: `Use a ordem ${expectedOrder}` });

    const { rows: [{ count: total }] } = await pool.query(
      'SELECT COUNT(*) as count FROM seats WHERE table_id = $1', [seat.table_id]
    );
    const totalPlayers = parseInt(total);
    const position = eliminationToPosition(rawOrder, totalPlayers);
    const points = seat.phase === 'qualifying' ? getQualifyingPoints(position) : getFinalPoints(position);

    await pool.query('UPDATE seats SET elimination_order = $1, points = $2 WHERE id = $3', [rawOrder, points, req.params.id]);
    res.json({ ok: true, position, points });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/seats/:id/clear', async (req, res) => {
  try {
    const seat = (await pool.query(`
      SELECT s.*, t.etapa_id FROM seats s
      JOIN tables_t t ON s.table_id = t.id
      JOIN etapas e ON t.etapa_id = e.id
      WHERE s.id = $1 AND e.user_id = $2
    `, [req.params.id, uid(req)])).rows[0];

    if (seat) {
      const etapa = (await pool.query('SELECT status FROM etapas WHERE id = $1', [seat.etapa_id])).rows[0];
      if (etapa?.status === 'finished') return res.status(400).json({ error: 'Etapa encerrada.' });
    }
    await pool.query('UPDATE seats SET elimination_order = NULL, points = 0 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FINAL TABLE ──

router.post('/etapas/:id/final', async (req, res) => {
  const etapaId = req.params.id;
  const { representatives } = req.body;
  if (!representatives?.length) return res.status(400).json({ error: 'Precisa de pelo menos 1 representante' });
  try {
    const existing = (await pool.query(
      "SELECT COUNT(*) as count FROM tables_t WHERE etapa_id = $1 AND phase = 'final'", [etapaId]
    )).rows[0];
    if (parseInt(existing.count) > 0) return res.status(400).json({ error: 'Mesa final já criada' });

    const r = await pool.query(
      'INSERT INTO tables_t (etapa_id, numero, phase) VALUES ($1, 1, $2) RETURNING id',
      [etapaId, 'final']
    );
    const tableId = r.rows[0].id;
    for (const rep of representatives) {
      await pool.query('INSERT INTO seats (table_id, player_id) VALUES ($1, $2)', [tableId, rep.player_id]);
    }
    await pool.query("UPDATE etapas SET status = 'final' WHERE id = $1", [etapaId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RANKING ──

router.get('/etapas/:id/ranking', async (req, res) => {
  const etapaId = req.params.id;
  try {
    const { rows: teams } = await pool.query(`
      SELECT et.id as team_id, gt.nome as team_nome
      FROM etapa_teams et
      JOIN global_teams gt ON et.global_team_id = gt.id
      JOIN etapas e ON et.etapa_id = e.id
      WHERE et.etapa_id = $1 AND e.user_id = $2
      ORDER BY et.id
    `, [etapaId, uid(req)]);

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

      ranking.push({
        team_id: team.team_id,
        team_nome: team.team_nome,
        qualifying_points: parseInt(qp.total),
        final_points: parseInt(fp.total),
        total_points: parseInt(qp.total) + parseInt(fp.total)
      });
    }

    ranking.sort((a, b) => b.total_points - a.total_points);
    res.json(ranking);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
