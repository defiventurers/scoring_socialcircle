export const TOURNAMENT_FORMATS = [
  'mixed-americano',
  'americano',
  'mexicano',
  'round-robin',
  'king-of-the-court',
  'ladder-league',
  'pool-play',
  'single-elimination',
  'double-elimination',
  'swiss',
  'custom',
];

function calculateIndividualLeaderboard(matches) {
  const rows = new Map();
  const addPlayer = (name, scored, conceded, won, lost, drawn) => {
    if (!rows.has(name)) rows.set(name, { player: name, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, pointsScored: 0, pointsConceded: 0, pointDifference: 0, averagePoints: 0 });
    const row = rows.get(name);
    row.gamesPlayed += 1;
    row.wins += won ? 1 : 0;
    row.losses += lost ? 1 : 0;
    row.draws += drawn ? 1 : 0;
    row.pointsScored += scored;
    row.pointsConceded += conceded;
    row.pointDifference = row.pointsScored - row.pointsConceded;
    row.averagePoints = row.gamesPlayed ? Number((row.pointsScored / row.gamesPlayed).toFixed(2)) : 0;
  };

  for (const match of matches.filter((m) => m.status === 'finalized')) {
    const a = Number(match.teamAScore || 0);
    const b = Number(match.teamBScore || 0);
    const draw = a === b;
    for (const player of match.teamA || []) addPlayer(player, a, b, a > b, a < b, draw);
    for (const player of match.teamB || []) addPlayer(player, b, a, b > a, b < a, draw);
  }

  return [...rows.values()].sort((a, b) =>
    b.pointsScored - a.pointsScored || b.wins - a.wins || b.pointDifference - a.pointDifference || a.player.localeCompare(b.player),
  );
}

const baseRuleSet = {
  id: 'base',
  fixtureGenerator: 'database',
  rotationLogic: 'configured',
  courtAssignment: 'configured',
  scoring: { pointsToWin: 15, winBy: 1, allowTies: false },
  tieBreakers: ['pointsScored', 'wins', 'pointDifference', 'displayName'],
  calculateLeaderboard: calculateIndividualLeaderboard,
};

const registry = new Map();
export function registerTournamentFormat(format, ruleSet = {}) {
  if (!TOURNAMENT_FORMATS.includes(format)) throw new Error(`Unsupported tournament format: ${format}`);
  registry.set(format, { ...baseRuleSet, id: format, ...ruleSet });
}
for (const format of TOURNAMENT_FORMATS) registerTournamentFormat(format);

export function getTournamentRuleSet(format = 'mixed-americano') {
  return registry.get(format) || registry.get('custom');
}

export function calculateLeaderboardForTournament(tournament, matches) {
  return getTournamentRuleSet(tournament?.format).calculateLeaderboard(matches);
}
