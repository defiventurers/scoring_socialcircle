import { getSessionFromRequest } from './_lib/auth.js';
import { ensureDatabase, getSql, listTournaments, TOURNAMENT_FORMATS } from './_lib/db.js';
import { methodNotAllowed, parseJsonBody, sendJson } from './_lib/http.js';

export default async function handler(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) return sendJson(res, 401, { error: 'Session expired. Sign in again.' });
  await ensureDatabase();
  const sql = getSql();
  if (req.method === 'GET') return sendJson(res, 200, { tournaments: await listTournaments(), formats: TOURNAMENT_FORMATS });
  if (req.method === 'POST') {
    if (session.role !== 'admin') return sendJson(res, 403, { error: 'Only administrators can manage tournaments.' });
    const body = parseJsonBody(req);
    const id = String(body.id || body.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id || !body.name) return sendJson(res, 400, { error: 'Tournament name is required.' });
    const format = TOURNAMENT_FORMATS.includes(body.format) ? body.format : 'custom';
    await sql`INSERT INTO tournaments (id, name, format, status, date, location, number_of_courts, points_to_win, win_by, max_players, settings) VALUES (${id}, ${body.name}, ${format}, ${body.status || 'draft'}, ${body.date || null}, ${body.location || null}, ${body.numberOfCourts || 1}, ${body.pointsToWin || 15}, ${body.winBy || 1}, ${body.maxPlayers || null}, ${JSON.stringify(body.settings || {})}::JSONB) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, format = EXCLUDED.format, status = EXCLUDED.status, date = EXCLUDED.date, location = EXCLUDED.location, number_of_courts = EXCLUDED.number_of_courts, points_to_win = EXCLUDED.points_to_win, win_by = EXCLUDED.win_by, max_players = EXCLUDED.max_players, settings = EXCLUDED.settings, updated_at = NOW()`;
    return sendJson(res, 200, { tournaments: await listTournaments(), formats: TOURNAMENT_FORMATS });
  }
  return methodNotAllowed(res, ['GET', 'POST']);
}
