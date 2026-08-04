import assert from 'node:assert/strict';
import {
  TOURNAMENT_FORMATS,
  calculateLeaderboardForTournament,
  generateInitialFixtures,
  generateNextAdaptiveFixtures,
  getFormatDefinitions,
  validateRosterForTournament,
} from '../api/_lib/tournament-rules.js';

const men = Array.from({ length: 8 }, (_, index) => ({ label: String(index + 1), gender: 'men' }));
const women = Array.from({ length: 8 }, (_, index) => ({ label: String.fromCharCode(65 + index), gender: 'women' }));
const mixed = [...men, ...women];
const definitions = getFormatDefinitions();
assert.equal(Object.keys(definitions).length, 11);
for (const format of TOURNAMENT_FORMATS) {
  const tournamentType = format === 'mixed-americano' ? 'mixed-doubles' : 'mens-doubles';
  const players = tournamentType === 'mixed-doubles' ? mixed : men;
  const tournament = { id: `test-${format}`, format, tournamentType, numberOfCourts: 2, settings: { numberOfRounds: 4, startHour: 11, intervalMinutes: 8 } };
  const fixtures = generateInitialFixtures(tournament, players);
  assert.ok(fixtures.length > 0, `${format} generates fixtures`);
  for (const match of fixtures) {
    assert.equal(new Set([...match.team_a, ...match.team_b]).size, 4, `${format} has four distinct players`);
  }
  assert.ok(definitions[format].description && definitions[format].winner && definitions[format].bestUse);
}
assert.match(validateRosterForTournament('mixed-doubles', men) || '', /equal numbers/);
assert.match(validateRosterForTournament('mens-doubles', women) || '', /men only/i);
const scored = [
  { status: 'finalized', teamA: ['1', '2'], teamB: ['3', '4'], teamAScore: 15, teamBScore: 9, round: 1 },
  { status: 'finalized', teamA: ['1', '3'], teamB: ['2', '4'], teamAScore: 12, teamBScore: 15, round: 2 },
];
const americano = calculateLeaderboardForTournament({ format: 'americano' }, scored);
assert.equal(americano[0].player, '2');
const swissTournament = { id: 'swiss', format: 'swiss', tournamentType: 'mens-doubles', numberOfCourts: 2, settings: { numberOfRounds: 4 } };
const firstSwiss = generateInitialFixtures(swissTournament, men);
const finalizedSwiss = firstSwiss.map((match, index) => ({ ...match, teamA: match.team_a, teamB: match.team_b, status: 'finalized', teamAScore: 15, teamBScore: 10 + index }));
const nextSwiss = generateNextAdaptiveFixtures(swissTournament, men, finalizedSwiss);
assert.ok(nextSwiss.length > 0);
assert.equal(nextSwiss[0].round, 2);
console.log('Tournament format tests passed for all 11 formats.');
