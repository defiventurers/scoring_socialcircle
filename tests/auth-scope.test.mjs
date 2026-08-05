import assert from 'node:assert/strict';
import { canAccessTournament, createSession, verifySession } from '../api/_lib/auth.js';

process.env.SESSION_SECRET = '01234567890123456789012345678901';

const courtToken = createSession({ role: 'court', court: 2, tournamentId: 'published-event' });
const courtSession = verifySession(courtToken);
assert.equal(courtSession.role, 'court');
assert.equal(courtSession.court, 2);
assert.equal(courtSession.tournamentId, 'published-event');
assert.equal(canAccessTournament(courtSession, 'published-event'), true);
assert.equal(canAccessTournament(courtSession, 'other-event'), false);

const adminSession = verifySession(createSession({ role: 'admin' }));
assert.equal(canAccessTournament(adminSession, 'any-event'), true);

assert.equal(verifySession(createSession({ role: 'court', court: 2 })), null);
console.log('Tournament-scoped session tests passed.');
