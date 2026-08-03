import { getSessionFromRequest } from './_lib/auth.js';
import { getLeaderboard } from './_lib/db.js';
import { methodNotAllowed, sendJson } from './_lib/http.js';
export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!getSessionFromRequest(req)) return sendJson(res, 401, { error: 'Session expired. Sign in again.' });
  return sendJson(res, 200, { leaderboard: await getLeaderboard(req.query?.tournamentId) });
}
