import { canModifyCourt, getSessionFromRequest } from './_lib/auth.js';
import { appendAdaptiveFixtures, ensureDatabase, EVENT_ID, getMatch, getSql, getTournament, listMatches } from './_lib/db.js';
import { methodNotAllowed, parseJsonBody, sendJson } from './_lib/http.js';

async function sendConflict(res, matchId, tournamentId, message = 'The match changed on another device.') {
  const latestMatch = await getMatch(matchId, tournamentId);
  return sendJson(res, 409, {
    error: message,
    match: latestMatch,
  });
}

async function runVersionedUpdate(sql, queryPromise, matchId, tournamentId, res) {
  const rows = await queryPromise;
  if (!rows[0]) {
    await sendConflict(res, matchId, tournamentId);
    return null;
  }
  return getMatch(matchId, tournamentId);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
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

  const body = parseJsonBody(req);
  if (!body) return sendJson(res, 400, { error: 'Invalid JSON body.' });

  const action = String(body.action || '');
  const tournamentId = String(body.tournamentId || EVENT_ID);
  if (!/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/.test(tournamentId)) {
    return sendJson(res, 400, { error: 'Invalid tournament ID.' });
  }

  try {
    await ensureDatabase();
    const sql = getSql();
    const tournament = await getTournament(tournamentId);
    if (!tournament) {
      return sendJson(res, 404, { error: 'Tournament not found.' });
    }
    if (tournament.status !== 'published') {
      return sendJson(res, 409, { error: 'This event has ended. Its matches are read-only.' });
    }
    const targetScore = Math.max(1, Number(tournament.pointsToWin || 15));
    const winBy = Math.max(1, Number(tournament.winBy || 1));
    const settings = tournament.settings || {};
    const allowManualScoreOverrides = settings.allowManualScoreOverrides !== false;
    const allowTimeLimitResults = settings.allowTimeLimitResults !== false;
    const isIntegerScore = (value) => Number.isInteger(value) && value >= 0 && value <= targetScore + winBy - 1;

    if (action === 'resetAll') {
      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Only the administrator can reset the tournament.' });
      }

      await sql`
        UPDATE matches
        SET
          team_a_score = 0,
          team_b_score = 0,
          status = 'scheduled',
          score_history = '[]'::JSONB,
          started_at = NULL,
          finalized_at = NULL,
          finalized_by = NULL,
          finish_reason = NULL,
          winner = NULL,
          version = version + 1,
          updated_at = NOW()
        WHERE tournament_id = ${tournamentId}
          AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${tournamentId} AND status = 'published')
      `;

      return sendJson(res, 200, { matches: await listMatches(tournamentId) });
    }

    const matchId = String(body.matchId || '');
    if (!/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?_court\d+_round\d+$/.test(matchId) && !/^court\d+_round\d+$/.test(matchId)) {
      return sendJson(res, 400, { error: 'Invalid match ID.' });
    }

    const match = await getMatch(matchId, tournamentId);
    if (!match) return sendJson(res, 404, { error: 'Match not found.' });

    if (!canModifyCourt(session, match.court)) {
      return sendJson(res, 403, { error: `You cannot modify Court ${match.court}.` });
    }

    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(match.version)) {
      return sendConflict(res, matchId, tournamentId);
    }

    let updatedMatch = null;

    if (action === 'score') {
      const team = body.team === 'A' ? 'A' : body.team === 'B' ? 'B' : null;
      if (!team) return sendJson(res, 400, { error: 'Invalid team.' });
      if (match.status === 'finalized') {
        return sendJson(res, 409, { error: 'This match is finalized and locked.', match });
      }
      if (match.teamAScore >= targetScore + winBy - 1 || match.teamBScore >= targetScore + winBy - 1) {
        return sendJson(res, 409, { error: 'The target score is already reached.', match });
      }

      updatedMatch = await runVersionedUpdate(
        sql,
        sql`
          UPDATE matches
          SET
            score_history = score_history || jsonb_build_array(
              jsonb_build_object(
                'teamAScore', team_a_score,
                'teamBScore', team_b_score
              )
            ),
            team_a_score = team_a_score + ${team === 'A' ? 1 : 0},
            team_b_score = team_b_score + ${team === 'B' ? 1 : 0},
            status = CASE WHEN status = 'scheduled' THEN 'active' ELSE status END,
            started_at = COALESCE(started_at, NOW()),
            version = version + 1,
            updated_at = NOW()
          WHERE tournament_id = ${tournamentId}
          AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${tournamentId} AND status = 'published')
            AND id = ${matchId}
            AND version = ${expectedVersion}
            AND status <> 'finalized'
            AND team_a_score < ${targetScore + winBy - 1}
            AND team_b_score < ${targetScore + winBy - 1}
          RETURNING id
        `,
        matchId,
        tournamentId,
        res,
      );
    } else if (action === 'undo') {
      if (match.status === 'finalized') {
        return sendJson(res, 409, { error: 'This match is finalized and locked.', match });
      }
      const history = Array.isArray(match.scoreHistory) ? match.scoreHistory : [];
      if (history.length === 0) {
        return sendJson(res, 409, { error: 'There is no point to undo.', match });
      }

      const previous = history[history.length - 1];
      const remainingHistory = history.slice(0, -1);
      const returnsToScheduled = previous.teamAScore === 0 && previous.teamBScore === 0;

      updatedMatch = await runVersionedUpdate(
        sql,
        sql`
          UPDATE matches
          SET
            team_a_score = ${Number(previous.teamAScore)},
            team_b_score = ${Number(previous.teamBScore)},
            score_history = ${JSON.stringify(remainingHistory)}::JSONB,
            status = ${returnsToScheduled ? 'scheduled' : 'active'},
            started_at = CASE WHEN ${returnsToScheduled} THEN NULL ELSE started_at END,
            version = version + 1,
            updated_at = NOW()
          WHERE tournament_id = ${tournamentId}
          AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${tournamentId} AND status = 'published')
            AND id = ${matchId}
            AND version = ${expectedVersion}
            AND status <> 'finalized'
          RETURNING id
        `,
        matchId,
        tournamentId,
        res,
      );
    } else if (action === 'manualScore') {
      if (!allowManualScoreOverrides) {
        return sendJson(res, 403, { error: 'Manual score overrides are disabled for this tournament.' });
      }
      const scoreA = Number(body.scoreA);
      const scoreB = Number(body.scoreB);
      const isTimeLimit = Boolean(body.isTimeLimit);

      if (!isIntegerScore(scoreA) || !isIntegerScore(scoreB)) {
        return sendJson(res, 400, { error: `Scores must be whole numbers from 0 to ${targetScore + winBy - 1}.` });
      }
      if (scoreA === scoreB) {
        return sendJson(res, 400, { error: 'Tied scores cannot be saved.' });
      }
      if (isTimeLimit && !allowTimeLimitResults) {
        return sendJson(res, 400, { error: 'Time-limit results are disabled for this tournament.' });
      }
      const reachesTarget = Math.max(scoreA, scoreB) >= targetScore && Math.abs(scoreA - scoreB) >= winBy;
      if (!isTimeLimit && !reachesTarget) {
        return sendJson(res, 400, { error: `A standard match requires at least ${targetScore} points and a ${winBy}-point winning margin.` });
      }
      if (match.status === 'finalized') {
        return sendJson(res, 409, { error: 'This match is finalized and locked.', match });
      }

      updatedMatch = await runVersionedUpdate(
        sql,
        sql`
          UPDATE matches
          SET
            score_history = score_history || jsonb_build_array(
              jsonb_build_object(
                'teamAScore', team_a_score,
                'teamBScore', team_b_score
              )
            ),
            team_a_score = ${scoreA},
            team_b_score = ${scoreB},
            status = 'active',
            started_at = COALESCE(started_at, NOW()),
            finish_reason = ${isTimeLimit ? 'time-limit' : 'target-score'},
            version = version + 1,
            updated_at = NOW()
          WHERE tournament_id = ${tournamentId}
          AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${tournamentId} AND status = 'published')
            AND id = ${matchId}
            AND version = ${expectedVersion}
            AND status <> 'finalized'
          RETURNING id
        `,
        matchId,
        tournamentId,
        res,
      );
    } else if (action === 'finalize') {
      if (match.status === 'finalized') {
        return sendJson(res, 409, { error: 'This match is already finalized.', match });
      }
      if (match.teamAScore === 0 && match.teamBScore === 0) {
        return sendJson(res, 400, { error: 'A 0–0 match cannot be finalized.' });
      }
      if (match.teamAScore === match.teamBScore) {
        return sendJson(res, 400, { error: 'A tied match cannot be finalized.' });
      }

      const reachesTarget = Math.max(match.teamAScore, match.teamBScore) >= targetScore && Math.abs(match.teamAScore - match.teamBScore) >= winBy;
      if (!reachesTarget && !allowTimeLimitResults) {
        return sendJson(res, 400, { error: `A standard match requires at least ${targetScore} points and a ${winBy}-point winning margin.` });
      }
      const finishReason = reachesTarget ? 'target-score' : 'time-limit';
      const finalizedBy = session.role === 'admin' ? 'admin' : `Court ${session.court}`;

      updatedMatch = await runVersionedUpdate(
        sql,
        sql`
          UPDATE matches
          SET
            status = 'finalized',
            finalized_at = NOW(),
            finalized_by = ${finalizedBy},
            finish_reason = ${finishReason},
            winner = CASE WHEN team_a_score > team_b_score THEN 'A' ELSE 'B' END,
            version = version + 1,
            updated_at = NOW()
          WHERE tournament_id = ${tournamentId}
          AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${tournamentId} AND status = 'published')
            AND id = ${matchId}
            AND version = ${expectedVersion}
            AND status <> 'finalized'
            AND (team_a_score <> team_b_score)
            AND (team_a_score > 0 OR team_b_score > 0)
          RETURNING id
        `,
        matchId,
        tournamentId,
        res,
      );
    } else if (action === 'reopen') {
      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Only the administrator can reopen a match.' });
      }

      updatedMatch = await runVersionedUpdate(
        sql,
        sql`
          UPDATE matches
          SET
            status = 'active',
            finalized_at = NULL,
            finalized_by = NULL,
            winner = NULL,
            version = version + 1,
            updated_at = NOW()
          WHERE tournament_id = ${tournamentId}
          AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${tournamentId} AND status = 'published')
            AND id = ${matchId}
            AND version = ${expectedVersion}
          RETURNING id
        `,
        matchId,
        tournamentId,
        res,
      );
    } else if (action === 'reset') {
      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Only the administrator can reset a match.' });
      }

      updatedMatch = await runVersionedUpdate(
        sql,
        sql`
          UPDATE matches
          SET
            team_a_score = 0,
            team_b_score = 0,
            status = 'scheduled',
            score_history = '[]'::JSONB,
            started_at = NULL,
            finalized_at = NULL,
            finalized_by = NULL,
            finish_reason = NULL,
            winner = NULL,
            version = version + 1,
            updated_at = NOW()
          WHERE tournament_id = ${tournamentId}
          AND EXISTS (SELECT 1 FROM tournaments WHERE id = ${tournamentId} AND status = 'published')
            AND id = ${matchId}
            AND version = ${expectedVersion}
          RETURNING id
        `,
        matchId,
        tournamentId,
        res,
      );
    } else {
      return sendJson(res, 400, { error: 'Unsupported match action.' });
    }

    if (!updatedMatch) return;
    if (action === 'finalize') {
      const matches = await appendAdaptiveFixtures(tournamentId);
      return sendJson(res, 200, { match: updatedMatch, ...(matches.length ? { matches } : {}) });
    }
    return sendJson(res, 200, { match: updatedMatch });
  } catch (error) {
    console.error(`Match action ${action || 'unknown'} failed:`, error);
    return sendJson(res, 503, {
      error: 'The shared match database could not save this change.',
    });
  }
}
