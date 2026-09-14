---
title: Digital Twin System Architecture Overview
document_type: architecture
related_service: all
updated: 2026-01-10
---

# Digital Twin System Architecture Overview

This document describes the small e-commerce system that the AI Digital
Twin models. It is written for an on-call engineer or the AI assistant
investigating an incident, not for someone building the platform itself —
for the platform's own architecture (how the backend, AI service, and
frontend fit together), see `docs/architecture.md` in the repository
root instead.

## The five modeled services

The digital twin currently models five services, seeded as real MongoDB
documents (`services` collection) with a dependency graph, health
snapshots, and rolling metrics history:

- **user-service** — owns user accounts, authentication, and profile
  data. No downstream dependencies in this topology.
- **inventory-service** — tracks product stock levels and reservations.
  No downstream dependencies in this topology.
- **payment-service** — charges and refunds orders through an external
  payment gateway integration. No downstream dependencies in this
  topology, but see "Why payment-service matters more than its position
  in the graph suggests" below.
- **notification-service** — sends order confirmation, shipping, and
  payment-failure emails/SMS. No downstream dependencies in this
  topology.
- **order-service** — the checkout and order-management service. It is
  the one service in this topology with real dependencies: it calls
  user-service (to validate the buyer), inventory-service (to reserve
  stock), payment-service (to charge the order), and
  notification-service (to confirm the order) for every checkout.

## The dependency graph, and why it looks the way it does

Only `order-service` has outbound dependencies in this topology — the
other four are "leaf" services from a dependency-graph perspective. This
is deliberate: it makes `order-service` the single, unambiguous
"aggregator" whose health is a direct function of all four of the others,
which is exactly the shape needed to demonstrate blast-radius and
cascading-failure reasoning without an artificially tangled graph.

In practical terms: if you ask "what happens if payment-service goes
down?", the answer is almost entirely about what happens to
`order-service` (and, transitively, to anyone relying on `order-service`
completing checkouts) — not about payment-service's own dependents in
some deeper chain, because there isn't one. `order-service` itself has no
dependents in this topology, so a failure that starts and ends at
`order-service` doesn't cascade any further outward.

## Why payment-service matters more than its position in the graph suggests

Structurally, payment-service looks like just one of four peers
order-service depends on. In practice, it is the dependency most likely
to actually degrade in this system, for two reasons that show up
repeatedly in this project's runbooks and incident history:

1. It is the only service integrating with an external, third-party
   system (the payment gateway) rather than talking only to other
   services this platform controls. External dependencies are the
   classic source of latency spikes and partial outages that this
   platform's own deploys can't directly cause or fix.
2. A payment failure is user-visible and revenue-impacting in a way a
   notification delay or a stale inventory count usually isn't — a
   customer whose card was declined (or worse, double-charged) notices
   immediately, while a delayed confirmation email is a minor
   inconvenience.

This is why `payment-service` shows up disproportionately often in this
knowledge base's runbooks and incident reports: it is genuinely the
highest-value service to have good, rehearsed recovery procedures for.

## Health status semantics

Each service's `health.status` field is one of `healthy`, `degraded`, or
`down`. `degraded` means the service is still serving requests but with
elevated latency, an elevated error rate, or reduced capacity — not a
full outage. A service can be `degraded` for an extended period (hours,
occasionally longer) without ever crossing into `down`, particularly when
the root cause is an external dependency issue rather than something
this platform can restart or redeploy its way out of.

## How this relates to the simulation engine

Everything above describes the topology's *real*, currently-seeded state.
The platform's deterministic simulation engine (see
`docs/architecture.md` §11 in the repository root) answers a different
question: not "what is happening right now" but "what would happen if
X happened", by walking this same dependency graph forward from a
hypothetical starting failure. The simulation engine's output and this
document should always agree on the shape of the graph itself (who
depends on whom) — if they ever disagree, the topology data is the
source of truth, since the simulation engine reads it at request time
rather than hardcoding a copy of it.
