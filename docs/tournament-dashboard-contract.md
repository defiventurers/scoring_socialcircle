# Tournament Operations Dashboard Contract Review

## Scope and authoritative path

The deployed application is the classic client: `index.html`, `app.js`, and
`firebase-config.js`. Vite copies those files into `dist`; `src/App.tsx` is not the
production dashboard (`docs/mobile-ux-architecture.md:33-44`). Dashboard work must
therefore target the classic client unless a separate migration is approved.

Current authoritative records are:

- `tournaments`: format, lifecycle status, court count, scoring rules, and settings.
- `matches`: physical court/wave, teams, score, lifecycle timestamps, and format metadata.
- `rounds`: generated physical waves, but its status is currently never synchronized.
- `courts`: configured courts, but its status only means configured active/inactive; it is
  not occupancy.
- `tournament_players`: assigned roster.
- The server-computed leaderboard, including zero-game roster entries.

`GET /api/matches` already returns `{ matches, leaderboard, tournament, serverTime }`
(`api/matches.js:35-42`). Add one server-authoritative `operations` object to that
response. Do not make the production dashboard combine `/api/matches`, `/api/courts`,
and `/api/fixtures`: the existing one-second poll in `firebase-config.js:235-287`
should receive one internally consistent snapshot.

“Internally consistent” requires one authoritative read set. Fetch tournament, matches,
roster, and courts under one repeatable-read transaction (or equivalent database snapshot),
then calculate both leaderboard and operations from those exact in-memory rows. The current
sequence is not sufficient: `api/matches.js:35-40` reads matches, then `getLeaderboard()`
re-reads tournament, matches, and roster through `api/_lib/db.js:553-558`, so a concurrent
score write can mix versions. If the serverless database client cannot expose a repeatable
snapshot, the API must label the payload eventually consistent and clients must not treat
its revision as an atomic snapshot.

## Existing match contract and required additions

Existing match fields come from `api/_lib/db.js:240-294`:

```ts
type ExistingMatch = {
  id: string;
  court: number;
  round: number;              // physical scheduling wave, not always format stage
  time: string;               // display-only 12-hour time, no date/time zone
  teamA: string[];
  teamB: string[];
  metadata: Record<string, unknown>;
  teamAScore: number;
  teamBScore: number;
  status: "scheduled" | "active" | "finalized";
  scoreHistory: Array<{
    teamAScore: number;
    teamBScore: number;
    scoreState?: Record<string, unknown>;
  }>;
  startedAt: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
  finishReason: "target-score" | "time-limit" | string | null;
  scoreState?: Record<string, unknown> | null; // present in the concurrent multi-sport worktree
  version: number;
  updatedAt: string;
};
```

Add these fields to each match response:

```ts
type MatchOperations = ExistingMatch & {
  physicalWave: number;       // equal to current round during migration
  logicalStage: number;       // metadata.stage, otherwise physicalWave
  stageLabel: string;         // e.g. "Round 3", "Semi-final", "Swiss round 4"
  scheduledStartAt: string | null; // ISO-8601 instant; null means no trustworthy ETA
  readyState: "blocked" | "ready" | "on-court" | "complete";
  blockedByMatchIds: string[];
};
```

Persist `scheduled_start_at TIMESTAMPTZ` rather than parsing `scheduled_time`. Keep
`scheduled_time`/`time` temporarily for display compatibility. Add explicit dependency
metadata (`sourceMatchIds`, or normalized `match_dependencies`) for knockout fixtures;
a stage number alone cannot explain which upstream result blocks a match.

## Proposed `operations` response

```ts
type OperationsSnapshot = {
  asOf: string;               // same instant as serverTime
  revision: string;           // monotonic tournament-wide operations revision
  consistency: "atomic" | "eventual";
  lifecycleStatus: "draft" | "published" | "archived";
  phase: "not-started" | "in-progress" | "awaiting-progression" | "complete" | "ended-incomplete";
  progress: {
    generated: number;
    finalized: number;
    active: number;
    scheduled: number;
    completionRatio: number | null;
    totalMode: "fixed" | "generated-so-far";
  };
  waves: WaveSummary[];
  courts: CourtSummary[];
  players: PlayerReadiness[];
  eta: {
    basis: "actual-median" | "configured-duration" | "unavailable";
    sampleSize: number;
    typicalMatchSeconds: number | null;
    estimatedFinishAt: string | null;
    confidence: "low" | "medium" | "high" | null;
  };
  progression: {
    mode: "fixed" | "adaptive";
    currentStage: number | null;
    stageState: "not-started" | "playing" | "blocked" | "ready-to-generate" | "generated" | "complete";
    expectedStageMatchCount: number | null;
    finalizedStageMatchCount: number;
    lastError: { code: string; message: string; at: string } | null;
  };
};
```

