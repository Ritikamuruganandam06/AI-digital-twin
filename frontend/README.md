# frontend

React 19 + TypeScript + Vite application — `docs/phases.md` row 17. This is
the one part of the platform a person actually looks at: the other two
services (`backend/`, `ai-service/`) exist to be driven by it.

**Talks only to the Node.js backend, over REST, through one function.**
`src/api/client.ts`'s `apiFetch()` is the *only* place in this codebase that
calls `fetch()` — every other module under `src/api/` goes through it. That
makes `docs/phases.md`'s ground rule ("React never talks to
Mongo/Redis/Kafka/Qdrant/Groq directly") a structural fact rather than a
convention someone could quietly violate from inside a component: there is
exactly one function in this codebase capable of making an HTTP request, and
it only ever calls `VITE_API_BASE_URL` (the backend).

## Views

1. **System Overview** (`/`) — service health summary + recent events.
2. **Service Topology** (`/topology`) — the dependency graph as a clickable SVG.
3. **Service Details** (`/services/:name`) — one service's health, dependencies/dependents, metrics, events.
4. **AI Assistant** (`/assistant`) — a chat UI over `POST /api/assistant/ask`, with a "show reasoning" trace per answer.
5. **What-If Simulation** (`/simulation`) — a guided form that asks the assistant a precise what-if question (see below — there is no dedicated simulation endpoint).
6. **Incidents** (`/incidents`, `/incidents/:id`) — list, filter, and (OPERATOR/ADMIN) file incidents.
7. **Agent Execution Trace** (`/executions`, `/executions/:id`) — every persisted agent execution, full trace.

## Repository structure

```
frontend/
├── src/
│   ├── api/            One module per backend resource (auth, services, events,
│   │                    incidents, assistant, executions) + client.ts (the only
│   │                    fetch() call in the app) + useApiQuery.ts (the one
│   │                    data-fetching hook every page uses) + types.ts (mirrors
│   │                    the backend's actual repository/controller shapes,
│   │                    read from source, not guessed)
│   ├── auth/            AuthContext (session state + login/register/logout/hasRole),
│   │                    RequireAuth (route gating), decodeToken (client-side JWT
│   │                    read for UI display only — see "JWT decoding" below)
│   ├── components/      Layout (sidebar nav), AsyncBoundary (loading/error/data),
│   │                    StatusBadge (health/severity/status badges),
│   │                    ExecutionTrace (shared by AssistantPage, SimulationPage,
│   │                    ExecutionDetailPage)
│   ├── pages/            One component per view, plus topologyLayout.ts (the
│   │                    pure graph-layout algorithm, kept separate from
│   │                    TopologyPage.tsx so it's unit-testable without a DOM)
│   ├── App.tsx           Route table
│   ├── main.tsx          Entry point (AuthProvider + BrowserRouter + App)
│   └── index.css         A ~20-line reset; every page's own layout is inline styles
├── tests/                Mirrors src/ 1:1; see "Tests" below
├── index.html, vite.config.ts, tsconfig.json, package.json
└── .env.example
```

## Setup

```bash
cd frontend
npm install
cp .env.example .env    # VITE_API_BASE_URL=http://localhost:4000 by default
npm run dev              # http://localhost:5173, expects the backend running at VITE_API_BASE_URL
```

`npm run build` runs `tsc --noEmit` then `vite build`; `npm run preview`
serves the production build locally. There's no separate lint step — `tsc`
with `strict`, `noUnusedLocals`, and `noUnusedParameters` all on is the only
static check this project uses, the same choice `backend/tsconfig.json`
made.

## Design decisions worth knowing

**What-If Simulation has no dedicated endpoint, on purpose.** The
`simulate_service_failure` / `simulate_traffic_increase` /
`simulate_database_failure` / `simulate_cache_failure` /
`simulate_high_latency` / `simulate_high_error_rate` / `calculate_blast_radius`
tools live behind `ai-service`'s `/internal/tools/*` — a deliberate,
non-JWT-authenticated service-to-service trust boundary
(`docs/architecture.md` §15) that only the AI service's own agent loop may
cross. So `SimulationPage.tsx` is a guided form (pick a scenario, pick a
service, pick a multiplier) that *composes a precise natural-language
question* and submits it through the same `POST /api/assistant/ask` the AI
Assistant page uses. The agent decides which tool to call; this page never
invents or guesses a result — it renders the same `ExecutionTrace` component
the Assistant and Execution Detail pages use, so the underlying deterministic
tool call and its real result are visible, not just prose.

**Hand-rolled SVG topology layout, not a graphing library.** `topologyLayout.ts`
implements a small layered/Sugiyama-style layout (longest-path layering,
~90 lines) instead of adding a dependency like `react-flow` or `d3` for a
graph with at most a handful of nodes. Consistent with the project's
established "hand-roll a small mechanism rather than add a dependency for
it" ethos (the agent loop, cache-aside, the Phase 16 retry/circuit-breaker
primitives). Kept structurally separate from `TopologyPage.tsx`'s rendering
so the layout math is unit-testable with no DOM at all.

