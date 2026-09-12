# backend

Node.js + TypeScript + Express application. Owns MongoDB, Redis, and Kafka
integration, the digital twin's data model, the deterministic simulation
engine, and the internal tool API the AI service calls.

**Phase 4 status:** real Redis connection via ioredis, wired into the same
health-check registry as MongoDB, plus a working cache-aside proof on top
of the Phase 3 diagnostic-ping endpoint. Kafka is not wired up yet — that
starts Phase 5.

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
│   │       └── redis.check.ts     live SET -> GET -> verify TTL proof, registered in server.ts
│   ├── models/diagnosticPing.model.ts        Mongoose schema (proof-of-CRUD only)
│   ├── repositories/diagnosticPing.repository.ts   pure Mongo data-access, unchanged since Phase 3
│   ├── controllers/diagnosticPing.controller.ts    now cache-aside in front of the repository
│   ├── routes/diagnosticPing.route.ts        mounted at /api/diagnostics/pings
│   ├── middleware/, routes/health.route.ts, controllers/health.controller.ts,
│   │   utils/AppError.ts, types/express.d.ts   (Phase 2, unchanged)
│   ├── app.ts
│   └── server.ts   now also connects to Redis on boot, disconnects on shutdown
├── tests/
│   ├── health.test.ts                     Phase 2
│   ├── database.negative.test.ts          Phase 3 — real failed-Mongo-connection proof
│   ├── diagnosticPing.integration.test.ts Phase 3+4 — real CRUD + cache-aside proof (needs Mongo download + real Redis)
│   ├── redis.negative.test.ts             Phase 4 — real failed-Redis-connection proof
│   └── redis.integration.test.ts          Phase 4 — real SET/GET/TTL + cache-aside proof (needs a real local Redis)
├── package.json, package-lock.json, tsconfig.json, vitest.config.ts
└── .env.example
```

## Install

```bash
cd backend
npm install
```

## Run

You need MongoDB reachable at `MONGODB_URI` and Redis reachable at
`REDIS_URL` (both default to localhost — install them locally per the root
README's prerequisites if you haven't).

```bash
npm run dev     # tsx watch
# or, if tsx gives you trouble (see the Windows note below):
npm run build && npm start
```

If either MongoDB or Redis isn't reachable, the server **still starts** —
`/health` reports each one independently as `"down"`, and Redis being down
specifically makes the diagnostic-ping list endpoint fall back to querying
MongoDB directly on every request (slower, not broken) instead of failing.

**Windows note:** if `npm run dev` fails with `Cannot find module
'./constants'` (or similar) pointing inside `node_modules`, that's a known
`tsx`-on-Windows resolver issue, not a bug here — use
`npm run dev:build-watch` + `npm run dev:run-watch` (two terminals) instead,
or `npm run build && npm start`. Full details in "Common errors" below.

## Verify

```bash
curl -i http://localhost:4000/health
```

With MongoDB and Redis both up, expect:

```json
{"status":"ok","...":"...","checks":{"mongodb":{"status":"ok","latencyMs":1},"redis":{"status":"ok","latencyMs":1}}}
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

## Test

```bash
npm test
```

Runs five suites (28 tests total):

- `tests/health.test.ts` (6) — Phase 2, no external services needed.
- `tests/database.negative.test.ts` (4) — real failed-Mongo-connection proof, no MongoDB needed.
- `tests/redis.negative.test.ts` (4) — real failed-Redis-connection proof, no Redis needed.
- `tests/redis.integration.test.ts` (4) — real SET/GET/TTL and cache-aside proof. **Needs a real
  local Redis** reachable at `REDIS_URL` (uses logical DB 15 for isolation — your dev data in
  DB 0 is never touched; see the comment at the top of the file for why there's no
  "redis-memory-server" package involved).
- `tests/diagnosticPing.integration.test.ts` (6) — real Mongo CRUD + real cache-aside proof through
  the actual HTTP endpoint. **Needs both**: a real Redis (same as above) and outbound access to
  `fastdl.mongodb.org` for `mongodb-memory-server`'s one-time binary download. If your network
  blocks that host, this suite fails at `beforeAll` with a `DownloadError` — verify manually with
  the `curl` commands above instead.

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