Implement `deriveTournamentOperations(tournament, matches, roster, courts, now)` in a
new `api/_lib/tournament-operations.js`. In `api/matches.js:35-42`, load one shared
repeatable-read snapshot and pass the same rows to
`calculateLeaderboardForTournament(tournament, matches, roster)` and
`deriveTournamentOperations(...)`; do not call `getLeaderboard()` because it re-reads the
database. Return the same snapshot after successful writes from
`api/match-action.js:347-352` to avoid a transient stale dashboard.

`revision` must not be `max(match.version)` or `max(updatedAt)`: unrelated snapshots can
share that maximum, and tournament, roster, court, or progression mutations may not touch a
match. Add a tournament-wide monotonic `operations_revision` incremented transactionally by
every mutation that changes snapshot inputs. A canonical hash over all normalized snapshot
inputs is an acceptable alternative, but it is more expensive. Return `consistency: atomic`
only when all fields came from one database snapshot.

## Exact derivations

All sets below are scoped to one `tournament_id`.

```text
M = all generated matches
F = {m in M | m.status = finalized}
A = {m in M | m.status = active}
S = {m in M | m.status = scheduled}
stage(m) = integer(m.metadata.stage) when present, else m.round
wave(m) = m.round
players(m) = set(m.teamA union m.teamB)
```

### Progress

```text
generated = |M|
finalized = |F|
active = |A|
scheduled = |S|
completionRatio = finalized / generated, when generated > 0
```

For fixed formats (`rotating`, `custom`, `fixed-round-robin`, `pool`),
`totalMode = fixed` after fixture generation and the denominator is stable. For adaptive
formats listed in `api/_lib/tournament-rules.js:281-292`, use
`totalMode = generated-so-far`: `finalized / generated` is only completion of currently
generated work, not tournament completion. Never label it “tournament percent” until the
format engine exposes a terminal total.

```text
competitiveTerminal = format-specific terminal predicate over the authoritative snapshot
phase = ended-incomplete
  iff tournament.status = archived AND competitiveTerminal is false
phase = complete
  iff competitiveTerminal is true
phase = awaiting-progression
  iff tournament.status = published AND adaptive AND
      all matches in max(stage(M)) finalized AND competitiveTerminal is false
phase = in-progress
  iff tournament.status = published AND (|A| > 0 OR |F| > 0)
phase = not-started otherwise
```

Lifecycle and competitive completion are separate. An administrator can archive through
`firebase-config.js:987-1001` while unfinished matches remain, so `archived` alone must
never mean competitively complete. Return `lifecycleStatus` alongside `phase`; a future
explicit cancellation lifecycle can replace `ended-incomplete` if cancellation reasons are
persisted.

### Physical wave/round state

For each `w` in distinct `wave(M)`:

```text
dependenciesResolved(m) = every blockedBy/source match is finalized
participantsFree(m) = no player in players(m) appears in another active match
courtFree(m) = no other active match uses m.court
ready(m) = m.status = scheduled AND dependenciesResolved(m) AND
           participantsFree(m) AND courtFree(m)

waveMatches = {m in M | wave(m) = w}
wave.status = complete  iff every waveMatch finalized
wave.status = active    iff any waveMatch active
wave.status = ready     iff no waveMatch is active and at least one waveMatch is ready
wave.status = blocked   iff unfinished waveMatches exist and none is ready
wave.finalized = count(finalized waveMatches)
wave.total = |waveMatches|
```

Do not derive current round as `max(finalized round) + 1`: courts can be staggered.
Return all live waves, or define `displayWave = min(wave(m))` over non-finalized matches.
The `rounds.status` column created at `api/_lib/db.js:95` is currently stale because no
score mutation updates it; either derive wave status as above or maintain it transactionally.

### Court availability

For each configured court `c` from `courts`:

