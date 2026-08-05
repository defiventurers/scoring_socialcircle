import { getSessionFromRequest } from './_lib/auth.js';
import {
  assignTournamentPlayers,
  endTournament,
  ensureDatabase,
  generateTournamentFixtures,
  getTournament,
  listMatches,
  listTournamentPlayers,
  listTournaments,
  publishTournament,
  saveTournamentDraft,
} from './_lib/db.js';
import { methodNotAllowed, parseJsonBody, sendJson } from './_lib/http.js';
import { TOURNAMENT_FORMATS, TOURNAMENT_TYPES, getFormatDefinitions, validateRosterForTournament } from './_lib/tournament-rules.js';

function tournamentIdFrom(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function validTournamentId(value) {
  return /^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/.test(value);
}

function normalizedDraft(body, id) {
  const settingsInput = body.settings || {};
  const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const maxPlayers = Math.max(4, Math.min(40, Math.round(number(body.maxPlayers || body.numberOfPlayers, 4))));
  const numberOfRounds = Math.max(1, Math.min(100, Math.round(number(body.numberOfRounds ?? settingsInput.numberOfRounds, 20))));
  const roundDurationMinutes = Math.max(1, Math.min(180, Math.round(number(body.matchDurationMinutes ?? settingsInput.roundDurationMinutes, 8))));
  const intervalMinutes = Math.max(0, Math.min(120, Math.round(number(body.timeBetweenRoundsMinutes ?? settingsInput.intervalMinutes, 0))));
  const startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.startTime || settingsInput.startTime || '')) ? String(body.startTime || settingsInput.startTime) : '11:00';
  const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
  return {
    id,
    name: String(body.name || '').trim(),
    format: TOURNAMENT_FORMATS.includes(body.format) ? body.format : 'custom',
    tournamentType: TOURNAMENT_TYPES.includes(body.tournamentType) ? body.tournamentType : 'mixed-doubles',
    date: body.date || null,
    location: String(body.location || '').trim() || null,
    numberOfCourts: Math.max(1, Math.min(4, Math.round(number(body.numberOfCourts, 1)))),
    maxPlayers,
    pointsToWin: Math.max(1, Math.min(99, Math.round(number(body.pointsToWin, 15)))),
    winBy: Math.max(1, Math.min(10, Math.round(number(body.winBy, 1)))),
    settings: {
      ...settingsInput,
      numberOfRounds,
      roundDurationMinutes,
      intervalMinutes,
      startTime,
      startHour: Number(startTime.slice(0, 2)),
      automaticRoundTimer: boolean(body.automaticRoundTimer ?? settingsInput.automaticRoundTimer, false),
      allowManualScoreOverrides: boolean(body.allowManualScoreOverrides ?? settingsInput.allowManualScoreOverrides, true),
      allowTimeLimitResults: boolean(body.allowTimeLimitResults ?? settingsInput.allowTimeLimitResults, true),
    },
  };
}

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
    if (req.method === 'GET') {
      const tournamentId = String(req.query?.tournamentId || '');
      if (tournamentId) {
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'Only administrators can preview a selected tournament.' });
        const tournament = await getTournament(tournamentId);
        if (!tournament) return sendJson(res, 404, { error: 'Tournament not found.' });
        return sendJson(res, 200, {
          tournament,
          players: await listTournamentPlayers(tournamentId),
          matches: await listMatches(tournamentId),
          formats: TOURNAMENT_FORMATS,
          formatDefinitions: getFormatDefinitions(),
          tournamentTypes: TOURNAMENT_TYPES,
        });
      }
      return sendJson(res, 200, { tournaments: await listTournaments(), formats: TOURNAMENT_FORMATS, formatDefinitions: getFormatDefinitions(), tournamentTypes: TOURNAMENT_TYPES });
    }

    if (session.role !== 'admin') {
      return sendJson(res, 403, { error: 'Only administrators can manage tournaments.' });
    }

    const body = parseJsonBody(req);
    if (!body) return sendJson(res, 400, { error: 'Invalid JSON body.' });

    if (req.method === 'POST') {
      const id = tournamentIdFrom(body.id || body.name);
      if (!id || !String(body.name || '').trim()) return sendJson(res, 400, { error: 'Tournament name is required.' });
      const existing = await getTournament(id);
      if (existing) return sendJson(res, 409, { error: 'A tournament with this ID already exists. Edit the existing draft or choose another name.' });
      const legacyImmediateCreate = body.legacyGenerateFixtures === true || body.status === 'published';
      if (legacyImmediateCreate) {
        return sendJson(res, 409, { error: 'Immediate fixture creation is no longer supported. Create a draft, assign players, generate fixtures, preview, then publish.' });
      }
      const tournament = await saveTournamentDraft(normalizedDraft(body, id));
      return sendJson(res, 201, { tournament, tournaments: await listTournaments(), formats: TOURNAMENT_FORMATS });
    }

    if (req.method === 'PATCH') {
      const action = String(body.action || 'update');
      const tournamentId = String(body.tournamentId || '');
      if (!validTournamentId(tournamentId)) return sendJson(res, 400, { error: 'Valid tournament ID is required.' });
      const existing = await getTournament(tournamentId);
      if (!existing) return sendJson(res, 404, { error: 'Tournament not found.' });

      if (action === 'update') {
        if (existing.status !== 'draft') return sendJson(res, 409, { error: 'Only draft tournaments can be edited.' });
        const tournament = await saveTournamentDraft(normalizedDraft({
          ...existing,
          ...body,
          settings: { ...(existing.settings || {}), ...(body.settings || {}) },
        }, tournamentId));
        return sendJson(res, 200, { tournament, tournaments: await listTournaments() });
      }
      if (action === 'assignPlayers') {
        if (!Array.isArray(body.players)) return sendJson(res, 400, { error: 'Players must be an array.' });
        if (body.players.length !== Number(existing.maxPlayers)) return sendJson(res, 400, { error: `Assign exactly ${existing.maxPlayers} players.` });
        const labels = body.players.map((player) => String(player.label || '').trim());
        if (new Set(labels).size !== labels.length || labels.some((label) => !/^(?:[1-9]|1\d|20|[A-T])$/.test(label))) {
          return sendJson(res, 400, { error: 'Player labels must be unique permanent labels: men 1-20 or women A-T.' });
        }
        const rosterError = validateRosterForTournament(existing.tournamentType || 'mixed-doubles', body.players);
        if (rosterError) return sendJson(res, 400, { error: rosterError });
        const players = await assignTournamentPlayers(tournamentId, body.players);
        if (!players) return sendJson(res, 409, { error: 'Players can only be assigned to a draft tournament.' });
        return sendJson(res, 200, { tournament: await getTournament(tournamentId), players });
      }
      if (action === 'generateFixtures') {
        const generated = await generateTournamentFixtures(tournamentId);
        if (!generated) return sendJson(res, 409, { error: 'Assign the complete roster before generating fixtures. Draft schedules are capped at 1,200 matches.' });
        return sendJson(res, 200, generated);
      }
      if (action === 'publish') {
        const tournament = await publishTournament(tournamentId);
        if (!tournament) return sendJson(res, 409, { error: 'Generate and preview fixtures before publishing this draft.' });
        return sendJson(res, 200, { tournament, tournaments: await listTournaments() });
      }
      if (action === 'archive' || action === 'end') {
        if (existing.status !== 'published') return sendJson(res, 409, { error: 'Tournament is not active or has already ended.' });
        const tournament = await endTournament(tournamentId);
        if (!tournament) return sendJson(res, 409, { error: 'Tournament changed before it could be archived.' });
        return sendJson(res, 200, { tournament, tournaments: await listTournaments() });
      }
      return sendJson(res, 400, { error: 'Unsupported tournament action.' });
    }

    return methodNotAllowed(res, ['GET', 'POST', 'PATCH']);
  } catch (error) {
    console.error('Tournament API failed:', error);
    return sendJson(res, 503, { error: 'The tournament database is temporarily unavailable.' });
  }
}