**Hand-rolled `useApiQuery`, not React Query.** Every page owns exactly one
query for exactly as long as it's mounted — no cross-component caching,
background refetching, or request deduplication is needed here, so a ~35-line
hook (fetch-on-mount, loading/error/data state, a stale-response guard,
`refetch()`) covers every page's actual requirement.

**JWT decoding on the frontend is explicitly not a security boundary.**
`decodeToken.ts` reads (never verifies) the JWT payload so the UI can show
the logged-in email/role and hide an OPERATOR-only button from a USER — pure
UX. The backend's `authenticate`/`authorize` middleware is what actually
enforces access on every request; a user who edits the decoded value in
devtools gains nothing, since the real token is re-verified server-side.
`RequireAuth.tsx`'s route redirect is the same story: it saves a wasted round
trip, it doesn't replace one.

**Self-registration offers all three roles.** This project has no
invite/promotion flow (a deliberate Phase 15 backend decision,
`auth.service.ts`), so `RegisterPage.tsx` exposing `USER`/`OPERATOR`/`ADMIN`
at signup is the only way to reach privileged behavior at all in this demo.
Explicitly documented in that file as a demo/dev-mode convenience, not a
pattern for a real product.

**`createIncident()` always sends a real `Idempotency-Key`.** A fresh
`crypto.randomUUID()` per call by default (`api/incidents.ts`), exercising
the backend's Phase 16 idempotency middleware — a slow network causing a
double-click to fire the request twice can't silently file the same incident
twice.

## Tests

```bash
npm test          # vitest run
npm run test:watch
```

**43 tests, 10 files, all passing, no mocking beyond the network boundary**
(`global.fetch` in `tests/api/client.unit.test.ts`, or the relevant
`src/api/*.ts`/`src/auth/AuthContext.tsx` module in every component test) —
the same "mock only the boundary" discipline `backend`/`ai-service` use for
their own outbound HTTP clients:

- `tests/api/client.unit.test.ts` (10) — `apiFetch()`'s auth-header
  attachment, `Idempotency-Key` attachment, `{data}` envelope unwrapping,
  non-2xx → `ApiError` normalization (both a JSON error body and a
  non-JSON one), raw network failure → `ApiError` with `status: 0`, `204`
  handling, query-string serialization, token storage round-trip.
- `tests/auth/decodeToken.unit.test.ts` (8) — well-formed decode, malformed
  token, missing fields, invalid role, missing `exp`, expiry comparison in
  both directions.
- `tests/auth/AuthContext.test.tsx` (5) — anonymous start state, login
  persists a token and exposes rank-based `hasRole()`, logout clears it,
  restoring a valid session from a stored unexpired token on mount, and
  discarding an expired one.
- `tests/pages/topologyLayout.unit.test.ts` (6) — layering (a root at layer
  0, a dependent one layer past its deepest dependency), edge generation
  (including skipping a dangling dependency name), no infinite loop on a
  dependency cycle, an empty service list, and same-layer nodes sorted into
  distinct rows.
- `tests/components/AsyncBoundary.test.tsx` (4) — loading, real `ApiError`
  message + working retry button, resolved-data rendering, and the
  loaded-but-empty case.
- `tests/pages/LoginPage.test.tsx` (2), `SystemOverviewPage.test.tsx` (2),
  `ServiceDetailPage.test.tsx` (2), `AssistantPage.test.tsx` (2),
  `IncidentsPage.test.tsx` (2) — one page per major view exercised through
  Testing Library, each covering a real success render and a real
  `ApiError`/permission path (an OPERATOR-only form hidden for a USER-level
  account, a failed login staying on the page, a failed assistant question
  surfacing an inline error, and so on).

`npx tsc -p tsconfig.json --noEmit` and `npx vite build` both run clean —
51 modules, ~293 KB (~90 KB gzipped) — confirmed in this repo's build
sandbox.

**One honest limitation, the same shape every other phase's README
documents:** everything above is exercised against a *mocked* backend (the
network boundary is the mock, per the "mock only the boundary" rule) — this
proves the frontend's own logic is correct, not that the real backend's
response shapes match what `src/api/types.ts` expects. Row 17's own
verification requirement ("Manual + component tests against the real
backend API") is split accordingly: the component-test half is fully done
here, for real, in this sandbox; the "against the real backend API" half
needs `backend` (with a real MongoDB/Redis/Kafka/AI-service/Groq stack
behind it, per every earlier phase's own caveats) actually running on your
machine at `VITE_API_BASE_URL`, since this sandbox cannot assemble that
whole stack at once (the same reason no phase before this one has been able
to run a fully-live end-to-end proof either). `src/api/types.ts` was written
by reading the backend's actual controller/repository source directly, not
guessed, to keep that gap as small as it can be without a live run — but a
live run is still the only way to close it completely.