```text
activeMatch(c) = unique m where m.court = c and m.status = active
readyQueue(c) = scheduled matches on c with readyState = ready,
                ordered by (physicalWave, logicalStage, id)

court.state = in-use        iff activeMatch(c) exists
court.state = ready         iff no activeMatch and readyQueue is non-empty
court.state = blocked       iff no activeMatch, unfinished matches exist, but none ready
court.state = finished      iff court has generated matches and all are finalized
court.state = unavailable   iff courts.status != active
court.state = idle          otherwise
court.nextMatchId = first(readyQueue).id or null
```

Add a database invariant preventing two active matches on one court:

```sql
CREATE UNIQUE INDEX matches_one_active_per_court
ON matches (tournament_id, court)
WHERE status = 'active';
```

Court `ready` is not the same as court `available`: a court may be physically free while
its next players are still playing elsewhere. The current UI picks the first unfinished
match solely by court/round (`app.js:662-665`) and can therefore offer a blocked match.
The first mutation that changes a match from `scheduled` to `active` must enforce the same
`dependenciesResolved AND participantsFree AND courtFree` predicate transactionally;
`readyState` is advisory display data, not authorization to score. The current scoring path
only checks court authorization and match finalization/version at
`api/match-action.js:99-147`.

### Player waiting/readiness

For every assigned roster player `p`:

```text
playingMatch(p) = unique active match containing p
readyMatches(p) = ready matches containing p
futureMatches(p) = scheduled matches containing p
lastFinalizedAt(p) = max(finalizedAt of finalized matches containing p)

state(p) = playing       iff playingMatch exists
state(p) = called        iff any ready match containing p is selected/called
state(p) = ready         iff any ready match containing p exists
state(p) = blocked       iff futureMatches exists but all are dependency-blocked
state(p) = finished      iff no unfinished generated match contains p AND
                            tournament/format is terminal for p
state(p) = unscheduled   otherwise
```

“Waiting” is not a persisted fact in the current contract. If the product needs
`called`, `checked-in`, `late`, or `no-show`, add explicit assignment/check-in state and
`called_at`; do not infer attendance from `scheduled`. A player can also be absent from
currently generated adaptive fixtures and still not be finished.

Player exclusivity cannot be implemented as a simple partial index on `match_players`:
that table has no match status, PostgreSQL index predicates cannot reference
`matches.status`, `player_id` is nullable, and legacy seeded rows omit it
(`api/_lib/db.js:131,209-220`). Use one enforceable design:

1. backfill and make `match_players.player_id` non-null, then maintain an
   `active_player_allocations(tournament_id, player_id, match_id)` table with
   `PRIMARY KEY (tournament_id, player_id)` in the same transaction that activates,
   finalizes, resets, or reopens a match; or
2. use a database trigger/locked validation that joins `match_players` to `matches` whenever
   a match enters `active`.

Application-only prechecks are insufficient under concurrent starts. The allocation or
trigger must reject the second match atomically, and reset/reopen paths must maintain the
same invariant.

### ETA

Use only finalized matches with both timestamps and sane duration:

```text
durationSeconds(m) = finalizedAt(m) - startedAt(m)
samples = durations where 60 <= durationSeconds <= 4 * configuredRoundSeconds
typicalMatchSeconds = median(last 20 samples), if |samples| >= 5
fallback = roundDurationMinutes * 60
effectiveDuration = typicalMatchSeconds ?? fallback
```

Per court, process unfinished matches in dependency/wave order:

```text
availableAt(c) =
  if activeMatch exists:
    max(now, activeMatch.startedAt + effectiveDuration)
  else now

startEstimate(m) = max(
  scheduledStartAt(m) or now,
  availableAt(m.court),
  max(estimated completion of dependency matches),
  max(estimated availability of every player in m)
)
finishEstimate(m) = startEstimate(m) + effectiveDuration
resourceAvailableAfter(m) = finishEstimate(m) + intervalMinutes * 60
```

Process ready candidates with a deterministic resource-constrained scheduler, not merely a
topological sort: order by `(scheduledStartAt nulls last, physicalWave, logicalStage,
court, id)`, choose only matches whose dependencies are projected complete, then update the
assigned court and every participant to `resourceAvailableAfter(m)`. When several matches
become ready together, that stable order makes projections reproducible. Apply the
configured interval/turnaround to court and player availability; fixture scheduling already
includes it at `api/_lib/tournament-rules.js:41-47`.

If dependencies are unknown, a match is adaptive and not generated, or
`scheduledStartAt` has no date/time zone, return `null`, not a fabricated clock time.

