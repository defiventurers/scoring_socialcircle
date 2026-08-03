import { getSessionFromRequest } from './_lib/auth.js';
import { listCourts, listMatches, listRounds } from './_lib/db.js';
import { methodNotAllowed, sendJson } from './_lib/http.js';
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!getSessionFromRequest(req)) return sendJson(res, 401, { error: 'Session expired. Sign in again.' });
  const tournamentId = req.query?.tournamentId;
  return sendJson(res, 200, { rounds: await listRounds(tournamentId), courts: await listCourts(tournamentId), matches: await listMatches() });
}
