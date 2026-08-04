import { getSessionFromRequest } from './_lib/auth.js';
import { ensureDatabase, getSql, listPlayers, updatePlayers } from './_lib/db.js';
import { methodNotAllowed, parseJsonBody, sendJson } from './_lib/http.js';

function isPermanentLabel(label) {
  return /^(?:[1-9]|1\d|20|[A-T])$/.test(label);
}

export default async function handler(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) return sendJson(res, 401, { error: 'Session expired. Sign in again.' });
  await ensureDatabase();
  const sql = getSql();
  if (req.method === 'GET') return sendJson(res, 200, { players: await listPlayers() });
  if (req.method === 'POST') {
    if (session.role !== 'admin') return sendJson(res, 403, { error: 'Only administrators can manage players.' });
    const body = parseJsonBody(req);
    if (Array.isArray(body.players)) {
      const labels = body.players.map((player) => String(player.label || '').trim());
      if (labels.some((label) => !isPermanentLabel(label))) return sendJson(res, 400, { error: 'Invalid permanent player label.' });
      return sendJson(res, 200, { players: await updatePlayers(body.players) });
    }
    const label = String(body.label || '').trim();
    if (!label) return sendJson(res, 400, { error: 'Player label is required.' });
    if (!isPermanentLabel(label)) return sendJson(res, 400, { error: 'Player label must be 1-20 or A-T.' });
    await sql`INSERT INTO players (label, display_name, gender, status, photo_url, notes) VALUES (${label}, ${body.displayName || null}, ${body.gender || 'unknown'}, ${body.status || 'active'}, ${body.photoUrl || null}, ${body.notes || null}) ON CONFLICT (label) DO UPDATE SET display_name = EXCLUDED.display_name, gender = EXCLUDED.gender, status = EXCLUDED.status, photo_url = EXCLUDED.photo_url, notes = EXCLUDED.notes, updated_at = NOW()`;
    return sendJson(res, 200, { players: await listPlayers() });
  }
  return methodNotAllowed(res, ['GET', 'POST']);
}