```text
estimatedFinishAt = max(finishEstimate(m)) for fixed, fully generated schedules
estimatedFinishAt = null for adaptive schedules unless the engine supplies remaining
                    stage count and expected matches per future stage
confidence = high   when sampleSize >= 20
confidence = medium when sampleSize >= 5
confidence = low    when using configured duration only
```

The browser timer is in-memory and match-scoped (`firebase-config.js:516-531` and
`docs/mobile-ux-architecture.md:131-136`); it is not authoritative ETA data. Persist
`started_at` on the first successful point, as the API already does at
`api/match-action.js:126-147`, and base ETA on server timestamps and `serverTime`.

## Adaptive progression correctness pitfalls

1. `round` and `metadata.stage` are different concepts. `stageFixtures` spreads one
   logical stage across physical waves when matches exceed courts
   (`api/_lib/tournament-rules.js:52-57`). UI text such as `ROUND x OF configuredRounds`
   in `app.js:702-706` is therefore wrong for several formats.
2. Progression is generated before the advisory transaction lock. The code reads matches
   and computes the next stage at `api/_lib/db.js:495-502`, then locks only during insert
   at `api/_lib/db.js:509-524`. Concurrent polls/finalizations can compute from the same
   stale snapshot. Lock, re-read, decide, and insert in one serialized operation, or use a
   compare-and-insert progression record.
3. `GET /api/matches` has a write side effect (`api/matches.js:35`). One-second polling can
   race progression and makes read latency/error semantics unpredictable. Move progression
   to finalization/recovery; let GET report `ready-to-generate` without mutating.
4. A finalization currently returns a successful match plus an optional full match list;
   progression failure falls into the generic 503 path (`api/match-action.js:347-357`).
   Separate `matchCommitted: true` from `progression.status/error`, and make progression
   retryable and observable.
5. Reopen/reset/reset-all can invalidate downstream adaptive fixtures but do not delete or
   version-fence them (`api/match-action.js:68-91,286-342`). Block these actions once
   dependents exist, or transactionally invalidate/regenerate descendants.
6. Stable match IDs are only court/round. Add a unique logical identity such as
   `(tournament_id, generation, logical_stage, pairing_index)` and persist a tournament
   `progression_version` so retries and corrections cannot score stale descendants.
7. `numberOfRounds` is a stage cap for adaptive formats but a physical/configured round
   count elsewhere (`api/_lib/tournament-rules.js:264,284`). Rename the normalized setting
   to `maxStages` for adaptive formats and return both `configuredStageLimit` and
   `generatedPhysicalWaves`.
8. An empty next generation can mean champion/terminal, invalid field shape, or a bug.
   Require each format to return `{ state, fixtures, reason }`, not `[]` for every case.
9. `groups-knockout` is advertised in `api/_lib/tournament-rules.js:3-22`, but
   `generateInitialFixtures()` has no `groups-knockout` branch and reaches the unsupported
   format error at `api/_lib/tournament-rules.js:262-278`. Classify this format as
   `unsupported` in API definitions and the dashboard until group qualification, knockout
   fixture generation, dependencies, progression, terminal state, and ranking are
   implemented and tested; do not fabricate operations state for it.

## Review of the concurrent live-dashboard implementation

The untracked worktree currently contains `api/_lib/live-dashboard.js` and
`api/live-dashboard.js`. Treat this endpoint as superseded by the proposed `/api/matches`
`operations` contract: do not expose or wire it into a client until it either delegates to
the same projector/snapshot or is removed. Two independently derived dashboard APIs would
produce contradictory state. In particular, do not ship the current projection unchanged:

1. `api/live-dashboard.js:5-14` is unauthenticated. It accepts any syntactically valid
   published tournament ID and returns teams, scores, standings, and operational state.
   Make publicity an explicit contract or require/scoped-authenticate the request.
2. `api/_lib/live-dashboard.js:15-26` selects the first scheduled court match as `next`,
   marks the court available whenever no match is active, and announces that match. This
   ignores dependency and player availability, so it can call players who are on another
   court or whose bracket opponents are unresolved.
3. `api/_lib/live-dashboard.js:29` labels `(active + finalized) / generated` as court
   utilization. That is completion/progress, not time utilization. Real utilization is
   `occupiedSeconds / observableWindowSeconds`, requiring timestamps or occupancy events.
