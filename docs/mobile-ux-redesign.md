# Social Circle Mobile Tournament Platform Redesign

## 1. UX Audit
- The previous home experience mixed operational surfaces and did not keep the promised four-workflow mental model.
- Tournament setup used form-like interactions where organizers needed fast tap-first choices.
- Live operations lacked an obvious next-match command center, court availability emphasis, and dependency-aware court assignment feedback.
- Referee and organizer jobs were interleaved, increasing risk during live tournaments.

## 2. Information Architecture
Home contains exactly four entry points: Create Tournament, Tournament Dashboard, Score / Referee Tournament, and Admin Access. Each entry point opens its own workflow and never shares page-level navigation with another role.

## 3. User Flows
```text
Home → Create Tournament → Tournament Builder → Review → Publish Tournament
Home → Tournament Dashboard → Tournament Selection → Live Dashboard
Home → Score / Referee Tournament → Tournament Selection → Court Selection → Assigned Match → Scoring Screen
Home → Admin Access → Admin Dashboard
```

## 4. Wireframes
```text
[Home]
[Create Tournament]
[Tournament Dashboard]
[Score / Referee Tournament]
[Admin Access]
Built by @av1dandsouza aka defiouza
```

```text
[Live Dashboard]
NEXT MATCH READY card
Progress metrics
Live court status
Fixtures
Standings
```

## 5. Component Architecture
- `Shell`: shared mobile page frame and accessible back navigation.
- `Home`: strict four-button workflow launch screen.
- `Builder`: conversational one-question tournament creation wizard.
- `Dashboard`: tournament control center with next-match readiness and court status.
- `Score`: referee-first large-touch scoring surface.
- `Admin`: role-based full-access landing surface.

## 6. Folder Structure
The production React entry is now `src/main.tsx`, `src/App.tsx`, and `src/index.css`. Legacy root-level JavaScript/CSS remains only as historical reference while the Vite application uses the React app mounted from `index.html`.

## 7. Database Improvements
Recommended persistence model:
- `sports` and `scoring_presets` for reusable sport defaults.
- `tournaments` for organizer-owned events.
- `players` and `teams` for participants.
- `fixtures` for generated schedule items.
- `matches` for court assignment, score, status, and dependency metadata.
- `results` for immutable submitted outcomes.
- `court_events` for auditability and utilization analytics.

## 8. Engine Model
The refactor follows `Sport → Preset → Scoring Engine → Tournament Engine → Fixtures → Matches → Results`. Scoring presets are data objects, and automatic court assignment is generic over match dependencies rather than hard-coded to a sport.

## 9. Performance and Accessibility
- Mobile maximum width is constrained to 480px.
- Buttons meet the 48px touch-target requirement.
- Sticky actions reduce scrolling during critical tasks.
- The UI avoids horizontal overflow and keeps rendering state local and lightweight.
- Focus-visible states improve keyboard accessibility.
