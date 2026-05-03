import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { executeDraw } from '../services/draw.js';
import { getQualifyingPoints, getFinalPoints, eliminationToPosition } from '../services/scoring.js';

const router = Router();
router.use(requireAuth);

// ── ETAPAS ──

router.get('/etapas', (req, res) => {
  const etapas = db.prepare('SELECT * FROM etapas ORDER BY id DESC').all();
  res.json(etapas);
});

router.post('/etapas', (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });

  const result = db.prepare('INSERT INTO etapas (nome) VALUES (?)').run(nome);
  const etapaId = result.lastInsertRowid;

  const globalTeams = db.prepare('SELECT id FROM global_teams').all();
  const insertEtapaTeam = db.prepare(
    'INSERT OR IGNORE INTO etapa_teams (etapa_id, global_team_id, registration_token) VALUES (?, ?, ?)'
  );
  db.transaction(() => {
    for (const gt of globalTeams) {
      insertEtapaTeam.run(etapaId, gt.id, crypto.randomUUID());
    }
  })();

  res.json({ id: etapaId, nome, status: 'registration' });
});

router.patch('/etapas/:id', (req, res) => {
  const { status } = req.body;
  const valid = ['registration', 'qualifying', 'final', 'finished'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Status inválido' });
  db.prepare('UPDATE etapas SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

router.delete('/etapas/:id', (req, res) => {
  const etapaId = req.params.id;

  const tableIds = db.prepare('SELECT id FROM tables_t WHERE etapa_id = ?').all(etapaId).map(r => r.id);
  if (tableIds.length > 0) {
    const ph = tableIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM seats WHERE table_id IN (${ph})`).run(...tableIds);
  }
  db.prepare('DELETE FROM tables_t WHERE etapa_id = ?').run(etapaId);

  const etapaTeamIds = db.prepare('SELECT id FROM etapa_teams WHERE etapa_id = ?').all(etapaId).map(r => r.id);
  if (etapaTeamIds.length > 0) {
    const ph = etapaTeamIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM players WHERE etapa_team_id IN (${ph})`).run(...etapaTeamIds);
  }
  db.prepare('DELETE FROM etapa_teams WHERE etapa_id = ?').run(etapaId);
  db.prepare('DELETE FROM etapas WHERE id = ?').run(etapaId);
  res.json({ ok: true });
});

// ── TEAMS ──

router.get('/etapas/:id/teams', (req, res) => {
  const teams = db.prepare(`
    SELECT et.id, et.registration_token, gt.nome, gt.id as global_team_id
    FROM etapa_teams et
    JOIN global_teams gt ON et.global_team_id = gt.id
    WHERE et.etapa_id = ?
    ORDER BY et.id
  `).all(req.params.id);

  for (const team of teams) {
    team.players = db.prepare(
      'SELECT * FROM players WHERE etapa_team_id = ? ORDER BY id'
    ).all(team.id);
  }
  res.json(teams);
});

router.post('/etapas/:id/teams', (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome da equipe obrigatório' });

  let gt = db.prepare('SELECT id FROM global_teams WHERE nome = ?').get(nome);
  if (!gt) {
    const r = db.prepare('INSERT INTO global_teams (nome) VALUES (?)').run(nome);
    gt = { id: r.lastInsertRowid };
  }

  const existing = db.prepare(
    'SELECT id FROM etapa_teams WHERE etapa_id = ? AND global_team_id = ?'
  ).get(req.params.id, gt.id);
  if (existing) return res.status(400).json({ error: 'Equipe já adicionada nesta etapa' });

  const token = crypto.randomUUID();
  const r = db.prepare(
    'INSERT INTO etapa_teams (etapa_id, global_team_id, registration_token) VALUES (?, ?, ?)'
  ).run(req.params.id, gt.id, token);

  res.json({ id: r.lastInsertRowid, nome, registration_token: token });
});

router.delete('/teams/:id', (req, res) => {
  db.prepare('DELETE FROM players WHERE etapa_team_id = ?').run(req.params.id);
  db.prepare('DELETE FROM etapa_teams WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── DRAW ──

router.post('/etapas/:id/draw', (req, res) => {
  const etapaId = req.params.id;
  const etapa = db.prepare('SELECT * FROM etapas WHERE id = ?').get(etapaId);
  if (!etapa) return res.status(404).json({ error: 'Etapa não encontrada' });

  const existing = db.prepare(
    'SELECT COUNT(*) as count FROM tables_t WHERE etapa_id = ? AND phase = ?'
  ).get(etapaId, 'qualifying');
  if (existing.count > 0) return res.status(400).json({ error: 'Sorteio já realizado. Apague as mesas antes de sortear novamente.' });

  const teams = db.prepare(`
    SELECT et.id, gt.nome
    FROM etapa_teams et
    JOIN global_teams gt ON et.global_team_id = gt.id
    WHERE et.etapa_id = ?
  `).all(etapaId);

  for (const team of teams) {
    team.players = db.prepare(
      'SELECT * FROM players WHERE etapa_team_id = ? ORDER BY id'
    ).all(team.id);
  }

  try {
    const tables = executeDraw(teams);

    const insertTable = db.prepare('INSERT INTO tables_t (etapa_id, numero, phase) VALUES (?, ?, ?)');
    const insertSeat = db.prepare('INSERT INTO seats (table_id, player_id) VALUES (?, ?)');

    db.transaction(() => {
      for (const table of tables) {
        const result = insertTable.run(etapaId, table.numero, 'qualifying');
        const tableId = result.lastInsertRowid;
        for (const player of table.players) {
          insertSeat.run(tableId, player.id);
        }
      }
    })();

    db.prepare('UPDATE etapas SET status = ? WHERE id = ?').run('qualifying', etapaId);
    res.json({ ok: true, tables: tables.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/etapas/:id/tables', (req, res) => {
  const etapaId = req.params.id;
  const tableIds = db.prepare('SELECT id FROM tables_t WHERE etapa_id = ?').all(etapaId).map(r => r.id);
  if (tableIds.length > 0) {
    const ph = tableIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM seats WHERE table_id IN (${ph})`).run(...tableIds);
  }
  db.prepare('DELETE FROM tables_t WHERE etapa_id = ?').run(etapaId);
  db.prepare('UPDATE etapas SET status = ? WHERE id = ?').run('registration', etapaId);
  res.json({ ok: true });
});

// ── TABLES & SEATS ──

router.get('/etapas/:id/tables', (req, res) => {
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

router.patch('/seats/:id/eliminate', (req, res) => {
  const rawOrder = Number(req.body?.elimination_order);
  if (!Number.isInteger(rawOrder) || rawOrder < 1) {
    return res.status(400).json({ error: 'Ordem de eliminação inválida' });
  }

  const seat = db.prepare(
    'SELECT s.*, t.phase, t.etapa_id FROM seats s JOIN tables_t t ON s.table_id = t.id WHERE s.id = ?'
  ).get(req.params.id);
  if (!seat) return res.status(404).json({ error: 'Seat não encontrado' });

  const etapa = db.prepare('SELECT status FROM etapas WHERE id = ?').get(seat.etapa_id);
  if (etapa && etapa.status === 'finished') return res.status(400).json({ error: 'Etapa encerrada. Valores congelados.' });
  if (seat.elimination_order !== null) return res.status(400).json({ error: 'Jogador já eliminado nesta mesa' });

  const expectedOrder = db.prepare(
    'SELECT COUNT(*) as count FROM seats WHERE table_id = ? AND elimination_order IS NOT NULL'
  ).get(seat.table_id).count + 1;

  if (rawOrder !== expectedOrder) {
    return res.status(409).json({ error: `Ordem inválida. Use a ordem ${expectedOrder}` });
  }

  const totalPlayers = db.prepare('SELECT COUNT(*) as count FROM seats WHERE table_id = ?').get(seat.table_id).count;
  if (rawOrder > totalPlayers) return res.status(400).json({ error: 'Ordem acima do total de jogadores da mesa' });

  const position = eliminationToPosition(rawOrder, totalPlayers);
  const points = seat.phase === 'qualifying' ? getQualifyingPoints(position) : getFinalPoints(position);

  db.prepare('UPDATE seats SET elimination_order = ?, points = ? WHERE id = ?').run(rawOrder, points, req.params.id);
  res.json({ ok: true, position, points });
});

router.patch('/seats/:id/clear', (req, res) => {
  const seat = db.prepare(
    'SELECT s.*, t.etapa_id FROM seats s JOIN tables_t t ON s.table_id = t.id WHERE s.id = ?'
  ).get(req.params.id);
  if (seat) {
    const etapa = db.prepare('SELECT status FROM etapas WHERE id = ?').get(seat.etapa_id);
    if (etapa && etapa.status === 'finished') return res.status(400).json({ error: 'Etapa encerrada. Valores congelados.' });
  }
  db.prepare('UPDATE seats SET elimination_order = NULL, points = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── FINAL TABLE ──

router.post('/etapas/:id/final', (req, res) => {
  const etapaId = req.params.id;
  const { representatives } = req.body;

  if (!representatives || representatives.length < 1) {
    return res.status(400).json({ error: 'Precisa de pelo menos 1 representante' });
  }

  const existing = db.prepare(
    'SELECT COUNT(*) as count FROM tables_t WHERE etapa_id = ? AND phase = ?'
  ).get(etapaId, 'final');
  if (existing.count > 0) return res.status(400).json({ error: 'Mesa final já criada' });

  const insertTable = db.prepare('INSERT INTO tables_t (etapa_id, numero, phase) VALUES (?, ?, ?)');
  const insertSeat = db.prepare('INSERT INTO seats (table_id, player_id) VALUES (?, ?)');

  db.transaction(() => {
    const result = insertTable.run(etapaId, 1, 'final');
    const tableId = result.lastInsertRowid;
    for (const rep of representatives) {
      insertSeat.run(tableId, rep.player_id);
    }
  })();

  db.prepare('UPDATE etapas SET status = ? WHERE id = ?').run('final', etapaId);
  res.json({ ok: true });
});

// ── RANKING ──

router.get('/etapas/:id/ranking', (req, res) => {
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
    const qualifyingPoints = db.prepare(`
      SELECT COALESCE(SUM(s.points), 0) as total
      FROM seats s JOIN tables_t t ON s.table_id = t.id JOIN players p ON s.player_id = p.id
      WHERE p.etapa_team_id = ? AND t.etapa_id = ? AND t.phase = 'qualifying'
    `).get(team.team_id, etapaId);

    const finalPoints = db.prepare(`
      SELECT COALESCE(SUM(s.points), 0) as total
      FROM seats s JOIN tables_t t ON s.table_id = t.id JOIN players p ON s.player_id = p.id
      WHERE p.etapa_team_id = ? AND t.etapa_id = ? AND t.phase = 'final'
    `).get(team.team_id, etapaId);

    ranking.push({
      team_id: team.team_id,
      team_nome: team.team_nome,
      qualifying_points: qualifyingPoints.total,
      final_points: finalPoints.total,
      total_points: qualifyingPoints.total + finalPoints.total
    });
  }

  ranking.sort((a, b) => b.total_points - a.total_points);
  res.json(ranking);
});

export default router;
