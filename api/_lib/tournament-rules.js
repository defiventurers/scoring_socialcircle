export const TOURNAMENT_TYPES = ['mixed-doubles', 'mens-doubles', 'womens-doubles'];

export const TOURNAMENT_FORMATS = [
  'mixed-americano', 'americano', 'mexicano', 'round-robin', 'king-of-the-court',
  'ladder-league', 'pool-play', 'single-elimination', 'double-elimination', 'swiss', 'custom',
];

const FORMAT_DEFINITIONS = {
  'mixed-americano': { name: 'Mixed Americano', description: 'Individual mixed-doubles social where partners and opponents rotate.', howItWorks: 'Each round forms one woman and one man per team. The rotation spreads partnerships and opponents across the roster.', rotation: 'Partners change every round; every team is mixed.', winner: 'Individual points scored, then wins, point difference and name.', bestUse: 'Balanced mixed socials where every player enters individually.', mode: 'rotating', ranking: 'individual', tieBreakers: ['pointsScored', 'wins', 'pointDifference', 'player'] },
  americano: { name: 'Americano', description: 'Individual doubles event with rotating partners and opponents.', howItWorks: 'Players rotate through balanced groups of four and receive their team score as individual tournament points.', rotation: 'Partners and opponents change every round without a gender constraint.', winner: 'Individual points scored, then wins, point difference and name.', bestUse: 'Social events where players register individually.', mode: 'rotating', ranking: 'individual', tieBreakers: ['pointsScored', 'wins', 'pointDifference', 'player'] },
  mexicano: { name: 'Mexicano', description: 'Adaptive Americano that groups players by current performance.', howItWorks: 'Round one is seeded. Later rounds group adjacent players in the live standings so similarly performing players meet.', rotation: 'Within each ranked group of four, first partners fourth and second partners third.', winner: 'Individual points, then wins, point difference, strength of schedule and name.', bestUse: 'Competitive socials that should become more even each round.', mode: 'adaptive-individual', ranking: 'individual', tieBreakers: ['pointsScored', 'wins', 'pointDifference', 'strengthOfSchedule', 'player'] },
  'round-robin': { name: 'Round Robin', description: 'Fixed doubles teams play every other team once.', howItWorks: 'Teams are fixed before play and a circle schedule creates every unique team matchup.', rotation: 'No partner rotation; only opponents rotate.', winner: 'Team wins, then head-to-head, point difference, points scored and team name.', bestUse: 'Small fields where every team should meet.', mode: 'fixed-round-robin', ranking: 'team', tieBreakers: ['wins', 'headToHead', 'pointDifference', 'pointsScored', 'team'] },
  'king-of-the-court': { name: 'King of the Court', description: 'Court ladder where winners move up and losers move down.', howItWorks: 'Initial teams are seeded by court. After every completed round winners rise one court and losers fall one court.', rotation: 'Teams stay fixed; court position changes after each result.', winner: 'Highest court points, then wins, point difference and points scored.', bestUse: 'Fast club sessions with continuous promotion and relegation.', mode: 'king-of-court', ranking: 'court', tieBreakers: ['courtPoints', 'wins', 'pointDifference', 'pointsScored', 'team'] },
  'ladder-league': { name: 'Ladder League', description: 'Fixed teams challenge nearby teams in a ranked ladder.', howItWorks: 'Adjacent teams play; a lower-ranked winner moves immediately above the defeated team for the next round.', rotation: 'Teams stay fixed and opponents follow persistent ladder position.', winner: 'Ladder position, then wins, point difference and points scored.', bestUse: 'Recurring leagues where teams should face close rivals.', mode: 'ladder', ranking: 'ladder', tieBreakers: ['ladderPosition', 'wins', 'pointDifference', 'pointsScored', 'team'] },
  'pool-play': { name: 'Pool Play', description: 'Fixed teams play round robins inside seeded pools.', howItWorks: 'Teams are snake-seeded into pools and play every team in their pool.', rotation: 'Partners stay fixed; opponents rotate inside the pool.', winner: 'Pool wins, head-to-head, point difference and points scored.', bestUse: 'Larger events needing balanced qualification groups.', mode: 'pool', ranking: 'pool-team', tieBreakers: ['poolWins', 'headToHead', 'pointDifference', 'pointsScored', 'team'] },
  'single-elimination': { name: 'Single Elimination', description: 'A knockout bracket where one loss eliminates a team.', howItWorks: 'Teams are seeded into a power-of-two bracket, byes advance automatically, and winners progress until one champion remains.', rotation: 'Fixed teams; bracket winners determine the next opponents.', winner: 'The undefeated winner of the final; placement then uses round reached and seed.', bestUse: 'Time-limited championship events with a decisive winner.', mode: 'single-elimination', ranking: 'elimination', tieBreakers: ['losses', 'roundReached', 'wins', 'seed'] },
  'double-elimination': { name: 'Double Elimination', description: 'Knockout competition where a team is eliminated after two losses.', howItWorks: 'Undefeated teams remain in the winners bracket; one-loss teams continue in the losers bracket. A team exits only after its second loss.', rotation: 'Fixed teams; each bracket pairs by record while avoiding rematches where possible.', winner: 'Last team with fewer than two losses, then wins and seed.', bestUse: 'Championships where every team deserves a second chance.', mode: 'double-elimination', ranking: 'elimination', tieBreakers: ['losses', 'wins', 'roundReached', 'seed'] },
  swiss: { name: 'Swiss', description: 'Fixed teams play opponents with similar records without full elimination.', howItWorks: 'Each round pairs teams in the same or nearest score group, avoiding repeat opponents whenever a valid alternative exists.', rotation: 'Teams stay fixed; opponents are selected from live score groups.', winner: 'Match points, Buchholz opponent score, point difference, points scored and seed.', bestUse: 'Large fields needing meaningful rankings in relatively few rounds.', mode: 'swiss', ranking: 'swiss', tieBreakers: ['matchPoints', 'buchholz', 'pointDifference', 'pointsScored', 'seed'] },
  custom: { name: 'Custom', description: 'Configurable rotating doubles schedule using the tournament scoring settings.', howItWorks: 'Players rotate through deterministic groups of four for the configured number of rounds.', rotation: 'Partners rotate by seed; admins control rounds, courts and target score.', winner: 'Individual wins, then point difference, points scored and name.', bestUse: 'House rules and informal formats that do not fit a standard structure.', mode: 'custom', ranking: 'individual', tieBreakers: ['wins', 'pointDifference', 'pointsScored', 'player'] },
};

