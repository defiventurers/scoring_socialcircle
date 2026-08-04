import { getSessionFromRequest } from './_lib/auth.js';
import { createTournamentWithFixtures, endTournament, ensureDatabase, listTournaments, TOURNAMENT_FORMATS } from './_lib/db.js';
import { methodNotAllowed, parseJsonBody, sendJson } from './_lib/http.js';

export default async function handler(req, res) {
  let session;
  try {
    session = getSessionFromRequest(req);
  } catch (error) {
    console.error('Session configuration error:', error);
    return sendJson(res, 500, { error: 'Server authentication is not configured.' });
  }

  if (!session) return sendJson(res, 401, { error: 'Session expired. Sign in again.' });

  try {
    await ensureDatabase();
    if (req.method === 'GET') return sendJson(res, 200, { tournaments: await listTournaments(), formats: TOURNAMENT_FORMATS });
    if (req.method === 'POST') {
      if (session.role !== 'admin') return sendJson(res, 403, { error: 'Only administrators can create tournaments.' });
      const body = parseJsonBody(req);
      const id = String(body.id || body.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id || !body.name) return sendJson(res, 400, { error: 'Tournament name is required.' });
      const format = TOURNAMENT_FORMATS.includes(body.format) ? body.format : 'custom';
      const status = body.status === 'draft' ? 'draft' : 'published';
      const tournament = await createTournamentWithFixtures({
        id,
        name: body.name,
        format,
        status,
        date: body.date || null,
        location: body.location || null,
        numberOfCourts: body.numberOfCourts || body.number_of_courts || 1,
        maxPlayers: body.maxPlayers || body.numberOfPlayers || body.number_of_players || 4,
        pointsToWin: body.pointsToWin || body.points_to_win || 15,
        winBy: body.winBy || body.win_by || 1,
        settings: body.settings || {},
      });
      return sendJson(res, 201, { tournament, tournaments: await listTournaments(), formats: TOURNAMENT_FORMATS });
    }
    if (req.method === 'PATCH') {
      if (session.role !== 'admin') return sendJson(res, 403, { error: 'Only administrators can end tournaments.' });
      const body = parseJsonBody(req);
      if (body.action !== 'end') return sendJson(res, 400, { error: 'Unsupported tournament action.' });
      const tournamentId = String(body.tournamentId || '');
      if (!tournamentId) return sendJson(res, 400, { error: 'Tournament ID is required.' });
      if (!/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/.test(tournamentId)) return sendJson(res, 400, { error: 'Invalid tournament ID.' });
      const existing = (await listTournaments()).find((tournament) => tournament.id === tournamentId);
      if (!existing) return sendJson(res, 404, { error: 'Tournament not found.' });
      if (existing.status !== 'published') return sendJson(res, 409, { error: 'Tournament is not active or has already ended.' });
      const tournament = await endTournament(tournamentId);
      if (!tournament) return sendJson(res, 409, { error: 'Tournament changed before it could be ended. Refresh and try again.' });
      return sendJson(res, 200, { tournament, tournaments: await listTournaments(), formats: TOURNAMENT_FORMATS });
    }
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH']);
  } catch (error) {
    console.error('Tournament API failed:', error);
    return sendJson(res, 503, { error: 'The tournament database is temporarily unavailable.' });
  }
}
