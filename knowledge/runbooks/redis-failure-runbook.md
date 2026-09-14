---
title: Redis Cache Failure Runbook
document_type: runbook
related_service: all
updated: 2026-01-25
---

# Redis Cache Failure Runbook

Redis backs the backend's cache-aside layer (`src/cache/cacheAside.ts`)
in front of read-heavy endpoints like `GET /api/services` and the
diagnostic-ping list. It is a performance optimization, not a system of
record — MongoDB is the system of record for every collection this
platform has. That distinction is the entire reason this runbook is
short: a Redis outage is a performance incident, never a data-loss or
correctness incident.

## What actually happens when Redis is unreachable

`getOrSetCache()` (the cache-aside helper every caching endpoint uses)
falls back to querying the real data source directly whenever Redis is
down or errors out — it does not throw, and it does not serve stale or
incorrect data. This means:

- Every endpoint that reads through the cache keeps working, just slower
  (every request hits MongoDB directly instead of the fast path).
- `cacheHit` in API responses (where present) will read `false` on every
  request, since there is no cache to hit.
- `GET /health`'s `checks.redis.status` will report `"down"`, while
  `checks.mongodb.status` and everything downstream of it keeps
  reporting normally.
- No write path in this platform depends on Redis at all — Redis is only
  ever read-through, never the primary write target for anything.

## Step 1: Confirm it's actually a Redis outage, not a real slowdown

Check `GET /health`. If `checks.redis.status` is `"down"` and
`checks.mongodb.status` is `"ok"`, this is a pure caching-layer outage —
proceed with this runbook. If MongoDB is *also* reporting problems, this
is not a Redis incident — the elevated latency is coming from the
database directly, and caching wouldn't have masked it anyway once the
cache's TTL expired.

## Step 2: Decide whether this needs an incident at all

For a short blip (Redis restarted, briefly unreachable, recovers within
a few minutes), this usually doesn't warrant a formal incident — the
system degraded gracefully exactly as designed, and nothing was ever
actually broken for an end user. For an extended outage (Redis down for
an extended period during a period of real read traffic), it's worth at
least a low-severity incident record, since sustained load against
MongoDB directly — traffic it wasn't sized to take alone — is itself a
risk worth having a record of, even if nothing broke this time.

## Step 3: Mitigate

There is no application-level mitigation beyond what already happens
automatically (the fallback to MongoDB). The actual fix is restoring
Redis itself — restart the process/instance, check disk space if it was
an eviction/OOM issue, and check network connectivity between the
backend and Redis if it was a connectivity issue. This runbook does not
cover Redis operations itself; escalate to whoever owns the Redis
instance if the fix isn't a simple restart.

## Step 4: Confirm recovery

`checks.redis.status` back to `"ok"` in `GET /health` is sufficient
confirmation — there is no data to reconcile or backfill, since Redis
never held anything that wasn't also derivable from MongoDB on demand.
