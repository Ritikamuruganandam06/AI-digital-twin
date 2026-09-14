---
title: Payment Service Recovery Runbook
document_type: runbook
related_service: payment-service
updated: 2026-02-20
---

# Payment Service Recovery Runbook

Use this runbook when `payment-service`'s health status is `degraded` or
`down`, when `find_bottleneck` identifies it as the system's current
bottleneck, or when a `calculate_blast_radius` simulation for
`payment-service` shows meaningful impact on `order-service`.

## Step 1: Confirm the current state before doing anything

Don't act on a stale alert. Pull the live state first:

- `GET /api/services/payment-service` (or the equivalent
  `get_service` tool call) for its current `health.status` and
  `health.errorRate`/`health.latencyMs`.
- `GET /api/services/payment-service/metrics?limit=20` (or
  `get_service_metrics`) for the last 20 samples — a single bad sample
  is noise, a sustained trend across the whole window is a real problem.
- `GET /api/incidents?service=payment-service` (or
  `get_incident_history`) to check whether this is already a tracked,
  in-progress incident rather than a new one.

## Step 2: Classify the failure mode

Payment-service failures fall into three categories, and the right
response is different for each:

**Elevated latency, error rate still normal.** Almost always the
external payment gateway itself running slow, not this service. Check
the gateway's own status page first. There is usually nothing to do on
this platform's side except wait and communicate — restarting
payment-service does not fix a slow upstream gateway.

**Elevated error rate, latency roughly normal.** Usually either a bad
deploy (check the last deploy time against when the error rate started
climbing) or the gateway rejecting requests outright (auth/config issue
rather than a performance issue). If it correlates with a recent deploy,
roll back first and investigate after — don't try to root-cause a
regression live.

**Full outage (`health.status: down`).** Treat as a full incident
immediately: this stops all checkout completion system-wide, since
`order-service` depends on `payment-service` for every order. File an
incident (or, if you're the AI assistant, propose one via the
`create_incident` tool — this is a privileged, propose-only action, not
one you execute silently) and move to Step 3.

## Step 3: Assess blast radius before communicating

Before telling anyone how bad it is, actually check: run a
`calculate_blast_radius` (or `simulate_service_failure`) simulation
for `payment-service`. In this topology, the direct and complete answer
is `order-service` — checkout stops working, nothing else does. This
system has no second-order dependents of `order-service`, so the blast
radius does not extend further than that. Say exactly this, not a vaguer
"payments are affected" — precision here is what lets other teams decide
whether they're affected without having to ask.

## Step 4: Mitigate

- If it's a bad deploy: roll back. This is the fastest, lowest-risk fix
  and should usually happen before deep investigation, not after.
- If it's the external gateway: there is no code fix. Communicate the
  external dependency clearly (so people stop looking for a deploy to
  roll back) and monitor for the gateway's own recovery.
- If `order-service`'s checkout flow doesn't already queue or retry
  failed payment attempts, that gap is worth flagging as follow-up work
  after the incident, not something to build live during one.

## Step 5: Confirm recovery, then close out

Don't declare recovery from a single healthy sample. Confirm
`health.status` has returned to `healthy` (not just `degraded`) and that
the error-rate/latency metrics have been back to baseline for a
sustained window, not just one good reading. Update the incident record
with the actual root cause and resolution, not a placeholder — a future
on-call engineer (or the AI assistant) searching this knowledge base
should be able to find real prior instances of this exact situation, not
generic notes.
