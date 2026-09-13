# backend

Node.js + TypeScript + Express application. Owns MongoDB, Redis, and Kafka
integration, the digital twin's data model, the deterministic simulation
engine, and the internal tool API the AI service calls.

**Phase 10 status:** the internal tool API (`src/tools/`), mounted at
`/internal/tools` — 18 uncached HTTP routes across three privilege tiers
(docs/architecture.md §10) that the AI service's agent loop calls as
tools: 8 read-only routes (thin wrappers over the Phase 6 services/
repositories), 8 simulation routes (thin wrappers over Phase 7's pure
engine, fed real topology via the new `src/tools/simulationAdapter.ts`
seam that `services/simulation/index.ts`'s own Phase 7 comment
anticipated), and 2 privileged routes — `GET
/internal/tools/recommend-scaling/:name` (new `recommendation.service.ts`;
non-mutating, safe to auto-execute) and `POST
/internal/tools/create-incident` (mutating; this route itself still just
writes the incident like Phase 6's public endpoint does — it's the AI
service's tool *executor*, not this route, that's responsible for never
calling it without a human decision in the loop, see
`ai-service/README.md`). No new business logic was invented for this
phase — every handler in `src/tools/tools.controller.ts` and
`simulationTools.controller.ts` calls existing Phase 6/7 code.

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
│   │   ├── env.ts         + redisUrl, redisDefaultTtlSeconds (Phase 4)
│   │   ├── logger.ts
│   │   ├── database.ts    Phase 3
│   │   └── redis.ts       connectToRedis()/disconnectFromRedis()/isRedisConnected()/getRedisClient()
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
│   │   └── incident.model.ts                 Phase 6 — incidents (manual only this phase; `source` field is forward-compatible)
│   ├── repositories/
│   │   ├── diagnosticPing.repository.ts      pure Mongo data-access, unchanged since Phase 3
│   │   ├── service.repository.ts             Phase 6 — upsertByName (idempotent), findAll, findByName(s)
│   │   ├── serviceMetric.repository.ts       Phase 6
│   │   ├── event.repository.ts               Phase 6
│   │   └── incident.repository.ts            Phase 6
│   ├── services/                             business logic above the repository layer (docs/architecture.md §4)
│   │   ├── topology.service.ts               Phase 6 — computeDependents() (pure) + getServiceTopology()
│   │   ├── incident.service.ts               Phase 6 — validates serviceName/affectedServiceNames exist before writing
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
│   ├── scripts/seed.ts                       Phase 6 — `npm run seed`; destructive, idempotent, seeds services+metrics+events+1 incident
│   ├── controllers/
│   │   ├── diagnosticPing.controller.ts      cache-aside in front of the repository
│   │   ├── diagnosticKafka.controller.ts     Phase 5 — POST publishes, GET reads the consumed-message store
│   │   ├── services.controller.ts            Phase 6 — list (cached)/get-with-topology/metrics
│   │   ├── events.controller.ts              Phase 6 — recent events, optional ?service= filter
│   │   └── incidents.controller.ts           Phase 6 — list/get/create
│   ├── tools/                                 Phase 10 — mounted at /internal/tools, not /api/*
│   │   ├── tools.controller.ts               8 read-only tool handlers, thin wrappers over Phase 6 services/repositories
│   │   ├── simulationTools.controller.ts     8 simulation tool handlers (the 8 functions from Phase 7)
│   │   ├── simulationAdapter.ts              ServiceRecord (Mongo) -> SimulationServiceState (engine input)
│   │   └── tools.route.ts                    all 18 routes; read-only + simulation + 2 privileged
│   ├── routes/
│   │   ├── diagnosticPing.route.ts           mounted at /api/diagnostics/pings
│   │   ├── diagnosticKafka.route.ts          mounted at /api/diagnostics/kafka-messages
│   │   ├── services.route.ts                 Phase 6 — mounted at /api/services
│   │   ├── events.route.ts                   Phase 6 — mounted at /api/events
│   │   └── incidents.route.ts                Phase 6 — mounted at /api/incidents
│   ├── middleware/, routes/health.route.ts, controllers/health.controller.ts,
│   │   utils/AppError.ts, types/express.d.ts   (Phase 2, unchanged)
│   ├── services/recommendation.service.ts    Phase 10 — computeScalingRecommendation() (pure) + recommendScalingForService()
│   ├── app.ts   Phase 10 — mounts toolsRouter at /internal/tools
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
│   └── tools.integration.test.ts          Phase 10 — all 18 /internal/tools routes against a real 3-node chain topology (needs Mongo download)
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
and `incidents` collections in whatever `MONGODB_URI` points at, so don't
run it against a database you care about:

```bash
npm run seed              # tsx, same as npm run dev
# or, after npm run build:
npm run seed:build
```

## Verify

```bash
curl -i http://localhost:4000/health
```

With MongoDB, Redis, and Kafka all up, expect:

```json
{"status":"ok","...":"...","checks":{"mongodb":{"status":"ok","latencyMs":1},"redis":{"status":"ok","latencyMs":1},"kafka":{"status":"ok","latencyMs":4}}}
```

Then prove cache-aside end to end — watch `cacheHit` flip:

```bash
curl -s -X POST http://localhost:4000/api/diagnostics/pings \
  -H "Content-Type: application/json" -d '{"message":"cache me"}'

curl -s http://localhost:4000/api/diagnostics/pings   # cacheHit: false (miss, populates Redis)
curl -s http://localhost:4000/api/diagnostics/pings   # cacheHit: true  (hit, served from Redis)

curl -s -X POST http://localhost:4000/api/diagnostics/pings \
  -H "Content-Type: application/json" -d '{"message":"invalidator"}'

curl -s http://localhost:4000/api/diagnostics/pings   # cacheHit: false again — the POST invalidated it
```

You can also inspect the cached value directly: `redis-cli GET
diagnostics:pings:recent:top100` (or `redis-cli TTL ...` to watch the TTL
count down).

Now the Kafka proof — publish a message, then poll for it to land on the
consumer side (this is genuinely asynchronous, so the first `GET` right
after the `POST` may still show it empty for a few hundred milliseconds):

```bash
curl -s -X POST http://localhost:4000/api/diagnostics/kafka-messages \
  -H "Content-Type: application/json" -d '{"message":"hello from kafka"}'
# 202 Accepted: {"data":{"key":"<uuid>","message":"hello from kafka","publishedAt":"..."}}

curl -s http://localhost:4000/api/diagnostics/kafka-messages
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
curl -s http://localhost:4000/api/services | json_pp
# 5 services: user-service, inventory-service, payment-service,
# notification-service, order-service — payment-service's health.status
# is "degraded" on purpose (see src/data/seedTopology.ts)

curl -s http://localhost:4000/api/services/order-service | json_pp
# resolvedDependencies: the other 4 services, in full
# resolvedDependents: [] — nothing depends on order-service

curl -s http://localhost:4000/api/services/payment-service | json_pp
# resolvedDependents: [order-service] — this is the "what happens if
# Payment Service goes down?" edge docs/architecture.md §3 uses as its
# running example; order-service is what Phase 7's simulation engine will
# walk to next

curl -s "http://localhost:4000/api/services/order-service/metrics?limit=5" | json_pp
curl -s "http://localhost:4000/api/events?service=payment-service" | json_pp
curl -s http://localhost:4000/api/incidents | json_pp
# the seeded "Elevated payment gateway latency" incident, status "investigating"

curl -s -X POST http://localhost:4000/api/incidents \
  -H "Content-Type: application/json" \
  -d '{"title":"Test incident","description":"manually filed","serviceName":"order-service","severity":"low"}'
# 201, and it now shows up in GET /api/incidents too

curl -s -X POST http://localhost:4000/api/incidents \
  -H "Content-Type: application/json" \
  -d '{"title":"x","description":"y","serviceName":"not-a-real-service","severity":"low"}'
# 400 — proves the service.repository lookup in src/services/incident.service.ts
# is a real DB check, not a rubber stamp
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

## Test

```bash
npm test
```

Runs nineteen suites (100 tests total):

- `tests/health.test.ts` (6) — Phase 2, no external services needed.
- `tests/database.negative.test.ts` (4) — real failed-Mongo-connection proof, no MongoDB needed.
- `tests/redis.negative.test.ts` (4) — real failed-Redis-connection proof, no Redis needed.
- `tests/redis.integration.test.ts` (4) — real SET/GET/TTL and cache-aside proof. **Needs a real
  local Redis** reachable at `REDIS_URL` (uses logical DB 15 for isolation — your dev data in
  DB 0 is never touched; see the comment at the top of the file for why there's no
  "redis-memory-server" package involved).
- `tests/kafka.negative.test.ts` (5) — real failed-Kafka-connection proof (connects to
  `127.0.0.1:1`, a port nothing listens on), no broker needed. Verified in this sandbox.
- `tests/topology.unit.test.ts` (5) — `computeDependents()` pure-function tests, including against
  the real seed topology. No database needed. Verified in this sandbox.
- `tests/diagnosticPing.integration.test.ts` (6) — real Mongo CRUD + real cache-aside proof through
  the actual HTTP endpoint. **Needs both**: a real Redis (same as above) and outbound access to
  `fastdl.mongodb.org` for `mongodb-memory-server`'s one-time binary download. If your network
  blocks that host, this suite fails at `beforeAll` with a `DownloadError` — verify manually with
  the `curl` commands above instead.
- `tests/digitalTwin.integration.test.ts` (7) — real Mongo CRUD across services/metrics/events/
  incidents through the actual HTTP endpoints (a hermetic 2-service topology seeded directly via
  the repository layer, not by running `npm run seed`). **Same MongoDB download requirement as
  `diagnosticPing.integration.test.ts`** — fails at `beforeAll` in the same way if
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
