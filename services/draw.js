export function executeDraw(teams, playersPerTeam = 4, playersPerTable = 8) {
  const N = teams.length;

  if (N < 2) throw new Error('Precisa de pelo menos 2 equipes para o sorteio');

  for (const team of teams) {
    if (team.players.length !== playersPerTeam) {
      throw new Error(`Equipe "${team.nome}" não tem ${playersPerTeam} jogadores (tem ${team.players.length})`);
    }
  }

  const totalPlayers = N * playersPerTeam;
  const numTables = Math.ceil(totalPlayers / playersPerTable);

  // Monta fila intercalando jogadores por equipe (equipe0j0, equipe1j0, ..., equipe0j1, ...)
  // para maximizar a distribuição entre equipes nas mesas
  const shuffledTeams = teams.map(team => ({
    ...team,
    players: shuffle([...team.players])
  }));

  const queue = [];
  for (let j = 0; j < playersPerTeam; j++) {
    const round = shuffledTeams.map(t => ({
      ...t.players[j],
      team_id: t.id,
      team_nome: t.nome
    }));
    queue.push(...shuffle(round));
  }

  const tables = Array.from({ length: numTables }, (_, i) => ({
    numero: i + 1,
    players: []
  }));

  // Distribui em round-robin pelas mesas
  queue.forEach((player, idx) => {
    tables[idx % numTables].players.push(player);
  });

  for (const table of tables) {
    table.players = shuffle(table.players);
  }

  return tables;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
