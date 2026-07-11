import { neon } from '@neondatabase/serverless';
import { EVENT_ID, FIXTURES } from './fixtures.js';

let sqlClient = null;
let databaseReadyPromise = null;

export function getSql() {
  if (sqlClient) return sqlClient;

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured for this Vercel project.');
  }

  sqlClient = neon(connectionString);
  return sqlClient;
}

async function initializeDatabase() {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS event_settings (
      event_id TEXT PRIMARY KEY,
      initialized BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      court INTEGER NOT NULL CHECK (court BETWEEN 1 AND 4),
      round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 20),
      scheduled_time TEXT NOT NULL,
      team_a JSONB NOT NULL,
      team_b JSONB NOT NULL,
      team_a_score INTEGER NOT NULL DEFAULT 0 CHECK (team_a_score >= 0),
      team_b_score INTEGER NOT NULL DEFAULT 0 CHECK (team_b_score >= 0),
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'finalized')),
      score_history JSONB NOT NULL DEFAULT '[]'::JSONB,
      started_at TIMESTAMPTZ,
      finalized_at TIMESTAMPTZ,
      finalized_by TEXT,
      finish_reason TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (event_id, court, round)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS matches_event_court_round_idx
      ON matches (event_id, court, round)
  `;

  await sql`
    INSERT INTO event_settings (event_id, initialized)
    VALUES (${EVENT_ID}, FALSE)
    ON CONFLICT (event_id) DO NOTHING
  `;

  const seedPayload = JSON.stringify(
    FIXTURES.map((fixture) => ({
      id: fixture.id,
      event_id: EVENT_ID,
      court: fixture.court,
      round: fixture.round,
      scheduled_time: fixture.scheduledTime,
      team_a: fixture.teamA,
      team_b: fixture.teamB,
    })),
  );

  await sql`
    INSERT INTO matches (
      id,
      event_id,
      court,
      round,
      scheduled_time,
      team_a,
      team_b
    )
    SELECT
      fixture.id,
      fixture.event_id,
      fixture.court,
      fixture.round,
      fixture.scheduled_time,
      fixture.team_a,
      fixture.team_b
    FROM jsonb_to_recordset(${seedPayload}::JSONB) AS fixture(
      id TEXT,
      event_id TEXT,
      court INTEGER,
      round INTEGER,
      scheduled_time TEXT,
      team_a JSONB,
      team_b JSONB
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    UPDATE event_settings
    SET initialized = TRUE, updated_at = NOW()
    WHERE event_id = ${EVENT_ID}
  `;
}

export async function ensureDatabase() {
  if (!databaseReadyPromise) {
    databaseReadyPromise = initializeDatabase().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }
  await databaseReadyPromise;
}

export async function listMatches() {
  await ensureDatabase();
  const sql = getSql();
  return sql`
    SELECT
      id,
      court,
      round,
      scheduled_time AS "time",
      team_a AS "teamA",
      team_b AS "teamB",
      team_a_score AS "teamAScore",
      team_b_score AS "teamBScore",
      status,
      score_history AS "scoreHistory",
      started_at AS "startedAt",
      finalized_at AS "finalizedAt",
      finalized_by AS "finalizedBy",
      finish_reason AS "finishReason",
      version,
      updated_at AS "updatedAt"
    FROM matches
    WHERE event_id = ${EVENT_ID}
    ORDER BY court, round
  `;
}

export async function getMatch(matchId) {
  await ensureDatabase();
  const sql = getSql();
  const rows = await sql`
    SELECT
      id,
      court,
      round,
      scheduled_time AS "time",
      team_a AS "teamA",
      team_b AS "teamB",
      team_a_score AS "teamAScore",
      team_b_score AS "teamBScore",
      status,
      score_history AS "scoreHistory",
      started_at AS "startedAt",
      finalized_at AS "finalizedAt",
      finalized_by AS "finalizedBy",
      finish_reason AS "finishReason",
      version,
      updated_at AS "updatedAt"
    FROM matches
    WHERE event_id = ${EVENT_ID} AND id = ${matchId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export { EVENT_ID };
