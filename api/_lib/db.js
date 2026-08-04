import { neon } from '@neondatabase/serverless';
import { EVENT_ID, FIXTURES } from './fixtures.js';
import { TOURNAMENT_FORMATS, calculateLeaderboardForTournament, generateInitialFixtures, generateNextAdaptiveFixtures, getFormatDefinitions, validateRosterForTournament } from './tournament-rules.js';


const DEFAULT_TOURNAMENT = {
  id: EVENT_ID,
  name: 'The Social Circle Mixed Pickleball Social',
  format: 'mixed-americano',
  status: 'published',
  tournamentType: 'mixed-doubles',
  date: null,
  location: null,
  numberOfCourts: 4,
  pointsToWin: 15,
  winBy: 1,
  maxPlayers: 40,
  settings: {
    roundDurationMinutes: 8,
    numberOfRounds: 20,
    scoringType: 'rally',
    serviceRotationPoints: 2,
    allowTimeLimitResults: true,
  },
};

function defaultPlayers() {
  const men = Array.from({ length: 20 }, (_, index) => ({ label: String(index + 1), gender: 'men' }));
  const women = Array.from({ length: 20 }, (_, index) => ({ label: String.fromCharCode(65 + index), gender: 'women' }));
  return [...men, ...women];
}


export function formatPlayerLabel(player) {
  return player.display_name ? `${player.label} • ${player.display_name}` : player.label;
}

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
    CREATE TABLE IF NOT EXISTS players (
      id BIGSERIAL PRIMARY KEY,
      label TEXT NOT NULL UNIQUE,
      display_name TEXT,
      gender TEXT NOT NULL CHECK (gender IN ('men', 'women', 'unknown')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      photo_url TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      date DATE,
      location TEXT,
      number_of_courts INTEGER NOT NULL DEFAULT 1,
      points_to_win INTEGER NOT NULL DEFAULT 15,
      win_by INTEGER NOT NULL DEFAULT 1,
      max_players INTEGER,
      settings JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE TABLE IF NOT EXISTS event_settings (event_id TEXT PRIMARY KEY, initialized BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS tournament_players (tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE, label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', seed INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tournament_id, player_id))`;
  await sql`CREATE TABLE IF NOT EXISTS courts (id BIGSERIAL PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, court_number INTEGER NOT NULL, name TEXT, status TEXT NOT NULL DEFAULT 'active', UNIQUE (tournament_id, court_number))`;
  await sql`CREATE TABLE IF NOT EXISTS rounds (id BIGSERIAL PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, round_number INTEGER NOT NULL, scheduled_time TEXT, status TEXT NOT NULL DEFAULT 'scheduled', UNIQUE (tournament_id, round_number))`;
  await sql`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS statistics (player_id BIGINT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, games_played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, points_scored INTEGER NOT NULL DEFAULT 0, points_conceded INTEGER NOT NULL DEFAULT 0, point_difference INTEGER NOT NULL DEFAULT 0, average_points NUMERIC NOT NULL DEFAULT 0, partner_history JSONB NOT NULL DEFAULT '{}'::JSONB, opponent_history JSONB NOT NULL DEFAULT '{}'::JSONB, court_history JSONB NOT NULL DEFAULT '{}'::JSONB, attendance JSONB NOT NULL DEFAULT '[]'::JSONB, streaks JSONB NOT NULL DEFAULT '{}'::JSONB, elo_rating NUMERIC NOT NULL DEFAULT 1000, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS leaderboards (tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, player_id BIGINT REFERENCES players(id), rank INTEGER NOT NULL, stats JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (tournament_id, rank))`;

  await sql`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ`;
  await sql`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ended_by TEXT`;
  await sql`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS tournament_type TEXT NOT NULL DEFAULT 'mixed-doubles'`;
  await sql`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
      court INTEGER NOT NULL,
      court_id BIGINT,
      round INTEGER NOT NULL,
      round_id BIGINT,
      scheduled_time TEXT NOT NULL,
      team_a JSONB NOT NULL,
      team_b JSONB NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
      winner TEXT,
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
  await sql`CREATE TABLE IF NOT EXISTS match_players (match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE, player_id BIGINT REFERENCES players(id), team TEXT NOT NULL CHECK (team IN ('A', 'B')), position INTEGER NOT NULL, label TEXT NOT NULL, display_name TEXT, PRIMARY KEY (match_id, team, position))`;
  await sql`CREATE TABLE IF NOT EXISTS scores (id BIGSERIAL PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE, team_a_score INTEGER NOT NULL, team_b_score INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament_id TEXT`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS winner TEXT`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB`;

  await sql`
    CREATE INDEX IF NOT EXISTS matches_event_court_round_idx
      ON matches (event_id, court, round)
  `;

  await sql`
    INSERT INTO tournaments (id, name, format, status, date, location, number_of_courts, points_to_win, win_by, max_players, settings)
    VALUES (${DEFAULT_TOURNAMENT.id}, ${DEFAULT_TOURNAMENT.name}, ${DEFAULT_TOURNAMENT.format}, ${DEFAULT_TOURNAMENT.status}, ${DEFAULT_TOURNAMENT.date}, ${DEFAULT_TOURNAMENT.location}, ${DEFAULT_TOURNAMENT.numberOfCourts}, ${DEFAULT_TOURNAMENT.pointsToWin}, ${DEFAULT_TOURNAMENT.winBy}, ${DEFAULT_TOURNAMENT.maxPlayers}, ${JSON.stringify(DEFAULT_TOURNAMENT.settings)}::JSONB)
    ON CONFLICT (id) DO NOTHING
  `;

  const defaultPlayersPayload = JSON.stringify(defaultPlayers());
  await sql`
    INSERT INTO players (label, gender)
    SELECT label, gender FROM jsonb_to_recordset(${defaultPlayersPayload}::JSONB) AS p(label TEXT, gender TEXT)
    ON CONFLICT (label) DO NOTHING
  `;


  await sql`INSERT INTO courts (tournament_id, court_number) SELECT ${EVENT_ID}, generate_series(1, ${DEFAULT_TOURNAMENT.numberOfCourts}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO rounds (tournament_id, round_number, scheduled_time) SELECT ${EVENT_ID}, round, MIN(scheduled_time) FROM jsonb_to_recordset(${JSON.stringify(FIXTURES)}::JSONB) AS f(id TEXT, event_id TEXT, court INTEGER, round INTEGER, scheduled_time TEXT, team_a JSONB, team_b JSONB) GROUP BY round ON CONFLICT DO NOTHING`;

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
      tournament_id,
      court,
      round,
      scheduled_time,
      team_a,
      team_b
    )
    SELECT
      fixture.id,
      fixture.event_id,
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

  const matchPlayersPayload = JSON.stringify(
    FIXTURES.flatMap((fixture) => [
      ...fixture.teamA.map((label, index) => ({ match_id: fixture.id, team: 'A', position: index + 1, label, display_name: null })),
      ...fixture.teamB.map((label, index) => ({ match_id: fixture.id, team: 'B', position: index + 1, label, display_name: null })),
    ]),
  );
  await sql`
    INSERT INTO match_players (match_id, team, position, label, display_name)
    SELECT match_id, team, position, label, display_name
    FROM jsonb_to_recordset(${matchPlayersPayload}::JSONB) AS mp(match_id TEXT, team TEXT, position INTEGER, label TEXT, display_name TEXT)
    ON CONFLICT (match_id, team, position) DO UPDATE
    SET label = EXCLUDED.label, display_name = EXCLUDED.display_name
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

export async function listMatches(tournamentId = EVENT_ID) {
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
      metadata,
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
    WHERE tournament_id = ${tournamentId}
    ORDER BY court, round
  `;
}

export async function getMatch(matchId, tournamentId = EVENT_ID) {
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
      metadata,
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
    WHERE id = ${matchId} AND tournament_id = ${tournamentId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export { EVENT_ID };


export async function listPlayers() {
  await ensureDatabase();
  const sql = getSql();
  return sql`SELECT id, label, display_name AS "displayName", gender, status, photo_url AS "photoUrl", notes, created_at AS "createdAt", updated_at AS "updatedAt" FROM players ORDER BY label`;
}

export async function updatePlayers(updates) {
  await ensureDatabase();
  const sql = getSql();
  for (const update of updates) {
    await sql`
      UPDATE players
      SET display_name = ${String(update.displayName || '').trim() || null}, updated_at = NOW()
      WHERE label = ${String(update.label || '').trim()}
    `;
  }
  return listPlayers();
}

export async function listTournaments() {
  await ensureDatabase();
  const sql = getSql();
  return sql`
    SELECT
      t.id,
      t.name,
      t.format,
      t.status,
      t.date,
      t.location,
      t.number_of_courts AS "numberOfCourts",
      t.points_to_win AS "pointsToWin",
      t.win_by AS "winBy",
      t.max_players AS "maxPlayers",
      t.tournament_type AS "tournamentType",
      t.settings,
      t.created_at AS "createdAt",
      t.updated_at AS "updatedAt",
      t.ended_at AS "endedAt",
      t.ended_by AS "endedBy",
      (SELECT COUNT(*)::INTEGER FROM matches m WHERE m.tournament_id = t.id) AS "matchCount",
      (SELECT COUNT(*)::INTEGER FROM tournament_players tp WHERE tp.tournament_id = t.id AND tp.status = 'active') AS "assignedPlayerCount"
    FROM tournaments t
    ORDER BY t.created_at DESC
  `;
}

export async function getTournament(tournamentId = EVENT_ID) {
  const tournaments = await listTournaments();
  return tournaments.find((t) => t.id === tournamentId) || null;
}

export async function getPublishedTournament() {
  const tournaments = await listTournaments();
  return tournaments.find((t) => t.status === 'published') || null;
}

export async function listTournamentPlayers(tournamentId) {
  await ensureDatabase();
  const sql = getSql();
  return sql`
    SELECT
      p.id,
      p.label,
      p.display_name AS "displayName",
      p.gender,
      tp.status,
      tp.seed
    FROM tournament_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.tournament_id = ${tournamentId}
    ORDER BY tp.seed, p.label
  `;
}

export async function assignTournamentPlayers(tournamentId, assignments) {
  await ensureDatabase();
  const sql = getSql();
  const tournament = await getTournament(tournamentId);
  if (!tournament || tournament.status !== 'draft') return null;

  const normalized = assignments.map((assignment, index) => ({
    label: String(assignment.label || '').trim(),
    displayName: String(assignment.displayName || '').trim() || null,
    gender: assignment.gender === 'men' || assignment.gender === 'women' ? assignment.gender : 'unknown',
    seed: index + 1,
  }));

  for (const assignment of normalized) {
    await sql`
      INSERT INTO players (label, display_name, gender)
      VALUES (${assignment.label}, ${assignment.displayName}, ${assignment.gender})
      ON CONFLICT (label) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        gender = EXCLUDED.gender,
        updated_at = NOW()
    `;
  }

  await sql`DELETE FROM tournament_players WHERE tournament_id = ${tournamentId}`;
  const payload = JSON.stringify(normalized);
  await sql`
    INSERT INTO tournament_players (tournament_id, player_id, label, seed)
    SELECT ${tournamentId}, p.id, selected.label, selected.seed
    FROM jsonb_to_recordset(${payload}::JSONB) AS selected(label TEXT, "displayName" TEXT, gender TEXT, seed INTEGER)
    JOIN players p ON p.label = selected.label
  `;
  return listTournamentPlayers(tournamentId);
}

export async function saveTournamentDraft(input) {
  await ensureDatabase();
  const sql = getSql();
  const existing = await getTournament(input.id);
  if (existing && existing.status !== 'draft') return null;
  await sql`
    INSERT INTO tournaments (id, name, format, status, tournament_type, date, location, number_of_courts, points_to_win, win_by, max_players, settings)
    VALUES (${input.id}, ${input.name}, ${input.format}, 'draft', ${input.tournamentType}, ${input.date || null}, ${input.location || null}, ${input.numberOfCourts}, ${input.pointsToWin}, ${input.winBy}, ${input.maxPlayers}, ${JSON.stringify(input.settings || {})}::JSONB)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      format = EXCLUDED.format,
      tournament_type = EXCLUDED.tournament_type,
      date = EXCLUDED.date,
      location = EXCLUDED.location,
      number_of_courts = EXCLUDED.number_of_courts,
      points_to_win = EXCLUDED.points_to_win,
      win_by = EXCLUDED.win_by,
      max_players = EXCLUDED.max_players,
      settings = EXCLUDED.settings,
      updated_at = NOW()
  `;
  return getTournament(input.id);
}

export async function generateTournamentFixtures(tournamentId) {
  await ensureDatabase();
  const sql = getSql();
  const tournament = await getTournament(tournamentId);
  if (!tournament || tournament.status !== 'draft') return null;
  const tournamentPlayers = await listTournamentPlayers(tournamentId);
  const playerRecords = await listPlayers();
  const byLabel = new Map(playerRecords.map((player) => [player.label, player]));
  const roster = tournamentPlayers.map((player) => byLabel.get(player.label) || player);
  const validation = validateRosterForTournament(tournament.tournamentType || 'mixed-doubles', roster);
  if (validation) return null;
  const generatedMatches = generateInitialFixtures(tournament, roster);
  if (!generatedMatches.length || generatedMatches.length > 1200) return null;
  const matchPlayersPayload = JSON.stringify(generatedMatches.flatMap((match) => [
    ...match.team_a.map((label, index) => ({ matchId: match.id, label, team: 'A', position: index + 1 })),
    ...match.team_b.map((label, index) => ({ matchId: match.id, label, team: 'B', position: index + 1 })),
  ]));
  const fixturePayload = JSON.stringify(generatedMatches);
  await sql.transaction((tx) => [
    tx`SELECT pg_advisory_xact_lock(hashtext(${tournamentId}))`,
    tx`DELETE FROM rounds WHERE tournament_id = ${tournamentId}`,
    tx`DELETE FROM matches WHERE tournament_id = ${tournamentId}`,
    tx`DELETE FROM courts WHERE tournament_id = ${tournamentId}`,
    tx`INSERT INTO courts (tournament_id, court_number) SELECT ${tournamentId}, generate_series(1, ${tournament.numberOfCourts})`,
    tx`INSERT INTO rounds (tournament_id, round_number, scheduled_time)
       SELECT ${tournamentId}, round, MIN(scheduled_time)
       FROM jsonb_to_recordset(${fixturePayload}::JSONB) AS f(round INTEGER, scheduled_time TEXT)
       GROUP BY round`,
    tx`INSERT INTO matches (id, event_id, tournament_id, court, round, scheduled_time, team_a, team_b, metadata)
       SELECT id, event_id, tournament_id, court, round, scheduled_time, team_a, team_b, metadata
       FROM jsonb_to_recordset(${fixturePayload}::JSONB) AS fixture(
         id TEXT, event_id TEXT, tournament_id TEXT, court INTEGER, round INTEGER,
         scheduled_time TEXT, team_a JSONB, team_b JSONB, metadata JSONB
       )`,
    tx`INSERT INTO match_players (match_id, player_id, team, position, label, display_name)
       SELECT selected."matchId", p.id, selected.team, selected.position, p.label, p.display_name
       FROM jsonb_to_recordset(${matchPlayersPayload}::JSONB) AS selected("matchId" TEXT, label TEXT, team TEXT, position INTEGER)
       JOIN players p ON p.label = selected.label`,
  ], { isolationLevel: 'Serializable' });
  return { tournament: await getTournament(tournamentId), matches: await listMatches(tournamentId) };
}

export async function publishTournament(tournamentId) {
  await ensureDatabase();
  const sql = getSql();
  const tournament = await getTournament(tournamentId);
  if (!tournament || tournament.status !== 'draft' || Number(tournament.matchCount) < 1) return null;
  await sql`
    UPDATE tournaments
    SET status = 'archived', ended_at = NOW(), ended_by = 'admin', updated_at = NOW()
    WHERE id <> ${tournamentId} AND status = 'published'
  `;
  const rows = await sql`
    UPDATE tournaments
    SET status = 'published', ended_at = NULL, ended_by = NULL, updated_at = NOW()
    WHERE id = ${tournamentId} AND status = 'draft'
    RETURNING id
  `;
  return rows[0] ? getTournament(tournamentId) : null;
}

export async function appendAdaptiveFixtures(tournamentId) {
  await ensureDatabase();
  const tournament = await getTournament(tournamentId);
  if (!tournament || tournament.status !== 'published') return [];
  const roster = await listTournamentPlayers(tournamentId);
  const latest = await listMatches(tournamentId);
  const generated = generateNextAdaptiveFixtures(tournament, roster, latest);
  if (!generated.length) return [];
  const sql = getSql();
  const matchPlayersPayload = JSON.stringify(generated.flatMap((match) => [
    ...match.team_a.map((label, index) => ({ matchId: match.id, label, team: 'A', position: index + 1 })),
    ...match.team_b.map((label, index) => ({ matchId: match.id, label, team: 'B', position: index + 1 })),
  ]));
  const payload = JSON.stringify(generated);
  await sql.transaction((tx) => [
    tx`SELECT pg_advisory_xact_lock(hashtext(${tournamentId}))`,
    tx`INSERT INTO rounds (tournament_id, round_number, scheduled_time)
       SELECT ${tournamentId}, round, MIN(scheduled_time)
       FROM jsonb_to_recordset(${payload}::JSONB) AS f(round INTEGER, scheduled_time TEXT)
       GROUP BY round ON CONFLICT DO NOTHING`,
    tx`INSERT INTO matches (id, event_id, tournament_id, court, round, scheduled_time, team_a, team_b, metadata)
       SELECT id, event_id, tournament_id, court, round, scheduled_time, team_a, team_b, metadata
       FROM jsonb_to_recordset(${payload}::JSONB) AS fixture(id TEXT, event_id TEXT, tournament_id TEXT, court INTEGER, round INTEGER, scheduled_time TEXT, team_a JSONB, team_b JSONB, metadata JSONB)
       ON CONFLICT (id) DO NOTHING`,
    tx`INSERT INTO match_players (match_id, player_id, team, position, label, display_name)
       SELECT selected."matchId", p.id, selected.team, selected.position, p.label, p.display_name
       FROM jsonb_to_recordset(${matchPlayersPayload}::JSONB) AS selected("matchId" TEXT, label TEXT, team TEXT, position INTEGER)
       JOIN players p ON p.label = selected.label
       ON CONFLICT (match_id, team, position) DO UPDATE SET player_id = EXCLUDED.player_id, label = EXCLUDED.label, display_name = EXCLUDED.display_name`,
  ], { isolationLevel: 'Serializable' });
  return listMatches(tournamentId);
}

export async function endTournament(tournamentId) {
  await ensureDatabase();
  const sql = getSql();
  const rows = await sql`
    UPDATE tournaments
    SET status = 'archived', ended_at = NOW(), ended_by = 'admin', updated_at = NOW()
    WHERE id = ${tournamentId} AND status = 'published'
    RETURNING id
  `;
  if (!rows[0]) return null;
  return getTournament(tournamentId);
}

export async function listCourts(tournamentId = EVENT_ID) {
  await ensureDatabase();
  const sql = getSql();
  return sql`SELECT id, court_number AS "courtNumber", name, status FROM courts WHERE tournament_id = ${tournamentId} ORDER BY court_number`;
}

export async function listRounds(tournamentId = EVENT_ID) {
  await ensureDatabase();
  const sql = getSql();
  return sql`SELECT id, round_number AS "roundNumber", scheduled_time AS "scheduledTime", status FROM rounds WHERE tournament_id = ${tournamentId} ORDER BY round_number`;
}

export async function getLeaderboard(tournamentId = EVENT_ID) {
  const tournament = await getTournament(tournamentId);
  const matches = await listMatches(tournamentId);
  const roster = await listTournamentPlayers(tournamentId);
  const fallbackRoster = roster.length ? roster : await listPlayers();
  return calculateLeaderboardForTournament(tournament, matches, fallbackRoster);
}

function createSeededMatches({ tournamentId, numberOfCourts, playerLabels, rounds = 20, startHour = 11, intervalMinutes = 8 }) {
  const labels = playerLabels.length >= 4 ? playerLabels : ['A', '1', 'B', '2'];
  const matches = [];
  for (let round = 1; round <= rounds; round += 1) {
    const totalMinutes = startHour * 60 + (round - 1) * intervalMinutes;
    const hour24 = Math.floor(totalMinutes / 60) % 24;
    const minute = totalMinutes % 60;
    const hour12 = ((hour24 + 11) % 12) + 1;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const scheduledTime = `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
    for (let court = 1; court <= numberOfCourts; court += 1) {
      const offset = ((round - 1) * numberOfCourts * 4 + (court - 1) * 4) % labels.length;
      const selected = Array.from({ length: Math.min(4, labels.length) }, (_, index) => labels[(offset + index) % labels.length]);
      if (new Set(selected).size < 4) throw new Error('At least four unique assigned players are required.');
      const teamA = [selected[0], selected[1]];
      const teamB = [selected[2], selected[3]];
      matches.push({
        id: `${tournamentId}_court${court}_round${round}`,
        event_id: tournamentId,
        tournament_id: tournamentId,
        court,
        round,
        scheduled_time: scheduledTime,
        team_a: teamA,
        team_b: teamB,
      });
    }
  }
  return matches;
}

export async function createTournamentWithFixtures(input) {
  await ensureDatabase();
  const sql = getSql();
  const id = input.id;
  const numberOfCourts = Math.max(1, Math.min(12, Number(input.numberOfCourts || 1)));
  const maxPlayers = Math.max(4, Math.min(40, Number(input.maxPlayers || input.numberOfPlayers || 4)));
  const pointsToWin = Math.max(1, Number(input.pointsToWin || 15));
  const winBy = Math.max(1, Number(input.winBy || 1));
  const settings = input.settings || {};
  const labels = [
    ...Array.from({ length: Math.min(20, Math.ceil(maxPlayers / 2)) }, (_, index) => String.fromCharCode(65 + index)),
    ...Array.from({ length: Math.min(20, Math.floor(maxPlayers / 2)) }, (_, index) => String(index + 1)),
  ].slice(0, maxPlayers);
  const generatedMatches = createSeededMatches({
    tournamentId: id,
    numberOfCourts,
    playerLabels: labels,
    rounds: Number(settings.numberOfRounds || 20),
    startHour: Number(settings.startHour || 11),
    intervalMinutes: Number(settings.intervalMinutes || 8),
  });

  await sql`
      INSERT INTO tournaments (id, name, format, status, date, location, number_of_courts, points_to_win, win_by, max_players, settings)
      VALUES (${id}, ${input.name}, ${input.format}, ${input.status || 'draft'}, ${input.date || null}, ${input.location || null}, ${numberOfCourts}, ${pointsToWin}, ${winBy}, ${maxPlayers}, ${JSON.stringify(settings)}::JSONB)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

  const created = await getTournament(id);
  if (!created || created.name !== input.name || Number(created.matchCount) > 0) return null;

  // There can only be one live event. Preserve completed events and their
  // scores, but archive them when a different event is published.
  if ((input.status || 'draft') === 'published') {
    await sql`
      UPDATE tournaments
      SET status = 'archived', ended_at = NOW(), ended_by = 'admin', updated_at = NOW()
      WHERE id <> ${id} AND status = 'published'
    `;
  }

  const tournamentPlayersPayload = JSON.stringify(labels.map((label, index) => ({ label, seed: index + 1 })));
  await sql`
      INSERT INTO tournament_players (tournament_id, player_id, label, seed)
      SELECT ${id}, players.id, players.label, selected.seed
      FROM jsonb_to_recordset(${tournamentPlayersPayload}::JSONB) AS selected(label TEXT, seed INTEGER)
      JOIN players ON players.label = selected.label
      ON CONFLICT (tournament_id, player_id) DO UPDATE SET label = EXCLUDED.label, seed = EXCLUDED.seed, status = 'active'
    `;

  await sql`INSERT INTO courts (tournament_id, court_number) SELECT ${id}, generate_series(1, ${numberOfCourts}) ON CONFLICT DO NOTHING`;
  await sql`DELETE FROM rounds WHERE tournament_id = ${id}`;
  await sql`DELETE FROM matches WHERE tournament_id = ${id}`;
  await sql`
      INSERT INTO rounds (tournament_id, round_number, scheduled_time)
      SELECT ${id}, round, MIN(scheduled_time)
      FROM jsonb_to_recordset(${JSON.stringify(generatedMatches)}::JSONB) AS f(round INTEGER, scheduled_time TEXT)
      GROUP BY round
    `;
  await sql`
      INSERT INTO matches (id, event_id, tournament_id, court, round, scheduled_time, team_a, team_b)
      SELECT id, event_id, tournament_id, court, round, scheduled_time, team_a, team_b
      FROM jsonb_to_recordset(${JSON.stringify(generatedMatches)}::JSONB) AS fixture(
        id TEXT,
        event_id TEXT,
        tournament_id TEXT,
        court INTEGER,
        round INTEGER,
        scheduled_time TEXT,
        team_a JSONB,
        team_b JSONB
      )
    `;

  return getTournament(id);
}

export { TOURNAMENT_FORMATS };
