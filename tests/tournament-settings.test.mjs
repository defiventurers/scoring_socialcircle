import assert from 'node:assert/strict';
import { generateInitialFixtures } from '../api/_lib/tournament-rules.js';

const roster = Array.from({ length: 8 }, (_, index) => ({ label: String(index + 1), gender: 'men' }));
const tournament = {
  id: 'configured-schedule',
  format: 'americano',
  tournamentType: 'mens-doubles',
  numberOfCourts: 2,
  pointsToWin: 21,
  winBy: 2,
  settings: {
    numberOfRounds: 2,
    roundDurationMinutes: 12,
    intervalMinutes: 3,
    startTime: '09:30',
    automaticRoundTimer: true,
    allowManualScoreOverrides: false,
    allowTimeLimitResults: true,
  },
};

const fixtures = generateInitialFixtures(tournament, roster);
assert.equal(fixtures.length, 4);
assert.equal(fixtures[0].scheduled_time, '9:30 AM');
assert.equal(fixtures.find((match) => match.round === 2).scheduled_time, '9:45 AM');
assert.equal(tournament.settings.roundDurationMinutes, 12);
assert.equal(tournament.settings.intervalMinutes, 3);
assert.equal(tournament.settings.automaticRoundTimer, true);
assert.equal(tournament.settings.allowManualScoreOverrides, false);

console.log('Configured tournament settings tests passed.');
