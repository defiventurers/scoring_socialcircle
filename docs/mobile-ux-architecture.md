# Mobile UX and Information Architecture

## UX audit

The previous production client mixed court selection, tournament setup, scoring, standings, rules, tournament administration, player management, and tournament creation in one tabbed shell. On phones this created three problems:

- users had to parse controls for roles they did not have;
- navigation competed with operational actions during live scoring;
- tournament creation looked like a collection of tabs instead of a staged lifecycle.

The implementation now treats role and task as the primary navigation model. Home contains only the three requested workflow actions. Referee setup, scoring, tournament creation, and administration are isolated views with one relevant back action.

## Screen flow

```text
Home
|-- Create Tournament
|   `-- Admin PIN
|       `-- Builder: 1 Type -> 2 Format -> 3 Settings -> 4 Players
|                    -> 5 Fixtures -> 6 Preview -> 7 Publish
|-- Score / Referee Tournament
|   `-- Tournament Selection -> Court Selection -> Court PIN
|       `-- Match Queue -> Scoring Screen -> Match Queue
`-- Admin Access
    `-- Admin PIN -> Admin Dashboard
        |-- Current Tournament -> Match Manager
        |-- Players
        |-- Create Tournament
        |-- Reports
        `-- Reset / End Event
```

## Current production structure

The deployed frontend remains the existing classic-script client because Vite copies `index.html`, `app.js`, `firebase-config.js`, and `styles.css` directly into `dist`. Introducing Next.js during an information-architecture change would create a second production implementation and require a deliberate API/session migration.

Responsibilities after this change:

- `index.html`: semantic workflow screens and stable control IDs.
- `app.js`: shared workflow state, screen routing, local/demo behavior, score rendering, and operational UI.
- `firebase-config.js`: production Postgres/API adapter, server session, catalog loading, mutations, and builder persistence.
- `styles.css`: existing design tokens plus mobile workflow layout and responsive overrides.
- `api/tournament-catalog.js`: minimal unauthenticated published-tournament discovery.
- `api/tournaments.js`: server-normalized tournament configuration and lifecycle actions.

## Future component refactoring plan

A later framework migration should replace the classic-script client only after parity tests exist. Recommended component boundaries:

```text
src/
  app/
    page.tsx
    create/page.tsx
    referee/page.tsx
    referee/queue/page.tsx
    referee/score/[matchId]/page.tsx
    admin/page.tsx
  components/
    layout/WorkflowHeader.tsx
    navigation/HomeActions.tsx
    tournament/TournamentSelector.tsx
    tournament/CourtSelector.tsx
    builder/WizardShell.tsx
    builder/WizardProgress.tsx
    builder/steps/*.tsx
    referee/MatchQueue.tsx
    referee/ScoreBoard.tsx
    admin/TournamentSummaryCard.tsx
    admin/AdminActionGrid.tsx
  lib/
    api/client.ts
    auth/session.ts
    tournament/rules.ts
    workflow/routes.ts
```

`WizardShell`, `WorkflowHeader`, and API state should be reused; role permissions must continue to be enforced server-side.

## Files modified

- `index.html`
- `styles.css`
- `app.js`
- `firebase-config.js`
- `service-worker.js`
- `api/tournaments.js`
- `api/tournament-catalog.js` (new)

## Mobile responsiveness

- Workflow content is constrained to approximately 480 px.
- Home has only three 72 px workflow buttons.
- Controls and icon buttons have minimum 48 px targets.
- Forms use 16 px inputs to avoid mobile browser zoom.
- Wizard actions remain sticky above the safe-area inset.
- Inactive panels remain hidden at desktop and mobile widths.
- Tables are confined to the optional admin match manager.
- No bottom navigation or horizontal wizard tabs remain.

## Accessibility

- Icon-only controls have accessible names.
- Login errors use `role="alert"`.
- Builder messages use an `aria-live` status region.
- Wizard progress exposes min, max, and current values.
- Workflow screens use headings and semantic sections.
- Tournament and court selection use keyboard-operable buttons.
- Disabled/busy mutation controls expose `aria-busy`.

## Performance

- Removed three unused Firebase SDK requests from the production page.
- Technical database/connectivity chrome is hidden outside localhost.
- Public tournament discovery returns only fields needed before login.
- Existing service worker remains network-first and now uses a new cache version.
- The production API and scoring contracts remain unchanged.

## Deletion candidates

The following should be removed in a dedicated cleanup after deployment parity is confirmed:

- Firebase fallback/auth/database functions in `app.js`.
- Static `fixtures.js` and local demo storage if production no longer needs offline demos.
- Unused React, Motion, Tailwind, and Google GenAI dependencies, or conversely the classic client if a deliberate React migration is approved.
- Legacy leaderboard/rules panels once their required organizer views are placed in focused routes.
- Stale Firebase-oriented README and database rules documentation.
- Old `.builder-steps`, `.tab-nav`, `.desktop-nav`, and superseded desktop CSS declarations.

## Additional recommendations

1. Replace PIN-only referee identity with named, revocable assignments and an audit trail.
2. Add a resume-draft screen before starting a second tournament draft.
3. Persist match timer timestamps server-side if timers must survive reloads or device handoff.
4. Add nonblocking toast/status feedback for routine scoring success and conflicts.
5. Add Playwright journeys for all three Home actions at 390 px and desktop widths.
6. Treat archived tournaments as a dedicated history/report workflow rather than adding them back to the admin dashboard.
