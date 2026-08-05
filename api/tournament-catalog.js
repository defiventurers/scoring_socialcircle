import { ensureDatabase, listTournaments } from './_lib/db.js';
import { methodNotAllowed, sendJson } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    await ensureDatabase();
    const tournaments = (await listTournaments())
      .filter((tournament) => tournament.status === 'published')
      .map((tournament) => ({
        id: tournament.id,
        name: tournament.name,
        format: tournament.format,
        date: tournament.date,
        location: tournament.location,
        numberOfCourts: tournament.numberOfCourts,
        matchCount: tournament.matchCount || 0,
        status: tournament.status,
      }));
    return sendJson(res, 200, { tournaments });
  } catch (error) {
    console.error('Tournament catalog failed:', error);
    return sendJson(res, 503, { error: 'Active tournaments are temporarily unavailable.' });
  }
}
