# Shared Postgres scoring setup

The production app no longer stores official scores in browser LocalStorage. All devices read and write the same Neon Postgres database through Vercel Functions.

## Required Vercel environment variables

Connect a Neon database to the `scoring-socialcircle` Vercel project and make sure a pooled connection variable is available as one of:

- `DATABASE_URL` (preferred)
- `POSTGRES_URL`
- `STORAGE_URL`

Add these variables for **Production** and **Preview**:

- `COURT_1_PIN`
- `COURT_2_PIN`
- `COURT_3_PIN`
- `COURT_4_PIN`
- `ADMIN_PIN`
- `SESSION_SECRET` — random value with at least 32 characters

After changing variables, redeploy the project.

## Runtime behaviour

- `/api/health` creates the database tables and seeds the 80 fixtures if they do not exist.
- `/api/login` validates PINs on the server and returns a signed 12-hour session.
- `/api/matches` returns the shared match state.
- `/api/match-action` performs version-checked score, undo, manual score, finalize, reopen and reset operations.
- Browsers poll once per second, so changes normally appear on other devices in about one second.
- Official scores are never written to LocalStorage.
- Scoring is disabled while the shared server is unavailable to avoid divergent device data.

## Smoke test

1. Open Court 1 on one phone and Admin on another.
2. Add a Court 1 point.
3. Confirm the Admin device changes without refreshing.
4. Refresh both devices and confirm the score remains.
5. Finalize the match and confirm Court 1 is locked.
6. Reopen it as Admin and confirm Court 1 can score again.
