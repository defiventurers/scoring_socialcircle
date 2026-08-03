import { canModifyCourt, getSessionFromRequest } from './_lib/auth.js';
import { ensureDatabase, EVENT_ID, getMatch, getSql, listMatches } from './_lib/db.js';
import { methodNotAllowed, parseJsonBody, sendJson } from './_lib/http.js';

function isIntegerScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 15;
}

async function sendConflict(res, matchId, message = 'The match changed on another device.') {
  const latestMatch = await getMatch(matchId);
  return sendJson(res, 409, {
    error: message,
    match: latestMatch,
  });
}

async function runVersionedUpdate(sql, queryPromise, matchId, res) {
  const rows = await queryPromise;
  if (!rows[0]) {
    await sendConflict(res, matchId);
    return null;
  }
  return getMatch(matchId);
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

  try {
    await ensureDatabase();
    const sql = getSql();

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
        WHERE event_id = ${EVENT_ID}
      `;

      return sendJson(res, 200, { matches: await listMatches() });
    }

    const matchId = String(body.matchId || '');
    if (!/^court[1-4]_round(?:[1-9]|1\d|20)$/.test(matchId)) {
      return sendJson(res, 400, { error: 'Invalid match ID.' });
    }

    const match = await getMatch(matchId);
    if (!match) return sendJson(res, 404, { error: 'Match not found.' });

    if (!canModifyCourt(session, match.court)) {
      return sendJson(res, 403, { error: `You cannot modify Court ${match.court}.` });
    }

    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(match.version)) {
      return sendConflict(res, matchId);
    }

    let updatedMatch = null;

    if (action === 'score') {
      const team = body.team === 'A' ? 'A' : body.team === 'B' ? 'B' : null;
      if (!team) return sendJson(res, 400, { error: 'Invalid team.' });
      if (match.status === 'finalized') {
        return sendJson(res, 409, { error: 'This match is finalized and locked.', match });
      }
      if (match.teamAScore >= 15 || match.teamBScore >= 15) {
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
          WHERE event_id = ${EVENT_ID}
            AND id = ${matchId}
            AND version = ${expectedVersion}
            AND status <> 'finalized'
            AND team_a_score < 15
            AND team_b_score < 15
          RETURNING id
        `,
        matchId,
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
          WHERE event_id = ${EVENT_ID}
            AND id = ${matchId}
            AND version = ${expectedVersion}
            AND status <> 'finalized'
          RETURNING id
        `,
        matchId,
        res,
      );
    } else if (action === 'manualScore') {
      const scoreA = Number(body.scoreA);
      const scoreB = Number(body.scoreB);
      const isTimeLimit = Boolean(body.isTimeLimit);

      if (!isIntegerScore(scoreA) || !isIntegerScore(scoreB)) {
        return sendJson(res, 400, { error: 'Scores must be whole numbers from 0 to 15.' });
      }
      if (scoreA === scoreB) {
        return sendJson(res, 400, { error: 'Tied scores cannot be saved.' });
      }
      if (!isTimeLimit && scoreA !== 15 && scoreB !== 15) {
        return sendJson(res, 400, { error: 'A standard match must have a winner on 15 points.' });
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
          WHERE event_id = ${EVENT_ID}
            AND id = ${matchId}
            AND version = ${expectedVersion}
            AND status <> 'finalized'
          RETURNING id
        `,
        matchId,
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

      const finishReason =
        match.teamAScore === 15 || match.teamBScore === 15
          ? 'target-score'
          : 'time-limit';
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
          WHERE event_id = ${EVENT_ID}
            AND id = ${matchId}
            AND version = ${expectedVersion}
            AND status <> 'finalized'
            AND (team_a_score <> team_b_score)
            AND (team_a_score > 0 OR team_b_score > 0)
          RETURNING id
        `,
        matchId,
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
          WHERE event_id = ${EVENT_ID}
            AND id = ${matchId}
            AND version = ${expectedVersion}
          RETURNING id
        `,
        matchId,
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
          WHERE event_id = ${EVENT_ID}
            AND id = ${matchId}
            AND version = ${expectedVersion}
          RETURNING id
        `,
        matchId,
        res,
      );
    } else {
      return sendJson(res, 400, { error: 'Unsupported match action.' });
    }

    if (!updatedMatch) return;
    return sendJson(res, 200, { match: updatedMatch });
  } catch (error) {
    console.error(`Match action ${action || 'unknown'} failed:`, error);
    return sendJson(res, 503, {
      error: 'The shared match database could not save this change.',
    });
  }
}
