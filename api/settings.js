import { getSessionFromRequest } from './_lib/auth.js';
import { ensureDatabase, getSql } from './_lib/db.js';
import { methodNotAllowed, parseJsonBody, sendJson } from './_lib/http.js';
export default async function handler(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) return sendJson(res, 401, { error: 'Session expired. Sign in again.' });
  await ensureDatabase();
  const sql = getSql();
  if (req.method === 'GET') return sendJson(res, 200, { settings: await sql`SELECT key, value, updated_at AS "updatedAt" FROM settings ORDER BY key` });
  if (req.method === 'POST') {
    if (session.role !== 'admin') return sendJson(res, 403, { error: 'Only administrators can update settings.' });
    const body = parseJsonBody(req);
    await sql`INSERT INTO settings (key, value) VALUES (${String(body.key || '')}, ${JSON.stringify(body.value ?? {})}::JSONB) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
    return sendJson(res, 200, { settings: await sql`SELECT key, value, updated_at AS "updatedAt" FROM settings ORDER BY key` });
  }
  return methodNotAllowed(res, ['GET', 'POST']);
}
