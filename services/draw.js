export function executeDraw(teams) {
  const N = teams.length;

  if (N < 2) throw new Error('Precisa de pelo menos 2 equipes para o sorteio');

  for (const team of teams) {
    if (team.players.length !== 4) {
      throw new Error(`Equipe "${team.nome}" não tem 4 jogadores (tem ${team.players.length})`);
    }
  }

  const shuffledTeams = teams.map(team => ({
    ...team,
    players: shuffle([...team.players])
  }));

  const tables = Array.from({ length: N }, (_, i) => ({
    numero: i + 1,
    players: []
  }));

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 4; j++) {
      const tableIndex = (i + j) % N;
      tables[tableIndex].players.push({
        ...shuffledTeams[i].players[j],
        team_id: shuffledTeams[i].id,
        team_nome: shuffledTeams[i].nome
      });
    }
  }

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
