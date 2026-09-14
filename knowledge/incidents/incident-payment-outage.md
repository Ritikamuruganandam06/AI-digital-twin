---
title: "Incident Report: Elevated Payment Gateway Latency"
document_type: incident
related_service: payment-service
updated: 2026-02-18
---

# Incident Report: Elevated Payment Gateway Latency

**Status:** Investigating (matches the seeded `incidents` collection
record for `payment-service` — this document is the narrative writeup of
that same incident, kept in sync with it by hand; if the two ever
disagree, the `incidents` collection is the current source of truth for
status, and this document is the source of truth for root-cause detail
the structured record doesn't carry a field for).

**Severity:** Medium
**Affected service:** payment-service
**Detected:** health check transitioned from `healthy` to `degraded`

## Summary

`payment-service`'s error-rate and latency metrics began trending upward
during a period of otherwise-normal traffic. No corresponding deploy to
`payment-service` occurred in the window before the degradation started,
which ruled out a bad-release explanation early and pointed the
investigation toward the external payment gateway integration instead.

## Timeline

- Health check on `payment-service` transitions from `healthy` to
  `degraded`. `health.latencyMs` climbs noticeably above its recent
  baseline; `health.errorRate` stays close to baseline at this point —
  this matters, because it's what told us early this was a latency
  problem, not a correctness problem, and shaped which mitigation to try
  first.
- On-call pulls the last 20 `payment-service` metric samples
  (`GET /api/services/payment-service/metrics?limit=20`) and confirms
  the trend is sustained across the whole window, not one noisy sample —
  ruling out "just a blip."
- `GET /api/services/payment-service` and `GET /api/incidents` checked
  for any pre-existing tracked incident before filing a new one — per the
  payment-service recovery runbook's Step 1, confirming current state
  before acting.
- Deploy history for `payment-service` checked and ruled out as the
  cause — no deploy in the relevant window.
- Investigation shifts to the external payment gateway per the recovery
  runbook's failure-mode classification ("elevated latency, error rate
  still normal" -> check the gateway first). This matches that pattern.
- Incident opened and tracked in the `incidents` collection with status
  `investigating`.

## Root cause (best understanding at time of writing)

The elevated latency traces to the external payment gateway's own
response times increasing, not to anything in this platform's own code
or infrastructure. This is consistent with the architecture note in
`knowledge/architecture/system-architecture.md` that `payment-service` is
the one service in this topology integrating with a third-party system
outside this platform's control, and therefore the most exposed to
exactly this kind of externally-caused degradation.

## Blast radius assessed during the incident

A `calculate_blast_radius` simulation run against `payment-service`
during the incident confirmed the impact was contained to
`order-service` — checkout latency increased correspondingly, but no
other service's health was affected, and `order-service` itself has no
further dependents in this topology for the impact to cascade into. This
matched the recovery runbook's stated expectation exactly, which is
itself a useful confirmation that the topology-based blast-radius
reasoning holds up against a real (if externally-caused) degradation, not
just against synthetic what-if simulations.

## Mitigation taken

No code-level mitigation was available or attempted, per the recovery
runbook's guidance for this failure mode — there is no application fix
for an upstream gateway running slow. The response was monitoring and
clear communication that the root cause was external, so that effort
wasn't spent looking for a deploy to roll back that didn't exist.

## Status and follow-up

This incident remains in `investigating` status pending confirmation of
full recovery from the gateway side (a sustained return to baseline
latency, not a single good sample, per the recovery runbook's Step 5
guidance). Suggested follow-up once this closes: `order-service`'s
checkout flow does not currently queue or retry failed/slow payment
attempts — worth scoping as a real piece of follow-up work, not just a
comment left in a runbook, given this is the second time a payment
gateway slowdown has directly translated into checkout-latency user
impact rather than being absorbed somewhere.
