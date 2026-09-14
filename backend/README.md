# backend

Node.js + TypeScript + Express application. Owns MongoDB, Redis, and Kafka
integration, the digital twin's data model, the deterministic simulation
engine, and the internal tool API the AI service calls.

**Phase 15 status:** JWT authentication + role-based authorization
(docs/phases.md row 15: "JWT, RBAC (USER/OPERATOR/ADMIN)"), the first
phase that makes any `/api/*` route actually require a caller to be who
they say they are. A new `users` collection
(`src/models/user.model.ts` — email/passwordHash/role, matching
docs/architecture.md §5's field list) is backed by
`src/services/auth.service.ts`'s `register()`/`login()`: `register()`
hashes the password with `bcryptjs` (never stores plaintext) and rejects
a duplicate email with `409`; `login()` verifies it with `bcrypt.compare`
and returns the **same** `401` message for a wrong password or an unknown
email, so the endpoint never confirms/denies which one it was. Both
return a real JWT (`jsonwebtoken`, `src/utils/jwt.ts`) carrying the
user's id (`sub`), email, and role, signed with `JWT_SECRET`/expiring
after `JWT_EXPIRES_IN` — both env vars have sat unused in `.env.example`
since Phase 1. `POST /api/auth/register` and `POST /api/auth/login`
(`src/routes/auth.route.ts`) are the only `/api/*` routes that stay
unauthenticated, for the obvious reason: you can't be required to already
hold a token to get one.

Everything else protected is wired explicitly at the mount point in
`src/app.ts`, not hidden inside each router — `src/middleware/authenticate.ts`
verifies the `Bearer` token and attaches `req.user`
(`src/types/express.d.ts`), stateless (no database lookup per request:
the token payload itself is trusted once its signature and expiry check
out). `src/middleware/authorize.ts` adds a rank check on top
(`USER` < `OPERATOR` < `ADMIN`) for routes that need more than "logged
in" — right now that's just `POST /api/incidents`
(`src/routes/incidents.route.ts`), matching docs/architecture.md §10's
"privileged actions ... require explicit user/operator approval" posture
for `create_incident`, whichever side files it. `POST
/api/assistant/ask` needs only authentication, not a specific role — and
now that a real `req.user` exists, `src/controllers/assistant.controller.ts`
finally populates `agentexecutions.userId`, the field Phase 14 added but
explicitly left unset ("Phase 15 populates this from a real JWT once auth
exists"). `/health`, `/api/auth`, and `/internal/tools/*` stay outside
this middleware on purpose — the last one is a separate
service-to-service trust boundary between the AI service and this
backend (docs/architecture.md §15), not user-facing RBAC.

`npm run seed` now also creates 3 fixed demo accounts, one per role
(`user@demo.local` / `operator@demo.local` / `admin@demo.local`, all
sharing one fixed, published, non-secret password — see "Verify" below),
so USER/OPERATOR/ADMIN behavior can be exercised by hand without
inventing throwaway credentials each time. See "Design decisions worth
knowing" for why self-registration allows choosing a role, why JWTs are
verified statelessly, and why `authorize()` is rank-based rather than an
exact-match set.

<details>
<summary>Phase 14 status (agent execution trace persistence) — still accurate, collapsed for length</summary>

The first backend work since Phase 10, and the first code anywhere in
this project that calls *from* the backend *to* the AI service —
`AI_SERVICE_URL` had sat unused in `.env` since Phase 1.
`src/clients/aiServiceClient.ts` is the mirror image of
`ai-service/app/clients/backend_client.py` (Phase 8): a thin wrapper
around a real `POST {AI_SERVICE_URL}/agent/invoke` call (Node's built-in
`fetch`, no new dependency), normalizing any network failure or non-2xx
response into `AiServiceUnavailableError`. `POST /api/assistant/ask`
(`src/controllers/assistant.controller.ts` /
`src/services/assistant.service.ts`) is docs/architecture.md §3's
sequence diagram made real: it calls the AI service, maps its response
onto a new `agentexecutions` MongoDB collection
(`src/models/agentExecution.model.ts`) — `status` derived from
`stopped_reason` (`final_answer`→`completed`,
`iteration_limit`→`incomplete`, anything else→`error`), and
`retrievedDocuments` denormalized out of any `search_knowledge_base`
steps — and persists it. `GET /api/executions` and `GET
/api/executions/:id` (`src/routes/agentExecutions.route.ts`) are
docs/phases.md row 14's "Trace retrievable via API." Nothing is persisted
at all when the AI service is completely unreachable (a 502, no
execution record) — persisting only happens for a request that actually
reached `run_agent()`, even one that failed inside it (a `groq_error`
trace is still a real trace). See "Design decisions worth knowing" for
the full reasoning and `ai-service/README.md`'s Phase 14 section for the
matching AI-service-side change (real per-step `timestamp`s).

</details>

<details>
<summary>Phase 10 status (internal tool API) — still accurate, collapsed for length</summary>

The internal tool API (`src/tools/`), mounted at `/internal/tools` — 18
uncached HTTP routes across three privilege tiers (docs/architecture.md
§10) that the AI service's agent loop calls as tools: 8 read-only routes
(thin wrappers over the Phase 6 services/repositories), 8 simulation
routes (thin wrappers over Phase 7's pure engine, fed real topology via
the new `src/tools/simulationAdapter.ts` seam that
`services/simulation/index.ts`'s own Phase 7 comment anticipated), and 2
privileged routes — `GET /internal/tools/recommend-scaling/:name` (new
`recommendation.service.ts`; non-mutating, safe to auto-execute) and
`POST /internal/tools/create-incident` (mutating; this route itself still
just writes the incident like Phase 6's public endpoint does — it's the
AI service's tool *executor*, not this route, that's responsible for
never calling it without a human decision in the loop, see
`ai-service/README.md`). No new business logic was invented for this
phase — every handler in `src/tools/tools.controller.ts` and
`simulationTools.controller.ts` calls existing Phase 6/7 code.

</details>

<details>
<summary>Phase 7 status (deterministic simulation engine) — still accurate, collapsed for length</summary>

The deterministic simulation engine (`src/services/simulation/`) — eight
pure, side-effect-free TypeScript functions (no Mongo/Redis/Kafka/LLM
calls anywhere in this module) that compute "what happens if X" against a
topology snapshot: service failure, traffic increase, database failure,
cache failure, high latency, high error rate, blast-radius calculation,
and bottleneck detection. Per docs/phases.md, that phase was scoped to the
engine itself plus unit tests, with deliberately no new HTTP endpoints —
Phase 10 is what finally puts these behind the "internal tool API"
docs/architecture.md §4 reserved for them.

</details>

<details>
<summary>Phase 6 status (Digital Twin data model) — still accurate, collapsed for length</summary>

The digital twin's real data model — `services` (topology + dependency
graph + health snapshot), `servicemetrics`, `events`, and `incidents` — as
real MongoDB collections, plus a seed script and read/write query
endpoints that return the modeled topology. First phase where `/api/...`
responses are actual product data, not a `/api/diagnostics/...` proof.

</details>

<details>
<summary>Phase 5 status (Kafka + KafkaJS) — still accurate, collapsed for length</summary>

Real Kafka integration via KafkaJS — an idempotent producer, a consumer
group with a dead-letter topic, and explicit topic creation, all wired
into the same health-check registry as MongoDB and Redis, plus a producer
→ topic → consumer diagnostic proof mirroring the Phase 3/4 ones. This
sandbox has no way to reach any Kafka broker distribution (see "What could
and couldn't be verified here"), so the positive-path proof needs to be
run on your own machine.

</details>

## Structure (current)

```
backend/
├── src/
│   ├── config/
│   │   ├── env.ts         + redisUrl, redisDefaultTtlSeconds (Phase 4); + aiServiceUrl (Phase 14)
│   │   ├── logger.ts
│   │   ├── database.ts    Phase 3
│   │   └── redis.ts       connectToRedis()/disconnectFromRedis()/isRedisConnected()/getRedisClient()
│   │       env.ts also + jwtSecret, jwtExpiresIn (Phase 15)
│   ├── clients/
│   │   └── aiServiceClient.ts   Phase 14 — invokeAgent(): POST {AI_SERVICE_URL}/agent/invoke; the ONLY code that talks to the AI service (mirrors ai-service/app/clients/backend_client.py's role, opposite direction)
│   ├── cache/
│   │   └── cacheAside.ts  getOrSetCache()/invalidateCache() — generic, reusable cache-aside helper
│   ├── health/
│   │   ├── registry.ts
│   │   └── checks/
│   │       ├── mongodb.check.ts   Phase 3
│   │       ├── redis.check.ts     live SET -> GET -> verify TTL proof, registered in server.ts
│   │       └── kafka.check.ts     Phase 5 — real admin.describeCluster() round trip
│   ├── kafka/
│   │   ├── topics.ts              all topic-name constants for the whole platform (most unused until later phases)
│   │   ├── ensureTopics.ts        explicit admin.createTopics() instead of relying on broker auto-create
│   │   ├── consumerFactory.ts     runConsumer() — generic eachMessage wrapper with dead-letter handling
│   │   ├── producers/diagnosticProducer.ts   Phase 5's own proof-of-Kafka publisher
│   │   └── consumers/
│   │       ├── diagnosticConsumer.ts   subscribes to diagnostics.ping, feeds the in-memory store
│   │       └── store.ts                in-memory ring buffer so consumption is observable over HTTP
│   ├── models/
│   │   ├── diagnosticPing.model.ts           Mongoose schema (proof-of-CRUD only)
│   │   ├── service.model.ts                  Phase 6 — topology node: name, type, dependencies, dependents, health
│   │   ├── serviceMetric.model.ts            Phase 6 — latency/error-rate/traffic/capacity samples
│   │   ├── event.model.ts                    Phase 6 — service lifecycle/operational events
│   │   ├── incident.model.ts                 Phase 6 — incidents (manual only this phase; `source` field is forward-compatible)
│   │   ├── agentExecution.model.ts           Phase 14 — agentexecutions: question/finalResponse/status/steps[]/retrievedDocuments[] (docs/architecture.md §16); userId finally populated as of Phase 15
│   │   └── user.model.ts                     Phase 15 — users: email (unique)/passwordHash/role (docs/architecture.md §5)
│   ├── repositories/
│   │   ├── diagnosticPing.repository.ts      pure Mongo data-access, unchanged since Phase 3
│   │   ├── service.repository.ts             Phase 6 — upsertByName (idempotent), findAll, findByName(s)
│   │   ├── serviceMetric.repository.ts       Phase 6
│   │   ├── event.repository.ts               Phase 6
│   │   ├── incident.repository.ts            Phase 6
│   │   ├── agentExecution.repository.ts      Phase 14 — create/findById/findAll, dumb data-access seam like every repository above
│   │   └── user.repository.ts                Phase 15 — create/findByEmail/findById, same dumb data-access seam
│   ├── utils/
│   │   ├── AppError.ts                       Phase 2
│   │   └── jwt.ts                            Phase 15 — signAccessToken()/verifyAccessToken(), stateless (no DB lookup)
│   ├── services/                             business logic above the repository layer (docs/architecture.md §4)
│   │   ├── topology.service.ts               Phase 6 — computeDependents() (pure) + getServiceTopology()
│   │   ├── incident.service.ts               Phase 6 — validates serviceName/affectedServiceNames exist before writing
│   │   ├── assistant.service.ts              Phase 14 — askAssistant(): calls the AI service, maps its response onto agentExecutionRepository.create()
│   │   ├── auth.service.ts                   Phase 15 — register()/login(): bcrypt hash/compare + signAccessToken()
│   │   └── simulation/                       Phase 7 — the deterministic simulation engine, entirely pure (no I/O)
│   │       ├── types.ts                      SimulationServiceState (input), SimulationResult/SimulatedServiceImpact (output)
│   │       ├── constants.ts                  every formula constant, documented, gathered in one place
│   │       ├── graph.ts                      bfsClosure() + cascadeFromOrigins() — shared graph-traversal primitives
│   │       ├── blastRadius.ts                calculateBlastRadius() — docs/architecture.md §10's calculate_blast_radius
│   │       ├── bottleneck.ts                 findBottleneck() — docs/architecture.md §10's find_bottleneck
│   │       ├── serviceFailure.ts             simulateServiceFailure()
│   │       ├── trafficIncrease.ts            simulateTrafficIncrease()
│   │       ├── databaseFailure.ts            simulateDatabaseFailure()
│   │       ├── cacheFailure.ts               simulateCacheFailure() — degrades, mirrors Phase 4's real cache fallback
│   │       ├── highLatency.ts                simulateHighLatency()
│   │       ├── highErrorRate.ts              simulateHighErrorRate()
│   │       └── index.ts                      barrel export for all of the above
│   ├── data/seedTopology.ts                  Phase 6 — the 5-service demo topology (User/Order/Payment/Inventory/Notification)
│   ├── scripts/seed.ts                       Phase 6 — `npm run seed`; destructive, idempotent, seeds services+metrics+events+1 incident;
│   │   Phase 15 — also seeds 3 fixed demo accounts, one per role
│   ├── controllers/
│   │   ├── diagnosticPing.controller.ts      cache-aside in front of the repository
│   │   ├── diagnosticKafka.controller.ts     Phase 5 — POST publishes, GET reads the consumed-message store
│   │   ├── services.controller.ts            Phase 6 — list (cached)/get-with-topology/metrics
│   │   ├── events.controller.ts              Phase 6 — recent events, optional ?service= filter
│   │   ├── incidents.controller.ts           Phase 6 — list/get/create
│   │   ├── assistant.controller.ts           Phase 14 — POST /api/assistant/ask; Phase 15 — passes req.user?.id through as userId
│   │   ├── agentExecutions.controller.ts     Phase 14 — GET /api/executions, GET /api/executions/:id
│   │   └── auth.controller.ts                Phase 15 — POST /api/auth/register, POST /api/auth/login
│   ├── tools/                                 Phase 10 — mounted at /internal/tools, not /api/*
│   │   ├── tools.controller.ts               8 read-only tool handlers, thin wrappers over Phase 6 services/repositories
│   │   ├── simulationTools.controller.ts     8 simulation tool handlers (the 8 functions from Phase 7)
│   │   ├── simulationAdapter.ts              ServiceRecord (Mongo) -> SimulationServiceState (engine input)
│   │   └── tools.route.ts                    all 18 routes; read-only + simulation + 2 privileged — deliberately outside JWT auth (service-to-service boundary)
│   ├── routes/
│   │   ├── diagnosticPing.route.ts           mounted at /api/diagnostics/pings (behind authenticate as of Phase 15)
│   │   ├── diagnosticKafka.route.ts          mounted at /api/diagnostics/kafka-messages (behind authenticate as of Phase 15)
│   │   ├── services.route.ts                 Phase 6 — mounted at /api/services (behind authenticate as of Phase 15)
│   │   ├── events.route.ts                   Phase 6 — mounted at /api/events (behind authenticate as of Phase 15)
│   │   ├── incidents.route.ts                Phase 6 — mounted at /api/incidents; Phase 15 — POST additionally requires authorize('OPERATOR')
│   │   ├── assistant.route.ts                Phase 14 — mounted at /api/assistant (behind authenticate as of Phase 15)
│   │   ├── agentExecutions.route.ts          Phase 14 — mounted at /api/executions (behind authenticate as of Phase 15)
│   │   └── auth.route.ts                     Phase 15 — mounted at /api/auth, deliberately NOT behind authenticate
│   ├── middleware/
│   │   ├── requestId.ts, requestLogger.ts, notFound.ts, errorHandler.ts   Phase 2, unchanged
│   │   ├── authenticate.ts                   Phase 15 — verifies a Bearer JWT, attaches req.user; stateless, no DB lookup
│   │   └── authorize.ts                      Phase 15 — authorize(minimumRole): rank check (USER < OPERATOR < ADMIN) on top of authenticate
│   ├── routes/health.route.ts, controllers/health.controller.ts, types/express.d.ts
│   │   (Phase 2; express.d.ts + req.user as of Phase 15)
│   ├── services/recommendation.service.ts    Phase 10 — computeScalingRecommendation() (pure) + recommendScalingForService()
│   ├── app.ts   Phase 10 mounts toolsRouter at /internal/tools; Phase 14 mounts assistantRouter + agentExecutionsRouter;
│   │   Phase 15 mounts authRouter (unauthenticated) and wires `authenticate` explicitly onto every other /api/* mount
│   └── server.ts   connects Mongo/Redis/Kafka, ensures Kafka topics, starts the diagnostic
│       consumer, and registers all three health checks; graceful shutdown for all three
├── tests/
│   ├── health.test.ts                     Phase 2
│   ├── database.negative.test.ts          Phase 3 — real failed-Mongo-connection proof
│   ├── diagnosticPing.integration.test.ts Phase 3+4 — real CRUD + cache-aside proof (needs Mongo download + real Redis)
│   ├── redis.negative.test.ts             Phase 4 — real failed-Redis-connection proof
│   ├── redis.integration.test.ts          Phase 4 — real SET/GET/TTL + cache-aside proof (needs a real local Redis)
│   ├── kafka.negative.test.ts             Phase 5 — real failed-Kafka-connection proof, no broker needed
│   ├── topology.unit.test.ts              Phase 6 — computeDependents(), pure function, no DB needed
│   ├── digitalTwin.integration.test.ts    Phase 6 — real Mongo CRUD across services/metrics/events/incidents (needs Mongo download)
│   ├── simulation/                        Phase 7 — one file per scenario function, all pure/no-DB-needed
│   │   ├── fixtures.ts                    shared 5-service + 4-node-chain test topologies (not a test file itself)
│   │   ├── graph.test.ts, blastRadius.test.ts, bottleneck.test.ts
│   │   ├── serviceFailure.test.ts, trafficIncrease.test.ts
│   │   ├── databaseFailure.test.ts, cacheFailure.test.ts
│   │   └── highLatency.test.ts, highErrorRate.test.ts
│   ├── recommendation.unit.test.ts        Phase 10 — computeScalingRecommendation(), pure function, no DB needed
│   ├── tools.integration.test.ts          Phase 10 — all 18 /internal/tools routes against a real 3-node chain topology (needs Mongo download)
│   ├── aiServiceClient.unit.test.ts       Phase 14 — invokeAgent(), global fetch mocked, no DB/network needed
│   ├── assistant.service.unit.test.ts     Phase 14 — mapStatus()/extractRetrievedDocuments()/toStepRecords()/askAssistant(), aiServiceClient + repository both mocked, no DB/network needed
│   ├── assistant.route.unit.test.ts       Phase 14 — POST /api/assistant/ask HTTP layer, assistant.service mocked, no DB needed
│   ├── agentExecutions.route.unit.test.ts Phase 14 — GET /api/executions[/:id] HTTP layer, repository mocked, no DB needed
│   ├── agentExecution.integration.test.ts Phase 14 — real Mongo persist+read-back round trip through the actual HTTP endpoints, AI service boundary mocked (needs Mongo download); Phase 15 — every request now carries a real signed test token, plus a userId-populated + a 401-with-no-header assertion
│   ├── agentExecution.live.test.ts        Phase 14 — the one fully-live proof: real MongoDB + a real, already-running AI service process, no mocking at all (needs both); Phase 15 — carries a real signed test token
│   ├── auth.service.unit.test.ts          Phase 15 — register()/login() with userRepository mocked but real bcryptjs + real jsonwebtoken, no DB needed
│   ├── authMiddleware.unit.test.ts        Phase 15 — authenticate()/authorize() called directly (not through supertest): every rejection path (missing header, no Bearer scheme, garbage token, expired token, wrong role claim, wrong secret, insufficient rank, missing req.user), no DB needed
│   ├── auth.route.unit.test.ts            Phase 15 — POST /api/auth/register + /login HTTP layer, auth.service mocked, no DB needed
│   ├── auth.integration.test.ts           Phase 15 — the phase's own verification requirement ("privileged endpoints reject insufficient roles; tests per role") against a real MongoDB: real register -> login -> Bearer token -> authenticate -> authorize, USER/OPERATOR/ADMIN all exercised against POST /api/incidents (needs Mongo download)
│   └── helpers/testAuth.ts                Phase 15 — signTestToken()/authHeader(): signs a REAL JWT with src/utils/jwt.ts's own function, used by every other test file below that now hits an authenticated route
├── package.json, package-lock.json, tsconfig.json, vitest.config.ts
└── .env.example
```

## Install

```bash
cd backend
npm install
```

## Run

You need MongoDB reachable at `MONGODB_URI`, Redis reachable at
`REDIS_URL`, and a Kafka broker reachable at `KAFKA_BROKERS` (all default
to localhost — install them locally per the root README's prerequisites if
you haven't; Kafka was already a stated Phase 1 prerequisite).

```bash
npm run dev     # tsx watch
# or, if tsx gives you trouble (see the Windows note below):
npm run build && npm start
```

If MongoDB, Redis, or Kafka isn't reachable, the server **still starts** —
`/health` reports each one independently as `"down"`, Redis being down
makes the diagnostic-ping list endpoint fall back to querying MongoDB
directly on every request (slower, not broken) instead of failing, and
Kafka being down makes `POST /api/diagnostics/kafka-messages` return `503`
instead of throwing (the producer/consumer just never started).

**Windows note:** if `npm run dev` fails with `Cannot find module
'./constants'` (or similar) pointing inside `node_modules`, that's a known
`tsx`-on-Windows resolver issue, not a bug here — use
`npm run dev:build-watch` + `npm run dev:run-watch` (two terminals) instead,
or `npm run build && npm start`. Full details in "Common errors" below.

Once MongoDB is up, seed the digital twin's demo data (services, a couple
hours of fake metrics history, a few events, and one sample incident) —
**this wipes and replaces** the `services`, `servicemetrics`, `events`,
`incidents`, and (Phase 15) `users` collections in whatever `MONGODB_URI`
points at, so don't run it against a database you care about:

```bash
npm run seed              # tsx, same as npm run dev
# or, after npm run build:
npm run seed:build
```

As of Phase 15 this also creates 3 fixed demo accounts, one per role —
`user@demo.local` / `operator@demo.local` / `admin@demo.local`, all
sharing the password `DemoPass123!`. This is a fixed, published,
non-secret password purely so these README steps and manual verification
don't need to invent throwaway credentials each time — it is never a real
secret and protects nothing; see `src/scripts/seed.ts`'s own comment. Log
in as any of the three with `POST /api/auth/login` (see "Verify" below)
to get a real token for that role.

## Verify

```bash
curl -i http://localhost:4000/health
```

With MongoDB, Redis, and Kafka all up, expect:

```json
{"status":"ok","...":"...","checks":{"mongodb":{"status":"ok","latencyMs":1},"redis":{"status":"ok","latencyMs":1},"kafka":{"status":"ok","latencyMs":4}}}
```

`/health` stays unauthenticated (see Phase 15's Design decisions), but
almost every `/api/*` route below it now needs a real JWT. After
`npm run seed` has created the 3 demo accounts, log in as the operator one
(OPERATOR can do everything a plain USER can, plus create incidents —
one token covers every example below) and keep the token in a shell
variable:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"operator@demo.local","password":"DemoPass123!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')
```

Or register a fresh account directly (defaults to role `USER`; pass
`"role":"OPERATOR"` or `"role":"ADMIN"` to get a token with more rights,
since this phase has no separate invite/promotion flow — see Phase 15's
Design decisions for why that's an intentional, documented gap):

```bash
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"me@example.com","password":"a real password","role":"OPERATOR"}' | json_pp
# 201: {"data":{"token":"...", "user":{"id":"...","email":"me@example.com","role":"OPERATOR"}}}

curl -s -i http://localhost:4000/api/services
# 401 {"error":{"message":"Authentication required",...}} — no token, no access

curl -s http://localhost:4000/api/services -H "Authorization: Bearer $TOKEN" | json_pp
# 200 — same route, now with a real Bearer token
```

Then prove cache-aside end to end — watch `cacheHit` flip:

```bash
curl -s -X POST http://localhost:4000/api/diagnostics/pings \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"message":"cache me"}'

curl -s http://localhost:4000/api/diagnostics/pings -H "Authorization: Bearer $TOKEN"   # cacheHit: false (miss, populates Redis)
curl -s http://localhost:4000/api/diagnostics/pings -H "Authorization: Bearer $TOKEN"   # cacheHit: true  (hit, served from Redis)

curl -s -X POST http://localhost:4000/api/diagnostics/pings \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"message":"invalidator"}'

curl -s http://localhost:4000/api/diagnostics/pings -H "Authorization: Bearer $TOKEN"   # cacheHit: false again — the POST invalidated it
```

You can also inspect the cached value directly: `redis-cli GET
diagnostics:pings:recent:top100` (or `redis-cli TTL ...` to watch the TTL
count down).

Now the Kafka proof — publish a message, then poll for it to land on the
consumer side (this is genuinely asynchronous, so the first `GET` right
after the `POST` may still show it empty for a few hundred milliseconds):

```bash
curl -s -X POST http://localhost:4000/api/diagnostics/kafka-messages \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"message":"hello from kafka"}'
# 202 Accepted: {"data":{"key":"<uuid>","message":"hello from kafka","publishedAt":"..."}}

curl -s http://localhost:4000/api/diagnostics/kafka-messages -H "Authorization: Bearer $TOKEN"
# {"data":[{"key":"<same uuid>","message":"hello from kafka","publishedAt":"...","consumedAt":"...","partition":0,"offset":"0"}]}
```

The `key` in the GET response matching the `key` from the POST response,
with a later `consumedAt` than `publishedAt`, is the actual
producer → broker → consumer round trip — not two independent code paths
that happen to agree.

To see the dead-letter path for real, publish a message that the consumer
can't parse by writing directly to the topic with a CLI producer (the
HTTP endpoint always sends valid JSON, by construction, so this needs a
lower-level tool):

```bash
echo "not-json" | kafka-console-producer.sh --broker-list localhost:9092 --topic diagnostics.ping
```

Then check `diagnostics.ping.dlq` for a message whose `error` field says
`Unexpected token ... is not valid JSON` and whose `originalValue` is
`"not-json"`:

```bash
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic diagnostics.ping.dlq --from-beginning --max-messages 1
```

Now the Phase 6 proof — after `npm run seed`, the topology is real MongoDB
data, not configuration:

```bash
curl -s http://localhost:4000/api/services -H "Authorization: Bearer $TOKEN" | json_pp
# 5 services: user-service, inventory-service, payment-service,
# notification-service, order-service — payment-service's health.status
# is "degraded" on purpose (see src/data/seedTopology.ts)

curl -s http://localhost:4000/api/services/order-service -H "Authorization: Bearer $TOKEN" | json_pp
# resolvedDependencies: the other 4 services, in full
# resolvedDependents: [] — nothing depends on order-service

curl -s http://localhost:4000/api/services/payment-service -H "Authorization: Bearer $TOKEN" | json_pp
# resolvedDependents: [order-service] — this is the "what happens if
# Payment Service goes down?" edge docs/architecture.md §3 uses as its
# running example; order-service is what Phase 7's simulation engine will
# walk to next

curl -s "http://localhost:4000/api/services/order-service/metrics?limit=5" -H "Authorization: Bearer $TOKEN" | json_pp
curl -s "http://localhost:4000/api/events?service=payment-service" -H "Authorization: Bearer $TOKEN" | json_pp
curl -s http://localhost:4000/api/incidents -H "Authorization: Bearer $TOKEN" | json_pp
# the seeded "Elevated payment gateway latency" incident, status "investigating"

curl -s -X POST http://localhost:4000/api/incidents \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Test incident","description":"manually filed","serviceName":"order-service","severity":"low"}'
# 201 — $TOKEN here is the operator@demo.local login from above; a plain
# USER token gets 403 instead (see the Phase 15 proof right below), and it
# now shows up in GET /api/incidents too

curl -s -X POST http://localhost:4000/api/incidents \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"x","description":"y","serviceName":"not-a-real-service","severity":"low"}'
# 400 — proves the service.repository lookup in src/services/incident.service.ts
# is a real DB check, not a rubber stamp
```

Now the Phase 15 proof itself — docs/phases.md row 15's own wording:
"Privileged endpoints reject insufficient roles; tests per role." A plain
USER cannot create an incident, an OPERATOR (or ADMIN) can:

```bash
USER_TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@demo.local","password":"DemoPass123!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

curl -s -i -X POST http://localhost:4000/api/incidents \
  -H "Content-Type: application/json" -H "Authorization: Bearer $USER_TOKEN" \
  -d '{"title":"x","description":"y","serviceName":"order-service","severity":"low"}'
# 403 {"error":{"message":"This action requires the OPERATOR role or higher",...}}
# — real RBAC rejection, not just a documented intent
```

Phase 7 has no HTTP endpoints to `curl` — per docs/phases.md its verification
is "unit tests covering each scenario's calculated output," so `npm test`
(next section) *is* the Phase 7 proof. If you want to see it interactively
anyway, `npx tsx` a one-off script:

```bash
cat <<'EOF' | npx tsx
import { simulateServiceFailure } from './src/services/simulation';
import { SEED_SERVICES } from './src/data/seedTopology';
import { computeDependents } from './src/services/topology.service';

const dependents = computeDependents(SEED_SERVICES);
const services = SEED_SERVICES.map((s) => ({ ...s, dependents: dependents[s.name] ?? [] }));

console.log(JSON.stringify(simulateServiceFailure(services, 'payment-service'), null, 2));
EOF
```

Phase 10's `/internal/tools/*` routes are meant to be called by the AI
service's agent loop, not curled by hand — but every route is a plain
`GET`/`POST` like any other, so they're just as curl-able for a direct
proof:

```bash
curl -s http://localhost:4000/internal/tools/services | json_pp
# same shape as GET /api/services, but uncached — read straight through
# to MongoDB on every call, since an agent's tool calls need fresh data
# more than they need a 30s-stale cache

curl -s http://localhost:4000/internal/tools/bottleneck | json_pp
curl -s http://localhost:4000/internal/tools/blast-radius/payment-service | json_pp
curl -s -X POST http://localhost:4000/internal/tools/simulate/service-failure \
  -H "Content-Type: application/json" -d '{"serviceName":"payment-service"}' | json_pp
# same calculation Phase 7's unit tests already cover, now reachable over
# HTTP against the real, currently-seeded topology instead of a fixture

curl -s http://localhost:4000/internal/tools/recommend-scaling/payment-service | json_pp
# non-mutating — safe to call directly; this is the one privileged tool
# the AI service's executor is allowed to auto-execute

curl -s -X POST http://localhost:4000/internal/tools/create-incident \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","description":"manual proof","serviceName":"order-service","severity":"low"}'
# 201 — this route itself really does write to MongoDB (same
# incident.service.ts Phase 6's public /api/incidents endpoint uses); the
# guarantee that the agent can PROPOSE but never SILENTLY EXECUTE this one
# lives one layer up, in ai-service/app/tools/executor.py, which never
# calls this route at all — see ai-service/README.md's Phase 10 section
```

Phase 14's proof is docs/phases.md row 14's own wording: "Trace retrievable
via API, matches what actually happened." With MongoDB and a real
`ai-service` process both up (a real `GROQ_API_KEY` is not required — see
below):

```bash
curl -s -X POST http://localhost:4000/api/assistant/ask \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"question": "Payment service is down. What should I do?"}' | json_pp
# 201: {"data":{"id":"...", "userId":"...", "question":"...", "finalResponse":"...",
#   "status":"completed", "stoppedReason":"final_answer", "iterations":2,
#   "steps":[{"toolName":"get_service","isRagQuery":false,"timestamp":"...",...},
#            {"toolName":"search_knowledge_base","isRagQuery":true,"timestamp":"...",...}],
#   "retrievedDocuments":[{"documentId":"runbooks/payment-service-recovery",...}],
#   "createdAt":"...","updatedAt":"..."}}
# userId is the operator@demo.local account's real id, decoded straight
# out of $TOKEN by authenticate.ts — Phase 14 left this field unset,
# Phase 15 is what finally populates it from a real JWT.

curl -s http://localhost:4000/api/executions/<id from above> -H "Authorization: Bearer $TOKEN" | json_pp
# identical "data" object — this is "matches what actually happened":
# what GET returns is exactly what POST just persisted, not a re-derived
# summary of it

curl -s http://localhost:4000/api/executions -H "Authorization: Bearer $TOKEN" | json_pp
# newest first; every execution ever asked, whether it finished cleanly,
# hit the iteration limit, or failed to reach Groq
```

Without a real `GROQ_API_KEY` in `ai-service/.env` (this sandbox's own
state), the same `POST /api/assistant/ask` still returns `201` — a real
execution genuinely happened, it just failed inside the agent loop
instead of never starting one:

```json
{"data":{"id":"...","question":"...","finalResponse":"The AI service could not reach Groq: ...","status":"error","stoppedReason":"groq_error","iterations":1,"steps":[],"retrievedDocuments":[],"createdAt":"...","updatedAt":"..."}}
```

Only a completely unreachable AI service process (not started, or the
wrong `AI_SERVICE_URL`) produces no execution record at all — a clean
`502`, proven in `assistant.service.unit.test.ts`'s
`AiServiceUnavailableError` test without needing a real AI service
process to demonstrate it:

```bash
curl -i -s -X POST http://localhost:4000/api/assistant/ask \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"question": "anything"}'
# 502 {"error":{"message":"AI service is unavailable: Could not reach AI
# service at http://localhost:8000/agent/invoke: ...","requestId":"..."}}
```

## Test

```bash
npm test
```

Runs twenty-nine suites (176 tests total):

- `tests/health.test.ts` (6) — Phase 2, no external services needed.
- `tests/database.negative.test.ts` (4) — real failed-Mongo-connection proof, no MongoDB needed.
- `tests/redis.negative.test.ts` (4) — real failed-Redis-connection proof, no Redis needed.
- `tests/auth.service.unit.test.ts` (6) — Phase 15 — `register()`/`login()` with `userRepository`
  mocked but real `bcryptjs` hashing/comparison and real `jsonwebtoken` signing/verification (both
  are pure libraries, not infrastructure — mocking them would hide the one thing worth proving).
  No database needed. Verified in this sandbox.
- `tests/authMiddleware.unit.test.ts` (11) — Phase 15 — `authenticate()`/`authorize()` called
  directly (not through supertest): every rejection path (missing header, wrong scheme, garbage
  token, expired token, unrecognized role claim, wrong signing secret, insufficient rank, missing
  `req.user`), plus the success path attaching `req.user`. No database needed. Verified in this
  sandbox.
- `tests/auth.route.unit.test.ts` (9) — Phase 15 — `POST /api/auth/register` and `/login`'s HTTP
  layer (201/200 shapes, 400 validation, 409/401 propagation, the database-connected check),
  `auth.service` mocked. No database needed. Verified in this sandbox.
- `tests/redis.integration.test.ts` (4) — real SET/GET/TTL and cache-aside proof. **Needs a real
  local Redis** reachable at `REDIS_URL` (uses logical DB 15 for isolation — your dev data in
  DB 0 is never touched; see the comment at the top of the file for why there's no
  "redis-memory-server" package involved).
- `tests/kafka.negative.test.ts` (5) — real failed-Kafka-connection proof (connects to
  `127.0.0.1:1`, a port nothing listens on), no broker needed. Verified in this sandbox.
- `tests/topology.unit.test.ts` (5) — `computeDependents()` pure-function tests, including against
  the real seed topology. No database needed. Verified in this sandbox.
- `tests/diagnosticPing.integration.test.ts` (7) — real Mongo CRUD + real cache-aside proof through
  the actual HTTP endpoint, every request carrying a real signed test token (Phase 15) plus one
  no-token-401 case. **Needs both**: a real Redis (same as above) and outbound access to
  `fastdl.mongodb.org` for `mongodb-memory-server`'s one-time binary download. If your network
  blocks that host, this suite fails at `beforeAll` with a `DownloadError` — verify manually with
  the `curl` commands above instead.
- `tests/digitalTwin.integration.test.ts` (8) — real Mongo CRUD across services/metrics/events/
  incidents through the actual HTTP endpoints (a hermetic 2-service topology seeded directly via
  the repository layer, not by running `npm run seed`), including Phase 15's `POST /api/incidents`
  OPERATOR-required case (a plain USER token gets a real 403). **Same MongoDB download requirement
  as `diagnosticPing.integration.test.ts`** — fails at `beforeAll` in the same way if
  `fastdl.mongodb.org` is blocked.
- `tests/simulation/*.test.ts` (39 across 9 files) — every simulation scenario's calculated output,
  against both the real 5-service seed topology shape and a hand-built 4-node chain (for
  unambiguous multi-hop distance assertions), plus threshold/edge cases (0x and negative
  multipliers, a 0% baseline error rate, an unknown service name, an empty topology). No database,
  no mocking — these functions have no I/O to fake. Verified in this sandbox.
- `tests/recommendation.unit.test.ts` (4) — Phase 10 — `computeScalingRecommendation()`'s pure
  formula (down -> `scale_out` at 2x replicas, degraded -> `scale_out` at 1.5x, healthy -> no
  recommendation). No database needed. Verified in this sandbox.
- `tests/tools.integration.test.ts` (16) — Phase 10 — every one of the 18 `/internal/tools/*`
  routes exercised through supertest against a real 3-node chain topology (`db-service` ->
  `api-service` -> `web-service`), including the create-incident route actually writing to
  MongoDB and the read-only routes reflecting real repository data. **Needs the same
  `mongodb-memory-server` binary download** as `diagnosticPing.integration.test.ts` and
  `digitalTwin.integration.test.ts` — correctly skips here for the same reason, not independently
  re-verified in this sandbox.
- `tests/aiServiceClient.unit.test.ts` (4) — Phase 14 — `invokeAgent()`'s request shape and its
  two normalized failure modes (network error, non-2xx), global `fetch` mocked. No database, no
  real network. Verified in this sandbox.
- `tests/assistant.service.unit.test.ts` (13) — Phase 14 — `mapStatus()`'s exhaustive
  `stopped_reason` -> `status` mapping (including an unrecognized value falling back to `error`
  rather than throwing), `extractRetrievedDocuments()`'s RAG-step flattening, `toStepRecords()`'s
  timestamp parsing (with a missing/unparseable-timestamp fallback), and `askAssistant()`'s
  empty-question rejection and `AiServiceUnavailableError` -> 502 mapping — `aiServiceClient` and
  `agentExecutionRepository` both mocked. This is the actual "matches what actually happened"
  logic docs/phases.md row 14 asks for, provable without a database. Verified in this sandbox.
- `tests/assistant.route.unit.test.ts` (6) — Phase 14 — `POST /api/assistant/ask`'s HTTP layer
  (201 shape, 400 on an empty/missing question, 502 propagation, the database-connected check
  running before `assistant.service` is ever called), `assistant.service` mocked; Phase 15 adds the
  401-with-no-Authorization-header case and asserts `userId` is now passed through from `req.user`.
  No database needed. Verified in this sandbox.
- `tests/agentExecutions.route.unit.test.ts` (6) — Phase 14 — `GET /api/executions`'s limit
  clamping and `GET /api/executions/:id`'s 400/404/200 paths, `agentExecutionRepository` mocked;
  Phase 15 adds the 401-with-no-header case. No database needed. Verified in this sandbox.
- `tests/agentExecution.integration.test.ts` (7) — Phase 14 — the real Mongo persist-then-read-back
  round trip through the actual `POST /api/assistant/ask` / `GET /api/executions[/:id]` endpoints,
  covering a tool+RAG execution, an `iteration_limit` execution, a `groq_error` execution, and the
  "nothing persisted when the AI service is completely unreachable" case — the AI service's own
  HTTP boundary is mocked (same scope split `tools.integration.test.ts` uses: real Mongo, mocked
  upstream); Phase 15 adds real signed test tokens to every request, asserts the persisted
  `userId` matches the token's subject, and adds a 401-with-no-header case. **Needs the same
  `mongodb-memory-server` binary download** as every other `*.integration.test.ts` file —
  correctly fails here for the same reason.
- `tests/agentExecution.live.test.ts` (1) — Phase 14 — the one fully-live proof in this file: a
  real MongoDB (`MONGODB_URI`, not `mongodb-memory-server`) and a real, already-running AI service
  process at `AI_SERVICE_URL`, no mocking anywhere; Phase 15 adds a real signed test token to the
  request. **Needs both running** — fails at `beforeAll`
  here the same way `redis.integration.test.ts` does without a real Redis, per this project's
  established convention (see that file's own comment) of not conditionally skipping real-infrastructure
  tests. A real `GROQ_API_KEY` is *not* required for this one to pass — see "What could and
  couldn't be verified here."
- `tests/auth.integration.test.ts` (11) — Phase 15 — docs/phases.md row 15's own verification
  requirement, word for word: "Privileged endpoints reject insufficient roles; tests per role."
  Real MongoDB, real bcrypt hashing, real JWT signing/verification, and every request goes through
  the actual HTTP endpoints (`POST /api/auth/register` → `POST /api/auth/login` → Bearer token →
  `authenticate` → `authorize`), not `auth.service.ts` called directly — covers registration
  (storing a real hash, rejecting a duplicate email), login (accepting a real hash, rejecting a
  wrong password), rejecting no/garbage tokens on a protected route, and `POST /api/incidents`
  specifically: 403 for USER, 201 for OPERATOR, 201 for ADMIN. **Needs the same
  `mongodb-memory-server` binary download** as every other `*.integration.test.ts` file —
  correctly fails here for the same reason.

There is deliberately no `kafka.integration.test.ts` in this repository yet
— see "What could and couldn't be verified here" below for why, and use
the `curl` sequence above to do that positive-path proof by hand on your
machine.

## Common errors

- `MongoServerSelectionError` / Redis `ECONNREFUSED` on startup — the
  respective service isn't running, or the URI in `.env` is wrong. The
  server still starts; fix the dependency and hit `/health` again.
- `npm run dev` fails with `Cannot find module './constants'` (Windows) —
  known `tsx` resolver issue, unrelated to this codebase. Run
  `npm run build && npm start`, or `npm run dev:build-watch` +
  `npm run dev:run-watch` in two terminals instead. If you want to confirm
  it's this and not a broken install: check that
  `node_modules\mongoose\lib\constants.js` actually exists — if it's
  missing, delete `node_modules` and `package-lock.json` and reinstall;
  if it's there, it's the resolver bug and the workarounds apply.
- `mongodb-memory-server` `DownloadError` when running tests — outbound
  access to `fastdl.mongodb.org` is blocked on your network. Not a bug.
- `EADDRINUSE` — port 4000 already in use; change `PORT` in `.env`.
- `KafkaJSConnectionError` / `KafkaJSNumberOfRetriesExceeded` on startup —
  no broker reachable at `KAFKA_BROKERS`. The server still starts; `/health`
  reports `kafka` as `"down"` and `POST /api/diagnostics/kafka-messages`
  returns `503` instead of a raw error. Start your broker and hit `/health`
  again — nothing needs to be restarted, but this app only tries to connect
  once at boot, so you do need to restart *this* process after the broker
  comes up (Phase 5 doesn't implement a producer reconnect-and-retry loop;
  that's a reasonable thing to revisit if it becomes a real pain point).
- `This server does not host this topic` right after topics are first
  created — a benign, short-lived KafkaJS warning while the new topic's
  metadata propagates across the cluster. It logs, then resolves itself on
  retry; if it doesn't resolve, check `ensureTopics()` actually reached
  your broker.
- Published a message but `GET /api/diagnostics/kafka-messages` never
  shows it — check the server logs for `consumer failed to process
  message` (it will have landed in `diagnostics.ping.dlq` instead), and
  confirm `KAFKA_CONSUMER_GROUP` didn't change between the publish and the
  read (a new group ID starts consuming from the current end of the topic,
  not from messages published before it existed).
- `GET /api/services` returns `[]` (or `GET /api/services/:name` returns
  404 for a service you know you seeded) — you probably haven't run
  `npm run seed` yet, or seeded a different `MONGODB_URI` than the one the
  server is currently using. `GET /health`'s `mongodb` field tells you
  which database the server actually connected to only indirectly (it
  doesn't print the URI) — check your `.env`.
- `POST /api/incidents` returns `400 Unknown service "..."` — `serviceName`
  (and every entry in `affectedServiceNames`, if provided) must exactly
  match a seeded service's `name` (lowercase, hyphenated, e.g.
  `payment-service`), not its `displayName` (`Payment Service`).
- Running `npm run seed` twice in a row is expected and safe — it always
  deletes and re-creates all four collections, so you get the same fixed
  demo topology every time, not duplicates.
- `POST /api/assistant/ask` returns `502 AI service is unavailable` — the
  AI service process isn't running, or `AI_SERVICE_URL` in `.env` doesn't
  point at it. This is a clean, handled error (see `aiServiceClient.ts`),
  not a crash, and nothing gets persisted to `agentexecutions` for this
  request — check `AI_SERVICE_URL` and that `uvicorn app.main:app` is
  actually running on that port.
- `POST /api/assistant/ask` returns `201` but `status: "error"` with an
  empty `steps` array — the AI service *is* reachable, but it couldn't
  reach Groq (`GROQ_API_KEY` unset or invalid, or Groq itself unreachable
  from wherever the AI service is running). This is still a real,
  correctly-persisted execution — see `ai-service/README.md` for fixing
  the Groq side of it.
- `401 {"error":{"message":"Authentication required",...}}` on any
  `/api/*` route except `/api/auth/*` — no `Authorization: Bearer <token>`
  header was sent, or it didn't start with `Bearer `. Log in (or register)
  via `/api/auth/login` (or `/register`) to get a real token; see
  "Verify" above.
- `401 {"error":{"message":"Invalid or expired token",...}}` — the token
  is malformed, signed with a different `JWT_SECRET` than this process is
  currently running with (e.g. you changed `.env` and didn't get a fresh
  token), or it's past `JWT_EXPIRES_IN`. Log in again for a fresh one.
- `403 {"error":{"message":"This action requires the OPERATOR role or
  higher",...}}` on `POST /api/incidents` — your token's role is `USER`.
  Log in as `operator@demo.local` (or `admin@demo.local`) after
  `npm run seed`, or register a new account with `"role":"OPERATOR"`.
- `POST /api/auth/register` returns `409` — that email is already
  registered (including, if you re-ran `npm run seed`, a stale token from
  before the reseed for one of the 3 demo accounts — those are re-created
  each time, so log in again rather than reusing an old token).

## What could and couldn't be verified here

Same situation as MongoDB in Phase 3: this sandbox has no way to run an
actual Kafka broker, and unlike Redis (installable via `apt`), there is no
broker distribution reachable from here at all —

- no `apt` package for a Kafka broker (only client libraries: `librdkafka`,
  `kcat`, various Go clients),
- `archive.apache.org`, `downloads.apache.org`, and `repo.maven.apache.org`
  all return `403` through the sandbox's egress proxy — the same
  organization-policy block that stops `fastdl.mongodb.org` in Phase 3,
  not something route-around-able,
- no Redpanda or other Kafka-API-compatible broker available either.

So what's actually been verified here, versus what needs your machine:

- **Compiles and typechecks clean** (`npx tsc --noEmit`, `npm run build`) —
  verified.
- **Every piece of code that can be exercised without a live broker is
  exercised for real** in `tests/kafka.negative.test.ts`: a genuine
  `connect()` attempt against `127.0.0.1:1` (a port nothing listens on)
  rejecting, the health check correctly reporting `"down"`, `/health`
  returning `503`, and the diagnostic POST endpoint returning a clean `503`
  through `errorHandler` rather than an unhandled exception — verified.
- **The producer → broker → consumer round trip, consumer groups actually
  distributing partitions, and the dead-letter path actually catching a
  malformed message** — this needs a real broker responding to real
  `admin.createTopics()`/`producer.send()`/`consumer.run()` calls, which
  this sandbox cannot provide. This is not verified here. Run the `curl`
  (and `kafka-console-producer.sh`/`kafka-console-consumer.sh`) sequence
  under "Verify" above on your own machine, where Kafka is already a
  stated Phase 1 prerequisite, to complete this proof.

**Phase 6 (MongoDB data model) — same MongoDB-binary-download limitation as
Phase 3, nothing new:**

- **Compiles and typechecks clean**, and every piece of Phase 6 logic that
  doesn't need a real MongoDB — `computeDependents()`'s pure-function
  behavior, including against the actual seed topology — is verified here
  (`tests/topology.unit.test.ts`, 5/5 passing in this sandbox).
- **The real MongoDB proof** (`tests/digitalTwin.integration.test.ts`:
  seed → query → resolve dependencies/dependents → create an incident →
  reject an unknown service) needs `mongodb-memory-server`'s one-time
  binary download, which is blocked here the same way
  `diagnosticPing.integration.test.ts` already was in Phase 3 — **not**
  independently re-verified in this sandbox. Run `npm test` on your
  machine (or `npm run seed` + the `curl` sequence under "Verify") to
  complete this proof for real.

**Phase 7 (simulation engine) — fully verified here, no external
infrastructure involved:** every one of the 8 scenario/analysis functions
is a pure function with zero I/O, so unlike every other phase so far,
there is no "needs your machine" caveat for Phase 7 at all. `npm test`
in this sandbox is the real, complete proof — 39/39 simulation tests
passing here is the same result you'll get.

**Phase 10 (internal tool API) — same MongoDB-binary-download limitation
as Phase 3/6, nothing new, plus one genuine live wiring proof this sandbox
*could* do:**

- **Compiles and typechecks clean** (`npx tsc --noEmit`, `npm run build`),
  and the one piece of Phase 10 logic with no I/O —
  `computeScalingRecommendation()`'s pure formula — is fully verified here
  (`tests/recommendation.unit.test.ts`, 4/4 passing).
- **The real MongoDB proof for all 18 routes**
  (`tests/tools.integration.test.ts`) needs the same
  `mongodb-memory-server` binary download blocked here since Phase 3 — not
  independently re-verified in this sandbox. Run `npm test` on your
  machine to complete this proof for real.
- **The real cross-process wiring** — a real `node dist/server.js` process
  actually listening on `/internal/tools/*` and returning real (if
  DB-less) responses — **was** verified here: with no MongoDB reachable in
  this sandbox, `GET /internal/tools/services` and `GET
  /internal/tools/bottleneck` both returned a genuine `503 Database is
  currently unavailable` from the real running process (the same
  `assertDatabaseConnected()` guard every Phase 6 route already uses), not
  a mock or a stub. This is the same honest partial proof Phase 8 gave for
  `GET /api/backend/services`. See `ai-service/README.md`'s Phase 10
  section for the other half: the AI service's agent loop making a real,
  unmocked outbound call that (in this sandbox) reaches Groq's real API
  boundary and is blocked only by this sandbox's own egress policy, not by
  anything wrong in the code.

**Phase 14 (agent execution trace) — same MongoDB-binary-download
limitation as Phase 3/6/10 for persistence, plus this phase's own
AI-service-reachability limitation, nothing new in kind:**

- **Compiles and typechecks clean**, and all four pieces of Phase 14 logic
  that don't need a real database or a real running AI service —
  `aiServiceClient.invokeAgent()`'s request shape and failure
  normalization, `mapStatus()`'s exhaustive mapping,
  `extractRetrievedDocuments()`'s RAG-step flattening,
  `toStepRecords()`'s timestamp parsing, and both new routes' HTTP-layer
  behavior (validation, status codes, the database-check-before-AI-call
  ordering) — are fully verified here for real: 27/27 passing
  (`aiServiceClient.unit.test.ts` + `assistant.service.unit.test.ts` +
  `assistant.route.unit.test.ts` + `agentExecutions.route.unit.test.ts`).
  This is the actual "matches what actually happened" transformation
  logic docs/phases.md row 14 cares about — provable without either
  external dependency.
- **The real Mongo persist-then-read-back round trip**
  (`agentExecution.integration.test.ts`) needs the same
  `mongodb-memory-server` binary download blocked here since Phase 3 —
  not independently re-verified in this sandbox.
- **The fully-live version** (`agentExecution.live.test.ts`: real
  MongoDB + a real running AI service process, no mocking) needs both a
  local MongoDB (same as every other phase) and `ai-service` actually
  running (`uvicorn app.main:app --port 8000`) — neither is available in
  this sandbox. Notably, this one does **not** additionally need a real
  `GROQ_API_KEY`: even ai-service's own `groq_error` path (confirmed
  reachable in `ai-service/README.md`'s Phase 10 section — a real,
  blocked outbound attempt to `api.groq.com`) is a real execution this
  backend can persist and read back correctly, which is exactly what this
  test asserts. Start both processes and a local MongoDB, then run
  `npm test` to get this phase's complete real-infrastructure proof on
  your machine.

**Phase 15 (authentication + authorization) — no new kind of limitation;
most of this phase needed no external infrastructure at all to verify for
real:**

- **Compiles and typechecks clean**, and every piece of Phase 15 logic
  that doesn't need a real MongoDB — real bcrypt hashing/comparison, real
  JWT signing/verification (both genuine library calls, not mocked),
  `authenticate`'s and `authorize`'s every rejection path, and both new
  routes' HTTP-layer validation/status-code behavior — is fully verified
  here for real: 26/26 passing (`auth.service.unit.test.ts` +
  `authMiddleware.unit.test.ts` + `auth.route.unit.test.ts`). This is the
  actual authentication/authorization logic, provable without a database.
- **The full real-MongoDB proof** (`tests/auth.integration.test.ts`:
  register → login → protected route → RBAC per role) needs the same
  `mongodb-memory-server` binary download blocked here since Phase 3 —
  not independently re-verified in this sandbox. Run `npm test` on your
  machine (or the "Verify" `curl` sequence above, which is the same proof
  by hand) to complete it for real.
- **Every existing route this phase put behind `authenticate`
  (`/api/diagnostics/*`, `/api/services`, `/api/events`, `/api/incidents`,
  `/api/assistant/ask`, `/api/executions`) now needs a real token in its
  own test file too** — `tests/diagnosticPing.integration.test.ts`,
  `tests/digitalTwin.integration.test.ts`,
  `tests/agentExecution.integration.test.ts`, and
  `tests/agentExecution.live.test.ts` were all updated to carry one (via
  `tests/helpers/testAuth.ts`, which signs with the real
  `signAccessToken()`), so this phase didn't just add new tests — it
  updated every existing test file whose target route changed behavior,
  the same discipline Phase 14 already required when it added the
  backend→AI-service call. Nothing that used to pass silently started
  passing for the wrong reason (e.g. a route becoming unreachable and a
  test not noticing) — a pre-Phase-15 baseline run (`npm test` before any
  of this phase's code changes) confirmed the exact same 7 pre-existing
  `mongodb-memory-server`/local-Redis-dependent suites as the only
  failures, both before and after.

## Design decisions worth knowing

- **The server doesn't crash if MongoDB or Redis is down at boot.** Both
  connection attempts are wrapped in try/catch in `server.ts`; the HTTP
  listener starts regardless, and `/health` reports each dependency's real
  state independently. A Redis outage degrades the app (slower reads,
  `cacheHit` always `false`), it doesn't take it down.
- **`getOrSetCache()` is generic**, not specific to diagnostic pings — it
  takes a key, a TTL, and a `fetcher()` function, so Phase 6's digital-twin
  reads (service topology, metrics) can reuse it directly instead of every
  future phase reinventing cache-aside.
- **A single cache key, not one per `?limit=` value.** The list endpoint
  always caches the 100 most recent pings under one key and slices the
  requested `limit` from that in memory. This makes invalidation trivial —
  one key to delete on every write — at the cost of over-fetching on a
  cache miss. A reasonable trade for a proof-of-cache; a real high-traffic
  endpoint would be tuned differently.
- **`cacheHit` is in the API response, not just in logs.** So cache
  behavior is directly observable (`curl` twice, watch it flip to `true`)
  instead of only provable by reading Redis yourself.
- **The Redis health check does a real SET/GET/TTL round trip**, not just
  `PING` — it writes a random canary value with a TTL on every `/health`
  call, reads it back, and verifies both the value and that the TTL was
  actually applied. This is the project's live "prove Redis actually
  works" check, not just a reachability check.
- **Redis tests use logical DB 15, not a memory-server package.** Unlike
  MongoDB, Redis natively supports 16 isolated logical databases
  (`SELECT 0`–`15`) on a single running instance, so test isolation is a
  `flushdb()` scoped to DB 15 rather than spinning up a separate process.
  Your real dev data (DB 0) is never touched by the test suite.
- **The producer is idempotent (`kafka.producer({ idempotent: true })`).**
  If a `send()` needs to be retried after a network blip, KafkaJS
  de-duplicates it at the broker so the retried message isn't written
  twice — the "idempotency" requirement from the spec, actually enabled,
  not just mentioned in a comment.
- **Every message carries an explicit key** (`producers/diagnosticProducer.ts`).
  Kafka routes all messages sharing a key to the same partition, which is
  what guarantees per-key ordering. This diagnostic producer uses a random
  key per message purely to demonstrate that keyed messages spread across
  `diagnostics.ping`'s 3 partitions; a real producer (Phase 6's
  `service.events`, say) would key by something meaningful like `serviceId`
  so every event for one service stays in order.
- **Topics are created explicitly (`ensureTopics()` / `admin.createTopics()`),
  not left to broker auto-creation.** Most real clusters disable
  auto-creation, and relying on it would hand every topic whatever
  `num.partitions` default the broker happens to have instead of a
  deliberate partition count.
- **One shared consumer group per consumer (`KAFKA_CONSUMER_GROUP`).**
  If you ever run two instances of this backend against the same broker,
  they'll automatically split `diagnostics.ping`'s partitions between them
  instead of each processing every message — that's what a consumer group
  is for. A single instance simply gets all the partitions.
- **`runConsumer()` is generic**, the same pattern as `getOrSetCache()` —
  it takes a `groupId`, a `topic`, an optional `dlqTopic`, and an
  `onMessage` handler, so Phase 6+ consumers (service events, simulation
  events, agent events) reuse the same dead-letter wiring instead of each
  reimplementing try/catch-and-republish.
- **A message that fails processing still gets its offset committed.**
  `consumerFactory.ts` catches the error, logs it, and (if a `dlqTopic` is
  configured) republishes the message there with the error attached — but
  either way, KafkaJS commits the offset once `eachMessage` returns, so one
  permanently-bad message can't stall the whole partition by being retried
  forever. The trade-off: a *transient* failure (a downstream service
  briefly down) also moves on rather than retrying, which is why the
  producer's idempotency and any downstream retry logic matter more than
  consumer-side retries here.
- **KafkaJS's own console-based logger is disabled and routed through
  pino** (`logLevel: logLevel.NOTHING` + a custom `logCreator` in
  `config/kafka.ts`), the same reasoning as everywhere else in this
  codebase: one structured JSON log stream in production, not a second,
  differently-formatted one from a dependency.
- **`dependents` is always derived, never hand-typed.** A service document
  stores both `dependencies` and `dependents` (docs/architecture.md §5
  calls for both), but only `dependencies` is ever written by a human or
  the seed script — `dependents` is computed by
  `computeDependents()` (`src/services/topology.service.ts`, a pure
  function with no I/O) and persisted as the derived reverse edge. This
  makes it structurally impossible for the two directions of the graph to
  drift out of sync, and it's the one piece of Phase 6 logic that's fully
  unit-tested without any database at all (`tests/topology.unit.test.ts`).
- **`src/services/` is genuinely a new layer, not a renamed repository.**
  docs/architecture.md §4 reserves `services/` for business logic above
  data access; `topology.service.ts` composes two repository calls
  (`findByNames` for dependencies, `findByNames` for dependents) into one
  view, and `incident.service.ts` validates a `serviceName` is real before
  `incident.repository.ts` ever touches Mongo. Controllers call the
  service layer, never the repository layer, directly.
- **Kafka isn't wired into any Phase 6 write path, on purpose.**
  docs/architecture.md §7 lists `service.events` and `incidents` as topics,
  but names their real producers as the simulation engine / health monitor
  (Phase 7+) and the agent's privileged create-incident tool (Phase 11) —
  neither exists yet. Producing onto those topics from `POST
  /api/incidents` now would mean inventing a producer that has nothing
  real to say, which is exactly the kind of "configuration pretending to
  be infrastructure" this project's verification-first rule exists to
  prevent. This gets revisited for real once Phase 7/11 give those events
  actual content.
- **The service list is cached, nothing about it is invalidated.** Unlike
  the diagnostic-ping cache, no endpoint in this phase writes to the
  `services` collection at request time (only `npm run seed` does, offline),
  so `twin:services:all` simply expires after its TTL rather than needing
  an invalidation call — there's no write path to hang one off yet.
- **The seed script is destructive and idempotent, not additive.** It
  deletes and fully re-creates `services`/`servicemetrics`/`events`/
  `incidents` every run rather than trying to merge with whatever's already
  there. For a fixed demo topology this is simpler and more robust than
  upsert-merge logic across four related collections, at the cost of being
  unsafe to run against data you want to keep — documented plainly above
  and in the script's own header comment.
- **`incident.repository.ts` stays a dumb data-access seam.** The "does
  this service actually exist" check lives in `incident.service.ts`, not
  the repository — same division Phase 3 established
  (`diagnosticPing.repository.ts` never validates, controllers/services do).
- **The simulation engine is 100% pure — no Mongo, no Redis, no Kafka, no
  HTTP, no LLM.** Every function takes a `SimulationServiceState[]`
  snapshot as a plain argument and returns a plain object; nothing in
  `src/services/simulation/` imports anything from `config/`, `models/`,
  or `repositories/`. This is what docs/architecture.md §11 means by "no
  LLM involvement in the calculation itself" taken to its logical
  conclusion, and it's why this phase's tests need no database at all — a
  first for this project.
- **Reconciling two slightly different lists in the architecture doc.**
  docs/architecture.md §11 names six "simulation types" (service failure,
  traffic multiplier, database failure, cache failure, high latency, high
  error rate); §10 names six "simulation" tools (the same four plus
  `calculate_blast_radius` and `find_bottleneck` instead of the two
  "high latency"/"high error rate" identifiers). Rather than picking one
  list over the other, this phase implements all eight — `calculateBlastRadius`
  turned out to be a genuinely reusable building block for
  `simulateServiceFailure` (and for `simulateDatabaseFailure`/
  `simulateCacheFailure` via `cascadeFromOrigins`), not redundant work.
- **A required-dependency model, not a redundancy-aware one.**
  `simulateServiceFailure` treats every entry in `dependencies` as hard-required
  — if a service's dependency fails, the service goes fully `'down'`, never
  partially degraded. This matches the real scenario docs/architecture.md §1
  uses as its running example (no Payment Service means no completed orders)
  and keeps the engine simple; a future phase could add a "critical vs.
  optional dependency" flag if the topology grows services with real fallback
  paths.
- **`dependsOnDatabase`/`dependsOnCache` default to `true`, and live only in
  the simulation engine's input type, not Phase 6's `Service` schema.**
  Every service in this topology plausibly touches both, so defaulting to
  "yes" for an unset value avoids a Phase 6 migration just for this engine
  to have something to simulate; a later phase can set these per-service in
  real seed/topology data once the distinction actually matters (e.g. a
  purely stateless service).
- **Cache failure degrades; database failure goes down — deliberately
  different outcomes**, and not just because docs/architecture.md says so:
  `simulateCacheFailure`'s "slower, not broken" result mirrors the actual
  runtime behavior `src/cache/cacheAside.ts` already implements since Phase
  4 (`getOrSetCache()` falls back to the real fetcher when Redis is down).
  The simulation engine's prediction and the real code's behavior are the
  same story told twice, which is the point of a *digital twin*.
- **All propagation formulas are simple, linear, and documented in
  `constants.ts`, not "realistic."** This is explicitly a deterministic
  demonstration engine (docs/architecture.md: "deterministic application
  code computes"), not a capacity-planning tool — every threshold
  (`TRAFFIC_CAPACITY_MULTIPLIER`, `PROPAGATION_DECAY_FACTOR`, the outage
  thresholds) is a named, commented constant specifically so it's easy to
  find and argue with, rather than a magic number buried in a formula.
- **`/internal/tools/*` is a separate, uncached mount, not a reuse of
  `/api/*`.** Same underlying business logic, but the public routes are
  cache-aside (a 30s-stale answer is fine for a dashboard) while an
  agent's tool calls should see the current state at investigation time —
  and keeping them physically separate also means nothing here is exposed
  to a browser by accident. `docs/tools.route.ts`'s own header comment
  says the route path isn't part of the tool contract the LLM sees at
  all — only the tool's name and JSON-schema parameters are (defined on
  the AI-service side, `ai-service/app/tools/schemas.py`) — so the two
  files are kept in sync by hand, documented on both sides, rather than
  generated from one shared source that doesn't exist yet.
- **Every tool handler is a thin wrapper, not new business logic.** All 18
  routes in `src/tools/` call existing Phase 6 services/repositories or
  Phase 7 simulation functions directly; the only genuinely new code this
  phase added is `recommendation.service.ts` (a small, pure scaling
  formula) and `simulationAdapter.ts` (a type-mapping seam with no
  business logic of its own). This keeps Phase 10 what docs/phases.md row
  10 actually asks for — "tool schemas + tool execution loop against
  backend tool API" — rather than an excuse to redesign the domain logic
  a second time.
- **`POST /internal/tools/create-incident` itself is not where the
  "propose, don't silently execute" guarantee lives.** This route writes
  to MongoDB exactly like Phase 6's public `POST /api/incidents` — trying
  to make the *route* refuse to execute would mean either a fake
  always-pending status in the database (a lie about what the database
  actually contains) or a second, parallel "proposed incidents" collection
  invented for this one phase. Instead the guarantee is enforced entirely
  on the AI-service side, in `ai-service/app/tools/executor.py`: the
  dispatch table for `create_incident` never calls this route's client
  function at all, no matter what the LLM asks for — see
  `ai-service/README.md`'s Phase 10 design decisions for the full
  reasoning and the test that pins this down
  (`test_create_incident_is_privileged_mutating_and_never_calls_the_real_backend`).
- **All 8 simulation functions are exposed as tools, matching Phase 7's
  own resolution of the same architecture-doc discrepancy.** §10 names six
  "simulation" tools, §11 names six "simulation types" — a slightly
  different six (swapping `calculate_blast_radius`/`find_bottleneck` for
  "high latency"/"high error rate" identifiers). Phase 7 already resolved
  this by implementing all 8 functions rather than picking one list as
  authoritative; Phase 10 carries that same resolution forward into the
  tool layer for consistency, rather than arbitrarily under-exposing two
  of Phase 7's own functions.
- **Node's built-in `fetch`, not a new HTTP-client dependency.**
  `aiServiceClient.ts` is one POST call. `@types/node` has typed the
  global `fetch`/`Request`/`Response` since Node 18 with zero extra
  install, and `npx tsc --noEmit` confirms it compiles clean under this
  project's `"lib": ["ES2022"]` (no `"dom"` needed) — adding axios or
  node-fetch for a single call would be exactly the kind of unnecessary
  dependency this project's ground rules steer away from (the same
  reasoning `ai-service/README.md` gives for choosing fastembed's plain
  style over a heavier alternative).
- **`status` is derived once, in `assistant.service.ts`, from the AI
  service's raw `stopped_reason` — never stored as a second, independently
  set field.** `stoppedReason` is kept alongside it specifically so this
  mapping is never the *only* place that information survives (a future
  phase reading raw `stoppedReason` values doesn't have to reverse-engineer
  them out of `status`), but there is exactly one function
  (`mapStatus()`) responsible for turning one into the other, and it's
  unit-tested exhaustively over every value ai-service's `loop.py` can
  currently produce, with a documented, deliberate fallback (`'error'`)
  for anything it doesn't recognize yet.
- **Persisting nothing at all when the AI service is completely
  unreachable, but persisting a real record for a `groq_error` run.** The
  distinction is whether an execution actually happened: a network-level
  failure to even reach `POST /agent/invoke` means `run_agent()` never
  ran, so there is nothing truthful to trace; a `groq_error` result means
  the agent loop *did* run and made a real (if unsuccessful) attempt —
  recording that is exactly what docs/architecture.md §16's execution
  trace concept is for. Silently swallowing either case, or fabricating a
  placeholder record for the unreachable case, would both violate this
  project's "never silently swallow errors" / "no fabricated infrastructure
  claims" rules from opposite directions.
- **`retrievedDocuments` is computed once at write time, not derived on
  every read.** `extractRetrievedDocuments()` flattens every RAG step's
  results into this field when the execution is first persisted, so a
  reader of `GET /api/executions/:id` gets §16's documented field
  directly rather than having to know that "RAG results" actually live
  inside `steps[].result.results` for whichever steps happen to have
  `isRagQuery: true`. It's redundant with data already in `steps` by
  design — same trade-off `service.model.ts`'s resolved
  dependencies/dependents already made in Phase 6.
- **`POST /api/assistant/ask` checks `assertDatabaseConnected()` before
  calling the AI service, not after.** The AI service call can be a real,
  possibly slow, multi-iteration agent run (up to
  `AGENT_MAX_ITERATIONS` x `AGENT_TOOL_TIMEOUT_MS` plus however long Groq
  itself takes) — there's no reason to pay that cost only to fail
  persisting the result at the very last step. This mirrors every other
  controller in this codebase (`incidents.controller.ts`,
  `tools.controller.ts`, ...) checking the database first, just applied
  before an outbound call instead of before a read/write.
- **No conditional test-skip logic for `agentExecution.live.test.ts`,
  matching this codebase's existing convention.** Unlike the Python side
  of this project (which uses `pytest.mark.skipif` extensively), no
  backend test file in this repository conditionally skips when real
  infrastructure is missing — `redis.integration.test.ts`'s own comment
  says so explicitly ("If no Redis is running, every test in this file
  fails at beforeAll... that's a missing local dependency, not a bug
  here"). `agentExecution.live.test.ts` follows that same convention
  rather than introducing a new pattern for this one file.
- **JWT verification is stateless — no database lookup on every
  authenticated request.** `src/utils/jwt.ts`'s `verifyAccessToken()`
  trusts a token's signature and expiry, then trusts the id/email/role it
  carries; `authenticate.ts` never queries `users` to re-confirm the
  account still exists or still has that role. The trade-off, stated
  plainly rather than hidden: revoking access or changing someone's role
  doesn't take effect until their current token expires
  (`JWT_EXPIRES_IN`, 1 hour by default) — there is no token-revocation
  list in this phase's scope. This is the standard trade-off stateless
  JWTs make, and it's why `JWT_EXPIRES_IN` exists as a tunable rather than
  an unbounded token lifetime.
- **`authorize()` is rank-based, not an exact-role-match set.**
  `authorize('OPERATOR')` accepts `OPERATOR` *and* `ADMIN` — an `ADMIN`
  can always do what an `OPERATOR` can, encoded once as
  `USER: 0 < OPERATOR: 1 < ADMIN: 2` in `src/middleware/authorize.ts`,
  rather than checked ad hoc at every call site.
- **Self-registration allows choosing any of the 3 real roles, including
  `OPERATOR`/`ADMIN` — a real, documented gap, not an oversight.**
  docs/phases.md row 15 asks only for "JWT, RBAC (USER/OPERATOR/ADMIN)"
  and "tests per role"; there is no existing `ADMIN` account in this
  phase to gate a promotion/invite flow behind, and inventing one (a
  hardcoded bootstrap admin, a manual-only promotion script) would be
  speculative infrastructure for a problem this phase doesn't ask to
  solve yet. What *is* enforced is that `role` must be one of the 3 real
  strings (`register()` rejects anything else with `400`), so this is "any
  of the 3 real roles," not "any string." A real deployment would need a
  proper invite/promotion flow before this endpoint should accept a role
  parameter from an unauthenticated caller at all — flagged here
  explicitly rather than silently shipped as if it were production-ready.
- **The same 401 message for a wrong password and an unknown email**
  (`src/services/auth.service.ts`'s `login()`) — standard
  account-enumeration hygiene: a caller can't distinguish "that email
  isn't registered" from "that email is registered but you got the
  password wrong" by the response alone.
- **`authenticate`/`authorize` wired explicitly per route at the
  `src/app.ts` mount point, not applied globally then selectively
  exempted.** Same "grouping is enforced, not just documented" ethos
  Phase 10 established for tool privilege tiers (docs/architecture.md
  §10): the auth boundary for every router is visible in one place in
  `app.ts` rather than requiring a reader to open each route file (or
  worse, infer it from what 401s in practice) to know what's protected.
- **`/internal/tools/*` deliberately stays outside JWT auth.** It's a
  separate trust boundary — service-to-service between the AI service and
  this backend (docs/architecture.md §15: "the AI service has no
  MongoDB/Redis/Kafka client at all... every piece of live data the agent
  sees has already passed through the backend's validation/auth/business
  logic") — not user-facing RBAC. Putting end-user JWT auth in front of it
  would require the AI service to hold and send a user's token for every
  tool call it makes on that user's behalf, which this phase's scope
  (docs/phases.md row 15: "JWT, RBAC (USER/OPERATOR/ADMIN)" for the
  public API) doesn't ask for and which would conflate two different
  trust boundaries into one.
- **`bcryptjs`, not native `bcrypt`.** Same reasoning `mongodb-memory-server`
  vs. a real Mongo install already established for this project
  (pick the option with the fewest moving parts for local dev across
  platforms): native `bcrypt` needs `node-gyp` and a C++ toolchain to
  build, which is one more thing to get right on a fresh Windows/macOS/
  Linux setup for a hashing workload this project's scale doesn't need
  the native version's raw speed for. `bcryptjs` is a pure-JS
  implementation of the same algorithm, produces
  interoperable `$2a$`/`$2b$` hashes, and needs nothing to compile.
- **`agentexecutions.userId` finally gets a real value — no schema
  change needed.** Phase 14 added the field as `required: false` with a
  comment pointing straight at this phase ("Phase 15 populates this from
  a real JWT once auth exists"); Phase 15 changes exactly one line
  (`src/controllers/assistant.controller.ts` passing `req.user?.id`
  through) to make that comment true, rather than a migration.
