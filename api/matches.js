import { getSessionFromRequest } from './_lib/auth.js';
import { getPublishedTournament, getTournament, listMatches } from './_lib/db.js';
import { methodNotAllowed, sendJson } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  let session;
  try {
    session = getSessionFromRequest(req);
  } catch (error) {
    console.error('Session configuration error:', error);
    return sendJson(res, 500, { error: 'Server authentication is not configured.' });
  }

  if (!session) {
    return sendJson(res, 401, { error: 'Session expired. Sign in again.' });
  }

  try {
    const tournamentId = req.query?.tournamentId;
    const tournament = tournamentId
      ? await getTournament(tournamentId)
      : await getPublishedTournament();
    if (!tournament) return sendJson(res, 404, { error: 'Tournament not found.' });
    const matches = await listMatches(tournament.id);
    return sendJson(res, 200, {
      matches,
      tournament,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to load matches:', error);
    return sendJson(res, 503, {
      error: 'The shared match database is temporarily unavailable.',
    });
  }
}