export function getFormatDefinitions() { return Object.fromEntries(Object.entries(FORMAT_DEFINITIONS).map(([id, value]) => [id, { id, ...value }])); }
export function getTournamentRuleSet(format = 'mixed-americano') { return { id: format, ...(FORMAT_DEFINITIONS[format] || FORMAT_DEFINITIONS.custom), scoring: { allowTies: false } }; }

function teamKey(team = []) { return [...team].sort().join(' + '); }
function winnerTeam(match) { return Number(match.teamAScore) > Number(match.teamBScore) ? match.teamA : match.teamB; }
function loserTeam(match) { return Number(match.teamAScore) > Number(match.teamBScore) ? match.teamB : match.teamA; }
function pairFixedTeams(players, type) {
  if (type === 'mixed-doubles') {
    const men = players.filter((p) => p.gender === 'men');
    const women = players.filter((p) => p.gender === 'women');
    if (men.length !== women.length) throw new Error('Mixed Doubles requires equal numbers of men and women.');
    return men.map((man, index) => [man.label, women[index].label]);
  }
  return Array.from({ length: Math.floor(players.length / 2) }, (_, index) => [players[index * 2].label, players[index * 2 + 1].label]);
}
function scheduleTime(round, settings = {}) {
  const minutes = Number(settings.startHour || 11) * 60 + (round - 1) * Number(settings.intervalMinutes || 8);
  const hour = Math.floor(minutes / 60) % 24;
  return `${((hour + 11) % 12) + 1}:${String(minutes % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
function fixture(tournament, round, court, teamA, teamB, metadata = {}) {
  return { id: `${tournament.id}_court${court}_round${round}`, event_id: tournament.id, tournament_id: tournament.id, court, round, scheduled_time: scheduleTime(round, tournament.settings), team_a: teamA, team_b: teamB, metadata };
}
function stageFixtures(tournament, pairs, stage, startRound, baseMetadata = {}) {
  const courts = Number(tournament.numberOfCourts || 1);
  return pairs.map((pair, index) => {
    const round = startRound + Math.floor(index / courts);
    return fixture(tournament, round, (index % courts) + 1, pair.teamA || pair[0], pair.teamB || pair[1], { ...baseMetadata, ...(pair.metadata || {}), stage, pairingIndex: index });
  });
}
function rotatingRound(players, round, mixed) {
  const labels = players.map((p) => p.label);
  if (mixed) {
    const men = players.filter((p) => p.gender === 'men').map((p) => p.label);
    const women = players.filter((p) => p.gender === 'women').map((p) => p.label);
    const shifted = women.map((_, index) => women[(index + round - 1) % women.length]);
    return men.map((man, index) => [man, shifted[index]]);
  }
  const ring = labels.slice(1);
  const rotated = ring.map((_, index) => ring[(index + round - 1) % ring.length]);
  const all = [labels[0], ...rotated];
  return all.slice(0, all.length / 2).map((label, index) => [label, all[all.length - 1 - index]]);
}
function roundRobinPairs(teams) {
  const list = [...teams]; if (list.length % 2) list.push(null);
  const rounds = [];
  for (let round = 0; round < list.length - 1; round += 1) {
    const pairs = [];
    for (let i = 0; i < list.length / 2; i += 1) if (list[i] && list[list.length - 1 - i]) pairs.push([list[i], list[list.length - 1 - i]]);
    rounds.push(pairs); list.splice(1, 0, list.pop());
  }
  return rounds;
}
function materializeRounds(tournament, rounds, metadataFor = () => ({})) {
  let physicalRound = 1; const fixtures = [];
  rounds.forEach((pairs, stage) => {
    const generated = stageFixtures(tournament, pairs.map((pair, index) => ({ teamA: pair[0], teamB: pair[1], metadata: metadataFor(stage + 1, index, pair) })), stage + 1, physicalRound);
    fixtures.push(...generated);
    physicalRound = Math.max(physicalRound, ...generated.map((m) => m.round)) + 1;
  });
  return fixtures;
}

function standingsRows(matches, asTeams) {
  const rows = new Map();
  const add = (key, score, against, opponent, seed = 999) => {
    if (!rows.has(key)) rows.set(key, { player: key, team: key, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, pointsScored: 0, pointsConceded: 0, pointDifference: 0, matchPoints: 0, opponents: [], seed, roundReached: 0, courtPoints: 0, ladderPosition: 999 });
    const row = rows.get(key); row.gamesPlayed += 1; row.wins += score > against ? 1 : 0; row.losses += score < against ? 1 : 0; row.draws += score === against ? 1 : 0; row.pointsScored += score; row.pointsConceded += against; row.pointDifference = row.pointsScored - row.pointsConceded; row.matchPoints += score > against ? 3 : score === against ? 1 : 0; row.opponents.push(opponent); row.seed = Math.min(row.seed, seed); row.roundReached = Math.max(row.roundReached, Number(row.gamesPlayed));
  };
  const finalized = matches.filter((m) => m.status === 'finalized');
  for (const match of finalized) {
    const a = Number(match.teamAScore || 0), b = Number(match.teamBScore || 0);
    const left = asTeams ? [teamKey(match.teamA)] : (match.teamA || []); const right = asTeams ? [teamKey(match.teamB)] : (match.teamB || []);
    left.forEach((key) => add(key, a, b, right[0], Number(match.metadata?.teamASeed || 999)));
    right.forEach((key) => add(key, b, a, left[0], Number(match.metadata?.teamBSeed || 999)));
  }
  const byeAwards = new Map();
  for (const match of matches) {
    const bye = match.metadata?.swissByeTeam;
    const stage = match.metadata?.stage;
    if (bye && stage && !byeAwards.has(`${stage}:${teamKey(bye)}`)) byeAwards.set(`${stage}:${teamKey(bye)}`, bye);
  }
  for (const team of byeAwards.values()) {
    const key = teamKey(team);
    if (!rows.has(key)) rows.set(key, { player: key, team: key, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, pointsScored: 0, pointsConceded: 0, pointDifference: 0, matchPoints: 0, opponents: [], seed: 999, roundReached: 0, courtPoints: 0, ladderPosition: 999 });
    const row = rows.get(key); row.gamesPlayed += 1; row.wins += 1; row.matchPoints += 3; row.roundReached += 1;
  }
  for (const row of rows.values()) row.averagePoints = row.gamesPlayed ? Number((row.pointsScored / row.gamesPlayed).toFixed(2)) : 0;
  if (asTeams) {
    const latestOrder = [...matches].sort((a, b) => Number(b.metadata?.stage || 0) - Number(a.metadata?.stage || 0)).find((match) => Array.isArray(match.metadata?.ladderOrder))?.metadata?.ladderOrder;
    if (Array.isArray(latestOrder)) latestOrder.forEach((key, index) => { if (rows.has(key)) rows.get(key).ladderPosition = index + 1; });
    for (const match of finalized) {
      const court = Number(match.metadata?.courtPosition || match.court);
      const topCourt = Math.max(1, Number(match.metadata?.courtCount || 1));
      const award = Math.max(1, topCourt - court + 1);
      const key = teamKey(winnerTeam(match)); if (rows.has(key)) rows.get(key).courtPoints += award;
    }
  }
  return rows;
}

function directMetrics(row, peers, matches, asTeams) {
  let wins = 0; let pointDifference = 0;
  const peerKeys = new Set(peers.map((peer) => peer.player));
  for (const match of matches.filter((item) => item.status === 'finalized')) {
    const left = asTeams ? [teamKey(match.teamA)] : match.teamA; const right = asTeams ? [teamKey(match.teamB)] : match.teamB;
    const onLeft = left.includes(row.player); const onRight = right.includes(row.player);
    if (!onLeft && !onRight) continue;
    const opponents = onLeft ? right : left;
    if (!opponents.some((opponent) => peerKeys.has(opponent))) continue;
    const scored = onLeft ? Number(match.teamAScore) : Number(match.teamBScore); const conceded = onLeft ? Number(match.teamBScore) : Number(match.teamAScore);
    wins += scored > conceded ? 1 : 0; pointDifference += scored - conceded;
  }
  return { wins, pointDifference };
}

export function calculateLeaderboardForTournament(tournament, matches, roster = []) {
  const rules = getTournamentRuleSet(tournament?.format); const teamBased = rules.ranking !== 'individual'; const rows = standingsRows(matches, teamBased);
  const rosterEntries = teamBased ? pairFixedTeams(roster, tournament?.tournamentType || 'mixed-doubles').map(teamKey) : roster.map((player) => player.label);
  rosterEntries.forEach((key, index) => {
    if (!rows.has(key)) rows.set(key, { player: key, team: key, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, pointsScored: 0, pointsConceded: 0, pointDifference: 0, averagePoints: 0, matchPoints: 0, opponents: [], seed: index + 1, roundReached: 0, courtPoints: 0, ladderPosition: rules.mode === 'ladder' ? index + 1 : 999 });
  });
  if (teamBased) for (const match of matches) for (const team of [match.teamA, match.teamB]) { const row = rows.get(teamKey(team)); if (row) row.roundReached = Math.max(row.roundReached, Number(match.metadata?.stage || 0)); }
  for (const row of rows.values()) row.strengthOfSchedule = row.opponents.reduce((sum, opponent) => sum + (rows.get(opponent)?.wins || 0), 0);
  for (const row of rows.values()) row.buchholz = row.opponents.reduce((sum, opponent) => sum + (rows.get(opponent)?.matchPoints || 0), 0);
  const sorters = { pointsScored: (a, b) => b.pointsScored - a.pointsScored, wins: (a, b) => b.wins - a.wins, pointDifference: (a, b) => b.pointDifference - a.pointDifference, strengthOfSchedule: (a, b) => b.strengthOfSchedule - a.strengthOfSchedule, matchPoints: (a, b) => b.matchPoints - a.matchPoints, buchholz: (a, b) => b.buchholz - a.buchholz, losses: (a, b) => a.losses - b.losses, roundReached: (a, b) => b.roundReached - a.roundReached, courtPoints: (a, b) => b.courtPoints - a.courtPoints, ladderPosition: (a, b) => a.ladderPosition - b.ladderPosition, poolWins: (a, b) => b.wins - a.wins, seed: (a, b) => a.seed - b.seed, player: (a, b) => a.player.localeCompare(b.player), team: (a, b) => a.team.localeCompare(b.team) };
  let ranked = [...rows.values()];
  if (rules.tieBreakers.includes('headToHead')) {
    const primaryKey = rules.tieBreakers[0]; const primarySorter = sorters[primaryKey]; ranked.sort(primarySorter);
    const groups = [];
    for (const row of ranked) { const group = groups.at(-1); if (!group || primarySorter(group[0], row) !== 0) groups.push([row]); else group.push(row); }
    ranked = groups.flatMap((group) => group.sort((a, b) => { const left = directMetrics(a, group, matches, teamBased); const right = directMetrics(b, group, matches, teamBased); return right.wins - left.wins || right.pointDifference - left.pointDifference || b.pointDifference - a.pointDifference || b.pointsScored - a.pointsScored || a.player.localeCompare(b.player); }));
  } else ranked.sort((a, b) => { for (const key of rules.tieBreakers) { const value = sorters[key]?.(a, b) || 0; if (value) return value; } return a.player.localeCompare(b.player); });
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function validateRosterForTournament(type, players) {
  if (!TOURNAMENT_TYPES.includes(type)) return 'Choose a valid tournament type.';
  if (players.length < 4 || players.length % 2) return 'Doubles tournaments require an even roster of at least four players.';
  const men = players.filter((p) => p.gender === 'men').length; const women = players.filter((p) => p.gender === 'women').length;
  if (type === 'mixed-doubles' && (men !== women || men + women !== players.length)) return 'Mixed Doubles requires equal numbers of men and women.';
  if (type === 'mens-doubles' && men !== players.length) return "Men's Doubles accepts men only.";
  if (type === 'womens-doubles' && women !== players.length) return "Women's Doubles accepts women only.";
  return null;
}

function eliminationSeedSlots(teams) { const size = 2 ** Math.ceil(Math.log2(teams.length)); return [...teams, ...Array(size - teams.length).fill(null)]; }
function singleStageEntrants(teams, matches, stage) {
  let entrants = eliminationSeedSlots(teams);
  for (let current = 1; current < stage; current += 1) {
    const next = [];
    for (let index = 0; index < entrants.length; index += 2) {
      const a = entrants[index], b = entrants[index + 1];
      if (!a || !b) next.push(a || b);
      else {
        const match = matches.find((m) => Number(m.metadata?.stage) === current && Number(m.metadata?.bracketIndex) === index / 2);
        if (!match || match.status !== 'finalized') return null;
        next.push(winnerTeam(match));
      }
    }
    entrants = next;
  }
  return entrants;
}
function singleStagePairs(teams, matches, stage) {
  const entrants = singleStageEntrants(teams, matches, stage); if (!entrants || entrants.length < 2) return [];
  const pairs = [];
  for (let i = 0; i < entrants.length; i += 2) if (entrants[i] && entrants[i + 1]) pairs.push({ teamA: entrants[i], teamB: entrants[i + 1], metadata: { bracket: 'winners', bracketIndex: i / 2, teamASeed: teams.findIndex((t) => teamKey(t) === teamKey(entrants[i])) + 1, teamBSeed: teams.findIndex((t) => teamKey(t) === teamKey(entrants[i + 1])) + 1 } });
  return pairs;
}
function previousOpponents(matches) { return new Set(matches.map((m) => [teamKey(m.teamA), teamKey(m.teamB)].sort().join(' vs '))); }
function pairAvoidingRepeats(teams, matches, scoreFor = () => 0) {
  const remaining = [...teams].sort((a, b) => scoreFor(b) - scoreFor(a) || teamKey(a).localeCompare(teamKey(b)));
  const previous = previousOpponents(matches);
  const pairs = [];
  while (remaining.length > 1) {
    const first = remaining.shift();
    let index = remaining.findIndex((candidate) => !previous.has([teamKey(first), teamKey(candidate)].sort().join(' vs ')));
    if (index < 0) index = 0;
    pairs.push([first, remaining.splice(index, 1)[0]]);
  }
  return pairs;
}
function initialKingFixtures(tournament, teams) {
  if (Math.ceil(teams.length / 2) > Number(tournament.numberOfCourts)) throw new Error('King of the Court requires enough courts for every team to play or receive a recorded bye each round.');
  const byeTeam = teams.length % 2 ? teams.at(-1) : null;
  const active = byeTeam ? teams.slice(0, -1) : teams;
  const pairs = [];
  for (let i = 0; i + 1 < active.length; i += 2) pairs.push({ teamA: active[i], teamB: active[i + 1], metadata: { courtPosition: i / 2 + 1, courtCount: active.length / 2, byeTeam: i === 0 ? byeTeam : null } });
  return stageFixtures(tournament, pairs, 1, 1);
}
function nextKingFixtures(tournament, matches, stage) {
  const prior = matches.filter((m) => Number(m.metadata?.stage) === stage - 1).sort((a, b) => Number(a.metadata.courtPosition) - Number(b.metadata.courtPosition));
  if (!prior.length || prior.some((m) => m.status !== 'finalized')) return [];
  const priorBye = prior.find((m) => m.metadata?.byeTeam)?.metadata.byeTeam || null;
  const order = prior.flatMap((match) => [winnerTeam(match), loserTeam(match)]);
  if (priorBye) order.splice(1, 0, priorBye);
  const nextBye = order.length % 2 ? order.pop() : null;
  const pairs = [];
  for (let i = 0; i + 1 < order.length; i += 2) pairs.push({ teamA: order[i], teamB: order[i + 1], metadata: { courtPosition: i / 2 + 1, courtCount: order.length / 2, byeTeam: i === 0 ? nextBye : null } });
  return stageFixtures(tournament, pairs, stage, Math.max(...matches.map((m) => Number(m.round))) + 1);
}
function ladderFixtures(tournament, order, stage, startRound) {
  const byeTeam = order.length % 2 ? order.at(-1) : null;
  const active = byeTeam ? order.slice(0, -1) : order;
  const pairs = [];
  for (let i = 0; i + 1 < active.length; i += 2) pairs.push({ teamA: active[i], teamB: active[i + 1], metadata: { ladderOrder: order.map(teamKey), ladderPositions: [i + 1, i + 2], byeTeam: i === 0 ? byeTeam : null } });
  return stageFixtures(tournament, pairs, stage, startRound);
}
function nextLadderFixtures(tournament, matches, stage) {
  const prior = matches.filter((m) => Number(m.metadata?.stage) === stage - 1);
  if (!prior.length || prior.some((m) => m.status !== 'finalized')) return [];
  const keys = prior[0].metadata.ladderOrder; const teams = new Map(prior.flatMap((m) => [[teamKey(m.teamA), m.teamA], [teamKey(m.teamB), m.teamB]])); const order = keys.map((key) => teams.get(key));
  for (const match of prior) { const a = order.findIndex((t) => teamKey(t) === teamKey(match.teamA)); const b = order.findIndex((t) => teamKey(t) === teamKey(match.teamB)); if (winnerTeam(match) === match.teamB || teamKey(winnerTeam(match)) === teamKey(match.teamB)) [order[a], order[b]] = [order[b], order[a]]; }
  return ladderFixtures(tournament, order, stage, Math.max(...matches.map((m) => Number(m.round))) + 1);
}
function swissFixtures(tournament, teams, matches, stage, startRound) {
  const rows = standingsRows(matches, true); const hadBye = new Set(matches.map((m) => m.metadata?.swissByeTeam).filter(Boolean).map(teamKey)); let pool = [...teams]; let byeTeam = null;
  if (pool.length % 2) { pool.sort((a, b) => (rows.get(teamKey(a))?.matchPoints || 0) - (rows.get(teamKey(b))?.matchPoints || 0) || Number(hadBye.has(teamKey(a))) - Number(hadBye.has(teamKey(b)))); byeTeam = pool.shift(); }
  pool.sort((a, b) => (rows.get(teamKey(b))?.matchPoints || 0) - (rows.get(teamKey(a))?.matchPoints || 0) || teamKey(a).localeCompare(teamKey(b)));
  const pairs = pairAvoidingRepeats(pool, matches, (team) => rows.get(teamKey(team))?.matchPoints || 0).map(([teamA, teamB], index) => ({ teamA, teamB, metadata: { scoreGroupA: rows.get(teamKey(teamA))?.matchPoints || 0, scoreGroupB: rows.get(teamKey(teamB))?.matchPoints || 0, swissByeTeam: index === 0 ? byeTeam : null } }));
  return stageFixtures(tournament, pairs, stage, startRound);
}
function doubleFixtures(tournament, teams, matches, stage, startRound) {
  const stats = standingsRows(matches, true); const alive = teams.filter((team) => (stats.get(teamKey(team))?.losses || 0) < 2);
  if (alive.length < 2) return [];
  const groups = [0, 1].flatMap((losses) => { const group = alive.filter((team) => (stats.get(teamKey(team))?.losses || 0) === losses); return pairAvoidingRepeats(group.slice(0, group.length - (group.length % 2)), matches).map(([teamA, teamB]) => ({ teamA, teamB, metadata: { bracket: losses ? 'losers' : 'winners', lossesBefore: losses } })); });
  const paired = new Set(groups.flatMap((p) => [teamKey(p.teamA), teamKey(p.teamB)])); const leftovers = alive.filter((t) => !paired.has(teamKey(t)));
  if (leftovers.length >= 2) groups.push({ teamA: leftovers[0], teamB: leftovers[1], metadata: { bracket: 'crossover', lossesBefore: [stats.get(teamKey(leftovers[0]))?.losses || 0, stats.get(teamKey(leftovers[1]))?.losses || 0] } });
  return stageFixtures(tournament, groups, stage, startRound);
}

export function generateInitialFixtures(tournament, players) {
  const rules = getTournamentRuleSet(tournament.format); const validation = validateRosterForTournament(tournament.tournamentType || 'mixed-doubles', players); if (validation) throw new Error(validation);
  const rounds = Number(tournament.settings?.numberOfRounds || 20); const courts = Number(tournament.numberOfCourts || 1);
  if (rules.mode === 'rotating' || rules.mode === 'custom') {
    const pairRounds = Array.from({ length: rounds }, (_, roundIndex) => { const teams = rotatingRound(players, roundIndex + 1, tournament.tournamentType === 'mixed-doubles'); return Array.from({ length: Math.floor(teams.length / 2) }, (_, index) => [teams[index * 2], teams[index * 2 + 1]]).slice(0, courts); });
    return materializeRounds(tournament, pairRounds);
  }
  const teams = pairFixedTeams(players, tournament.tournamentType);
  if (rules.mode === 'fixed-round-robin') return materializeRounds(tournament, roundRobinPairs(teams));
  if (rules.mode === 'pool') { const poolCount = Math.max(1, Math.ceil(teams.length / 4)); const pools = Array.from({ length: poolCount }, () => []); teams.forEach((team, index) => pools[index % poolCount].push(team)); const maxRounds = Math.max(...pools.map((p) => roundRobinPairs(p).length)); const schedule = Array.from({ length: maxRounds }, (_, round) => pools.flatMap((pool) => roundRobinPairs(pool)[round] || [])); return materializeRounds(tournament, schedule, (_stage, _index, pair) => ({ pool: pools.findIndex((pool) => pool.some((team) => teamKey(team) === teamKey(pair[0]))) + 1 })); }
  if (rules.mode === 'single-elimination') return stageFixtures(tournament, singleStagePairs(teams, [], 1), 1, 1);
  if (rules.mode === 'double-elimination') return doubleFixtures(tournament, teams, [], 1, 1);
  if (rules.mode === 'swiss') return swissFixtures(tournament, teams, [], 1, 1);
  if (rules.mode === 'king-of-court') return initialKingFixtures(tournament, teams);
  if (rules.mode === 'ladder') return ladderFixtures(tournament, teams, 1, 1);
  if (rules.mode === 'adaptive-individual') { const order = players.map((p) => p.label); const pairs = []; for (let i = 0; i + 3 < order.length && pairs.length < courts; i += 4) pairs.push({ teamA: [order[i], order[i + 3]], teamB: [order[i + 1], order[i + 2]] }); return stageFixtures(tournament, pairs, 1, 1); }
  throw new Error(`Unsupported tournament format: ${tournament.format}`);
}

export function generateNextAdaptiveFixtures(tournament, players, matches) {
  const rules = getTournamentRuleSet(tournament.format); const adaptive = ['adaptive-individual', 'king-of-court', 'ladder', 'single-elimination', 'double-elimination', 'swiss']; if (!adaptive.includes(rules.mode)) return [];
  const currentStage = Math.max(0, ...matches.map((m) => Number(m.metadata?.stage || 0))); const stageMatches = matches.filter((m) => Number(m.metadata?.stage || 0) === currentStage); if (!stageMatches.length || stageMatches.some((m) => m.status !== 'finalized')) return [];
  const limit = Number(tournament.settings?.numberOfRounds || 20); if (currentStage >= limit) return [];
  const nextStage = currentStage + 1; const startRound = Math.max(...matches.map((m) => Number(m.round || 0))) + 1; const teams = pairFixedTeams(players, tournament.tournamentType); let generated = [];
  if (rules.mode === 'single-elimination') generated = stageFixtures(tournament, singleStagePairs(teams, matches, nextStage), nextStage, startRound);
  else if (rules.mode === 'double-elimination') generated = doubleFixtures(tournament, teams, matches, nextStage, startRound);
  else if (rules.mode === 'swiss') generated = swissFixtures(tournament, teams, matches, nextStage, startRound);
  else if (rules.mode === 'king-of-court') generated = nextKingFixtures(tournament, matches, nextStage);
  else if (rules.mode === 'ladder') generated = nextLadderFixtures(tournament, matches, nextStage);
  else { const ranked = calculateLeaderboardForTournament(tournament, matches).map((row) => row.player); const unranked = players.map((p) => p.label).filter((label) => !ranked.includes(label)); const order = [...ranked, ...unranked]; const pairs = []; for (let i = 0; i + 3 < order.length && pairs.length < Number(tournament.numberOfCourts || 1); i += 4) pairs.push({ teamA: [order[i], order[i + 3]], teamB: [order[i + 1], order[i + 2]] }); generated = stageFixtures(tournament, pairs, nextStage, startRound); }
  return generated;
}
