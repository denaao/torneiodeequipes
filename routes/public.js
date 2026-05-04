import { Router } from 'express';
import pool from '../database.js';

const router = Router();

// ── REGISTRO DE EQUIPES (público via token) ──

router.get('/register/:token', async (req, res) => {
  try {
    const { rows: [etapaTeam] } = await pool.query(`
      SELECT et.id, et.etapa_id, gt.nome, e.nome as etapa_nome, e.status as etapa_status,
             et.registration_token, e.players_per_team
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
      SELECT et.id, e.status as etapa_status, e.players_per_team
      FROM etapa_teams et
      JOIN etapas e ON et.etapa_id = e.id
      WHERE et.registration_token = $1
    `, [req.params.token]);

    if (!etapaTeam) return res.status(404).json({ error: 'Link inválido' });
    if (etapaTeam.etapa_status !== 'registration') return res.status(400).json({ error: 'Inscrições encerradas' });

    const ppt = etapaTeam.players_per_team || 4;
    const { players } = req.body;
    if (!players || players.length !== ppt) return res.status(400).json({ error: `Precisa de exatamente ${ppt} jogadores` });
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

router.get('/public/etapas/:id/report', async (req, res) => {
  const etapaId = req.params.id;
  try {
    const { rows: [etapa] } = await pool.query(
      'SELECT id, nome, status FROM etapas WHERE id = $1', [etapaId]
    );
    if (!etapa) return res.status(404).send('<h1>Etapa não encontrada</h1>');

    const statusLabel = { registration: 'Inscrições', qualifying: 'Classificatória', final: 'Mesa Final', finished: 'Encerrada' }[etapa.status] || etapa.status;

    // Ranking
    const { rows: teams } = await pool.query(`
      SELECT et.id as team_id, gt.nome as team_nome
      FROM etapa_teams et JOIN global_teams gt ON et.global_team_id = gt.id
      WHERE et.etapa_id = $1 ORDER BY et.id
    `, [etapaId]);

    const ranking = [];
    for (const team of teams) {
      const qp = (await pool.query(`
        SELECT COALESCE(SUM(s.points),0) as total FROM seats s
        JOIN tables_t t ON s.table_id=t.id JOIN players p ON s.player_id=p.id
        WHERE p.etapa_team_id=$1 AND t.etapa_id=$2 AND t.phase='qualifying'
      `, [team.team_id, etapaId])).rows[0];
      const fp = (await pool.query(`
        SELECT COALESCE(SUM(s.points),0) as total FROM seats s
        JOIN tables_t t ON s.table_id=t.id JOIN players p ON s.player_id=p.id
        WHERE p.etapa_team_id=$1 AND t.etapa_id=$2 AND t.phase='final'
      `, [team.team_id, etapaId])).rows[0];

      // Pontuação individual por jogador
      const { rows: playerStats } = await pool.query(`
        SELECT p.nome as player_nome,
          COALESCE(SUM(CASE WHEN t.phase='qualifying' THEN s.points ELSE 0 END),0) as qualifying,
          COALESCE(SUM(CASE WHEN t.phase='final' THEN s.points ELSE 0 END),0) as final,
          COALESCE(SUM(s.points),0) as total
        FROM players p
        LEFT JOIN seats s ON s.player_id=p.id
        LEFT JOIN tables_t t ON s.table_id=t.id AND t.etapa_id=$2
        WHERE p.etapa_team_id=$1
        GROUP BY p.id, p.nome
        ORDER BY total DESC, p.nome
      `, [team.team_id, etapaId]);

      ranking.push({
        nome: team.team_nome,
        qualifying: parseInt(qp.total),
        final: parseInt(fp.total),
        total: parseInt(qp.total) + parseInt(fp.total),
        players: playerStats
      });
    }
    ranking.sort((a, b) => b.total - a.total);

    // Mesas
    const { rows: tables } = await pool.query(
      'SELECT * FROM tables_t WHERE etapa_id=$1 ORDER BY phase DESC, numero', [etapaId]
    );
    for (const t of tables) {
      const { rows } = await pool.query(`
        SELECT p.nome as player_nome, gt.nome as team_nome, s.points, s.elimination_order
        FROM seats s JOIN players p ON s.player_id=p.id
        JOIN etapa_teams et ON p.etapa_team_id=et.id
        JOIN global_teams gt ON et.global_team_id=gt.id
        WHERE s.table_id=$1 ORDER BY s.elimination_order DESC NULLS LAST, s.id
      `, [t.id]);
      t.seats = rows;
    }

    const phaseLabel = p => p === 'final' ? 'Mesa Final' : 'Classificatória';

    const rankingRows = ranking.map((t, i) => `
      <tr>
        <td>${i + 1}º</td>
        <td><strong>${t.nome}</strong></td>
        <td>${t.qualifying}</td>
        <td>${t.final}</td>
        <td><strong>${t.total}</strong></td>
      </tr>`).join('');

    const teamDetailCards = ranking.map((t, i) => {
      const playerRows = t.players.map(p => `
        <tr>
          <td>${p.player_nome}</td>
          <td style="text-align:center">${p.qualifying}</td>
          <td style="text-align:center">${p.final}</td>
          <td style="text-align:center"><strong>${p.total}</strong></td>
        </tr>`).join('');
      return `
      <div class="team-card">
        <div class="team-title"><span class="pos">${i + 1}º</span> ${t.nome} <span class="team-total">${t.total} pts</span></div>
        <table class="inner-table">
          <thead><tr><th>Jogador</th><th>Class.</th><th>Final</th><th>Total</th></tr></thead>
          <tbody>${playerRows}</tbody>
        </table>
      </div>`;
    }).join('');

    const tableCards = tables.map(t => {
      const seats = t.seats.map(s => `
        <tr>
          <td>${s.player_nome}</td>
          <td style="color:#aaa;font-size:.85rem">${s.team_nome}</td>
          <td style="text-align:center">${s.points ?? '—'}</td>
          <td style="text-align:center">${s.elimination_order ?? '—'}</td>
        </tr>`).join('');
      return `
      <div class="mesa-card">
        <div class="mesa-title">${phaseLabel(t.phase)} — Mesa ${t.numero}</div>
        <table class="inner-table">
          <thead><tr><th>Jogador</th><th>Equipe</th><th>Pts</th><th>Elim.</th></tr></thead>
          <tbody>${seats}</tbody>
        </table>
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Relatório — ${etapa.nome}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;background:#0d0d0d;color:#eee;padding:2rem 1rem}
    h1{font-size:1.8rem;color:#f5c800;margin-bottom:.25rem}
    .sub{color:#888;font-size:.9rem;margin-bottom:2rem}
    h2{font-size:1.1rem;color:#f5c800;margin:2rem 0 .75rem;text-transform:uppercase;letter-spacing:1px}
    table{width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden;margin-bottom:2rem}
    th{background:#111;color:#888;font-size:.75rem;text-transform:uppercase;padding:.6rem .8rem;text-align:left}
    td{padding:.6rem .8rem;border-bottom:1px solid rgba(255,255,255,.06);font-size:.9rem}
    tr:last-child td{border-bottom:none}
    tr:first-child td{color:#f5c800;font-weight:700}
    .mesas{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem}
    .mesa-card{background:#1a1a1a;border-radius:8px;overflow:hidden}
    .mesa-title{background:#111;padding:.6rem 1rem;font-size:.85rem;font-weight:600;color:#f5c800;text-transform:uppercase;letter-spacing:.5px}
    .teams-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem}
    .team-card{background:#1a1a1a;border-radius:8px;overflow:hidden}
    .team-title{background:#111;padding:.6rem 1rem;font-size:.9rem;font-weight:700;color:#fff;display:flex;align-items:center;gap:.5rem}
    .team-title .pos{color:#f5c800;font-size:1rem;min-width:1.5rem}
    .team-title .team-total{margin-left:auto;color:#f5c800;font-size:.82rem}
    .inner-table{width:100%;border-collapse:collapse}
    .inner-table th{background:transparent;padding:.5rem .8rem;font-size:.72rem}
    .inner-table td{padding:.5rem .8rem;border-bottom:1px solid rgba(255,255,255,.05);font-size:.85rem}
    .inner-table tr:last-child td{border-bottom:none}
    footer{margin-top:3rem;color:#555;font-size:.75rem;text-align:center}
    @media print{body{background:#fff;color:#000}.mesa-card,.team-card,.inner-table td,.inner-table th,td,th{color:#000!important;background:#fff!important;border-color:#ccc!important}h1,.mesa-title,.team-title,h2{color:#000!important}.team-title .pos,.team-title .team-total{color:#000!important}}
  </style>
</head>
<body>
  <h1>${etapa.nome}</h1>
  <div class="sub">Status: ${statusLabel} &nbsp;|&nbsp; Gerado em ${new Date().toLocaleString('pt-BR')}</div>

  <h2>Ranking</h2>
  <table>
    <thead><tr><th>#</th><th>Equipe</th><th>Pts Class.</th><th>Pts Final</th><th>Total</th></tr></thead>
    <tbody>${rankingRows}</tbody>
  </table>

  <h2>Desempenho por Equipe</h2>
  <div class="teams-grid">${teamDetailCards}</div>

  <h2>Mesas</h2>
  <div class="mesas">${tableCards}</div>

  <footer>torneiodeequipes.com.br</footer>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) { res.status(500).send(`<pre>${e.message}</pre>`); }
});

export default router;
