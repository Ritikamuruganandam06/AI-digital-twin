---
title: General High-Error-Rate Troubleshooting Guide
document_type: troubleshooting
related_service: all
updated: 2026-02-02
---

# General High-Error-Rate Troubleshooting Guide

This guide covers diagnosing an elevated error rate on any service in
this topology. Error-rate problems and latency problems are related but
distinct failure modes, and this platform's health model deliberately
tracks them as separate fields (`health.errorRate` and
`health.latencyMs`) rather than one combined "badness" score — a service
can be slow but still correct (see the high-latency guide), or fast but
wrong, which is what this guide covers.

## First: distinguish "errors" from "slow"

A service returning errors quickly is a different problem than a service
timing out slowly, even though both can look like "the service is
broken" from the outside. Check `health.errorRate` specifically, not
just overall alert noise. If both `errorRate` and `latencyMs` are
elevated together, that combination usually points toward resource
exhaustion (the service is overloaded enough that some requests fail
outright rather than just queueing) rather than a pure logic bug, which
tends to produce errors without much latency change.

## Second: correlate with recent deploys first

An elevated error rate with no corresponding latency change is the
single most deploy-correlated failure pattern this platform sees — check
whether the affected service had a deploy in the window immediately
before the error rate started climbing before investigating anything
else. If there's a clear correlation, rolling back is almost always
faster and lower-risk than root-causing the regression live, per the
same reasoning `runbooks/payment-service-recovery.md` gives for its
"elevated error rate" failure mode.

## Third: check whether it's a validation/input problem, not a service problem

Some errors are the system correctly rejecting invalid input, not a
service actually malfunctioning — for example, `POST /api/incidents`
correctly returns `400` for a `serviceName` that doesn't match a real
seeded service, which is expected behavior, not a bug. Before treating an
elevated error rate as an incident, sample a few of the actual failing
requests (where request-level logs are available) to confirm they're
genuine unexpected failures and not a client repeatedly sending
already-invalid requests.

## Fourth: for order-service specifically, identify which dependency is failing

Because `order-service` is the only service in this topology that calls
others, an elevated error rate there can originate in any of its four
dependencies, not necessarily in `order-service`'s own code. Check each
dependency's own `health.errorRate` individually
(`get_service` per dependency, or `get_current_system_state` for all of
them at once) rather than assuming the bug is in `order-service` itself
just because that's where the error is user-visible.

## Fifth: use simulate_high_error_rate to validate your hypothesis

Once you have a hypothesis for which service is the root cause, run a
`simulate_high_error_rate` scenario for that service and compare its
predicted downstream impact against what's actually being observed. If
they match, that's good confirmation the hypothesis is right before
committing to a fix; if they don't match, the actual root cause is
probably somewhere the hypothesis didn't account for.

## When to escalate to a specific runbook instead of this general guide

If the affected service is `payment-service`, switch to
`runbooks/payment-service-recovery.md` for more specific guidance. For a
Kafka-consumer-shaped symptom (messages failing to process rather than a
service's own request/response error rate climbing), see
`runbooks/kafka-consumer-recovery.md` instead — that's a related but
distinctly different kind of "error" than this guide covers.
