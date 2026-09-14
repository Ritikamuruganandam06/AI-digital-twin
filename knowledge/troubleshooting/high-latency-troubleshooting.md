---
title: General High-Latency Troubleshooting Guide
document_type: troubleshooting
related_service: all
updated: 2026-02-01
---

# General High-Latency Troubleshooting Guide

This guide covers diagnosing elevated latency on any service in this
topology, independent of which one is affected. For payment-service
specifically, prefer `runbooks/payment-service-recovery.md` — it has more
targeted guidance because payment-service's most common latency cause
(the external gateway) is a known, specific pattern that a general guide
can't be as precise about.

## First: is it real, and how bad?

Pull the last 15-20 metric samples for the affected service
(`get_service_metrics`) rather than reacting to a single alert. Latency
alerts on a single noisy sample are common and not worth escalating on
their own; a sustained upward trend across the whole recent window is
what actually warrants investigation.

## Second: is it isolated, or does the simulation engine confirm a spread pattern?

Run a `simulate_high_latency` scenario for the affected service and
compare its predicted downstream impact against what other services are
*actually* currently reporting (`get_current_system_state` or
individual `get_service` calls). If the simulation predicts downstream
services should also be showing elevated latency and they genuinely are,
that's a strong signal this is a real cascading effect propagating
through the dependency graph, not an isolated blip in one service's
reporting. If the simulation predicts spread but nothing downstream is
actually showing it yet, the degradation may still be early — worth
re-checking shortly rather than assuming it's already spreading.

## Third: narrow down the cause by category

**If the service has no external dependencies** (most services in this
topology, per `architecture/system-architecture.md`) — the cause is
almost always internal: a recent deploy, resource exhaustion, or a
downstream dependency it calls (only `order-service` has any in this
topology). Check deploy history first; it's the fastest thing to rule in
or out.

**If the service is `order-service`** — check each of its four
dependencies individually (`user-service`, `inventory-service`,
`payment-service`, `notification-service`) rather than assuming the
latency originates in `order-service` itself. `order-service`'s own
latency is frequently just a reflection of whichever dependency is
currently slowest, per Amdahl's-law-style reasoning: a synchronous call
chain is only as fast as its slowest link.

**If the service has an external dependency** (currently only
`payment-service`) — check whether the external system's own status page
or the correlation with a recent deploy points to an internal versus
external cause before spending time on internal-only mitigations that
won't help an externally-caused problem.

## Fourth: use blast-radius reasoning before communicating impact

Before telling anyone "the system is slow," run `calculate_blast_radius`
for the actually-affected service and report the *specific* downstream
services affected, not a vague system-wide claim. This topology's
dependency graph is narrow (only `order-service` has dependencies at
all), so blast radius is almost always either "contained to this one
service" or "this service plus order-service" — there is no scenario in
the current topology where a single-service failure cascades further
than that.

## When to escalate to a specific runbook instead of this general guide

If the affected service is `payment-service`, or the pattern matches the
"elevated latency, error rate still normal" failure mode described in
that runbook, switch to `runbooks/payment-service-recovery.md` — it has
more specific, tested guidance for that exact service than this general
guide can offer.
