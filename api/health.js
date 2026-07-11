import { ensureDatabase, getSql, EVENT_ID } from './_lib/db.js';
import { methodNotAllowed, sendJson } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  const required = [
    'SESSION_SECRET',
    'COURT_1_PIN',
    'COURT_2_PIN',
    'COURT_3_PIN',
    'COURT_4_PIN',
    'ADMIN_PIN',
  ];
  const missing = required.filter((name) => !process.env[name]);
  const hasDatabaseUrl = Boolean(
    process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_URL,
  );
  if (!hasDatabaseUrl) missing.unshift('DATABASE_URL');

  if (missing.length > 0) {
    return sendJson(res, 503, {
      ok: false,
      error: 'Server configuration is incomplete.',
      missing,
    });
  }

  try {
    await ensureDatabase();
    const sql = getSql();
    const rows = await sql`
      SELECT COUNT(*)::INTEGER AS count
      FROM matches
      WHERE event_id = ${EVENT_ID}
    `;

    return sendJson(res, 200, {
      ok: true,
      database: 'connected',
      matches: rows[0]?.count || 0,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    return sendJson(res, 503, {
      ok: false,
      database: 'unavailable',
      error: 'Database connection failed.',
    });
  }
}
