import { createSession, validatePin } from './_lib/auth.js';
import { ensureDatabase, getTournament } from './_lib/db.js';
import { methodNotAllowed, parseJsonBody, sendJson } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  const body = parseJsonBody(req);
  if (!body) {
    return sendJson(res, 400, { error: 'Invalid JSON body.' });
  }

  const requestedCourt = body.court === 'admin' ? 'admin' : Number(body.court);
  if (requestedCourt !== 'admin' && ![1, 2, 3, 4].includes(requestedCourt)) {
    return sendJson(res, 400, { error: 'Invalid court selection.' });
  }

  if (!/^\d{4,12}$/.test(String(body.pin || ''))) {
    return sendJson(res, 400, { error: 'Enter a valid PIN.' });
  }

  try {
    if (!validatePin(requestedCourt, body.pin)) {
      return sendJson(res, 401, { error: 'Incorrect PIN.' });
    }

    const role = requestedCourt === 'admin' ? 'admin' : 'court';
    const court = requestedCourt === 'admin' ? null : requestedCourt;
    const tournamentId = role === 'court' ? String(body.tournamentId || '') : null;
    if (role === 'court') {
      if (!/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/.test(tournamentId)) {
        return sendJson(res, 400, { error: 'Select an active tournament.' });
      }
      await ensureDatabase();
      const tournament = await getTournament(tournamentId);
      if (!tournament || tournament.status !== 'published') {
        return sendJson(res, 409, { error: 'This tournament is not available for scoring.' });
      }
      if (court > Number(tournament.numberOfCourts || 0)) {
        return sendJson(res, 400, { error: `Court ${court} is not configured for this tournament.` });
      }
    }
    const token = createSession({ role, court, tournamentId });

    return sendJson(res, 200, {
      token,
      role,
      court: requestedCourt,
      tournamentId,
      expiresInSeconds: 12 * 60 * 60,
    });
  } catch (error) {
    console.error('Login configuration error:', error);
    return sendJson(res, 500, {
      error: 'Server authentication is not configured correctly.',
    });
  }
}
