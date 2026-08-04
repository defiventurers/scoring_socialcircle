import assert from 'node:assert/strict';
import { calculateLeaderboardForTournament, generateInitialFixtures, generateNextAdaptiveFixtures } from '../api/_lib/tournament-rules.js';

const men = (count) => Array.from({ length: count }, (_, index) => ({ label: String(index + 1), gender: 'men' }));
const tournament = (format, teamCount, courts = 4, rounds = 10) => ({ id: `test-${format}`, format, tournamentType: 'mens-doubles', numberOfCourts: courts, settings: { numberOfRounds: rounds } });
const finalize = (matches, winners = 'A') => matches.map((match, index) => ({ ...match, teamA: match.team_a, teamB: match.team_b, status: 'finalized', teamAScore: winners === 'A' || (Array.isArray(winners) && winners[index] === 'A') ? 15 : 8, teamBScore: winners === 'B' || (Array.isArray(winners) && winners[index] === 'B') ? 15 : 8 }));

// Single elimination: every non-bye opening match is scheduled, byes advance, and progression ends at one champion.
{
  const config = tournament('single-elimination', 5, 2);
  const roster = men(10);
  let matches = generateInitialFixtures(config, roster);
  assert.equal(matches.length, 2, 'five teams produce two opening matches and three byes');
  assert.deepEqual([...new Set(matches.flatMap((m) => [...m.team_a, ...m.team_b]))].length, 8);
  for (let guard = 0; guard < 5; guard += 1) {
    matches = [...matches, ...generateNextAdaptiveFixtures(config, roster, finalize(matches))];
    matches = finalize(matches);
  }
  assert.equal(generateNextAdaptiveFixtures(config, roster, matches).length, 0, 'single elimination stops after the final');
  assert.equal(matches.length, 4, 'five teams require four played matches');
}

// Double elimination: first losses move teams into the losers bracket and second losses eliminate them.
{
  const config = tournament('double-elimination', 4, 4);
  const roster = men(8);
  let matches = finalize(generateInitialFixtures(config, roster));
  const second = generateNextAdaptiveFixtures(config, roster, matches);
  assert.ok(second.some((m) => m.metadata.bracket === 'winners'));
  assert.ok(second.some((m) => m.metadata.bracket === 'losers'));
  matches = [...matches, ...finalize(second)];
  const third = generateNextAdaptiveFixtures(config, roster, matches);
  const losses = calculateLeaderboardForTournament(config, matches).map((row) => row.losses);
  assert.ok(losses.some((value) => value === 2), 'a second loss is recorded');
  assert.ok(third.every((m) => [...m.team_a, ...m.team_b].length === 4));
}

// Swiss: pair nearest score groups and avoid repeats whenever another perfect matching exists.
{
  const config = tournament('swiss', 4, 4, 4);
  const roster = men(8);
  const round1 = finalize(generateInitialFixtures(config, roster), ['A', 'A']);
  const round2 = generateNextAdaptiveFixtures(config, roster, round1);
  const previous = new Set(round1.map((m) => [m.teamA.slice().sort().join('+'), m.teamB.slice().sort().join('+')].sort().join('v')));
  assert.ok(round2.every((m) => !previous.has([m.team_a.slice().sort().join('+'), m.team_b.slice().sort().join('+')].sort().join('v'))));
  assert.ok(round2.every((m) => Math.abs(m.metadata.scoreGroupA - m.metadata.scoreGroupB) <= 3));
}

// King of the Court: winners move up and losers move down, with boundary teams staying on an edge court.
{
  const config = tournament('king-of-the-court', 4, 2);
  const roster = men(8);
  const first = generateInitialFixtures(config, roster);
  const second = generateNextAdaptiveFixtures(config, roster, finalize(first));
  assert.equal(second.length, 2);
  assert.equal(second.find((m) => m.metadata.courtPosition === 1).team_a.join('+'), first[0].team_a.join('+'));
  assert.equal(second.find((m) => m.metadata.courtPosition === 2).team_b.join('+'), first[1].team_b.join('+'));
}

// Ladder: an upset swaps adjacent persistent positions before the next pairing.
{
  const config = tournament('ladder-league', 4, 2);
  const roster = men(8);
  const first = generateInitialFixtures(config, roster);
  const second = generateNextAdaptiveFixtures(config, roster, finalize(first, ['B', 'A']));
  assert.deepEqual(second[0].team_a, first[0].team_b);
  assert.deepEqual(second[0].team_b, first[0].team_a);
  assert.equal(second[0].metadata.ladderOrder[0], first[0].team_b.slice().sort().join(' + '));
}

// Real head-to-head breaks otherwise identical round-robin records.
{
  const config = tournament('round-robin', 3, 3);
  const roster = men(6);
  const fixtures = generateInitialFixtures(config, roster);
  const scored = fixtures.map((m) => ({ ...m, teamA: m.team_a, teamB: m.team_b, status: 'finalized', teamAScore: 15, teamBScore: 10 }));
  const rows = calculateLeaderboardForTournament(config, scored);
  assert.equal(rows.length, 3);
  const direct = scored[0];
  const winner = direct.teamAScore > direct.teamBScore ? direct.teamA.slice().sort().join(' + ') : direct.teamB.slice().sort().join(' + ');
  const loser = direct.teamAScore > direct.teamBScore ? direct.teamB.slice().sort().join(' + ') : direct.teamA.slice().sort().join(' + ');
  const winnerRow = rows.find((r) => r.team === winner); const loserRow = rows.find((r) => r.team === loser);
  if (winnerRow.wins === loserRow.wins) assert.ok(winnerRow.rank < loserRow.rank);
}

// Server leaderboard includes roster entries before any games are finalized.
{
  const config = tournament('swiss', 4, 4, 4);
  const roster = men(8);
  const rows = calculateLeaderboardForTournament(config, [], roster);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.gamesPlayed === 0));
}

// Existing Mixed Americano behavior remains individual and mixed on every court.
{
  const roster = [...men(4), ...Array.from({ length: 4 }, (_, i) => ({ label: String.fromCharCode(65 + i), gender: 'women' }))];
  const config = { id: 'mixed', format: 'mixed-americano', tournamentType: 'mixed-doubles', numberOfCourts: 2, settings: { numberOfRounds: 4 } };
  const fixtures = generateInitialFixtures(config, roster);
  assert.equal(fixtures.length, 8);
  assert.ok(fixtures.every((m) => m.team_a.some((p) => /[A-Z]/.test(p)) && m.team_b.some((p) => /[A-Z]/.test(p))));
}

console.log('Format progression and ranking tests passed.');