4. `api/_lib/live-dashboard.js:33,41` publishes a percentage against generated matches for
   adaptive formats. Retain the count, but apply the `totalMode` rule above and suppress a
   tournament percentage when future matches are not generated.
5. `api/_lib/live-dashboard.js:34-36` collapses staggered courts into one `currentRound`.
   Return wave summaries and per-court positions instead.
6. `api/_lib/live-dashboard.js:37-41` computes ETA as
   `ceil(all remaining matches / configured courts) * (duration + interval)`. This assumes
   all courts are usable in every wave, ignores active elapsed time, player/dependency
   serialization, scheduled times, and ungenerated adaptive stages, and always emits a
   precise timestamp. Replace it with the timestamp/dependency projection above and return
   null when inputs are insufficient.
7. `api/_lib/live-dashboard.js:43-44` truncates completed/upcoming arrays before expressing
   pagination or totals. The operational snapshot should return compact summaries and IDs;
   use a separate paginated match query for dashboard history if payload size matters.
8. The endpoint reads tournament, matches, and leaderboard in separate calls without a
   snapshot transaction (`api/live-dashboard.js:10-14`). Prefer deriving `operations`
   alongside `/api/matches`, or read under one repeatable snapshot and return a revision so
   clients can detect mixed versions.

The concurrent `score_state` addition in `api/_lib/db.js` does not change round/court/ETA
formulas, but consumers must treat `teamAScore`/`teamBScore` as the sport-specific match
summary and use `scoreState` for game/set detail. Do not infer match duration or completion
from raw point totals in a multi-sport tournament.

## API and implementation sequence

1. Schema in `api/_lib/db.js`: add `scheduled_start_at`, monotonic
   `operations_revision`, progression version/state/error, dependency representation, the
   active-court constraint, and an enforceable active-player allocation/trigger. Backfill
   `match_players.player_id` before making it non-null. Backfill no fake schedule dates;
   leave unknown schedule instants null.
2. Rules in `api/_lib/tournament-rules.js`: expose `logicalStage`, terminal predicate,
   expected current-stage fixture count, dependency metadata, and structured progression
   result per format.
3. Derivation in new `api/_lib/tournament-operations.js`: implement the formulas above as
   pure functions with tests covering staggered courts, multi-wave stages, byes, blocked
   players, active overlap rejection, and no-ETA cases.
4. API in `api/matches.js`: read tournament/matches/roster/courts under one repeatable
   snapshot, calculate leaderboard and `operations` from those same rows, and preserve
   current match fields for compatibility. Scope `api/leaderboard.js`, `api/courts.js`, and
   `api/fixtures.js` with the same `canAccessTournament` authorization used by matches;
   they currently accept a client tournament ID after authentication without equivalent
   scope checks. Remove/defer `api/live-dashboard.js`, or make it delegate to this exact
   snapshot/projector contract.
5. Mutation response in `api/match-action.js`: return `{ match, operations, progression }`
   and distinguish committed score state from progression recovery state.
6. Production client in `firebase-config.js:252-260`: store `payload.operations` beside
   `serverLeaderboard`; render it in `app.js:1538-1597`. Replace client-side admin counts
   and `Set(active court)` logic at `app.js:1539-1548` with server fields.
7. Referee queue in `app.js:662-665,791-798,1255-1345`: use `readyState`,
   `blockedByMatchIds`, `scheduledStartAt`, and the server-selected next match. Do not pick
   `round + 1` or first unfinished match locally.
8. Tests: add pure operation-derivation tests plus database/API concurrency tests for two
   simultaneous finalizations, GET idempotency, downstream reopen/reset, two active matches
   on one court/player, and adaptive terminal versus waiting states.

## Dashboard display rules

- Label physical scheduling units “Wave” unless the format explicitly declares them rounds.
- Show logical stage separately for brackets, Swiss, ladder, King, and Mexicano.
- Show `X of Y generated matches complete`; only show a tournament percentage when
  `totalMode = fixed`.
- Show court state and player readiness as distinct signals.
- Show absolute ETA only when `estimatedFinishAt` is non-null; otherwise show “Awaiting
  next stage” or “Schedule pending”, based on `progression.stageState`.
- Use `serverTime`/`operations.asOf` to compute relative labels and display snapshot age.
- Preserve server leaderboard rank/order. The production path already does this in
  `app.js:1515-1535`; keep local recomputation only as the explicit demo fallback.
