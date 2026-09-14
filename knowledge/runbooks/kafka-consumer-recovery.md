---
title: Kafka Consumer Recovery Runbook
document_type: runbook
related_service: all
updated: 2026-01-28
---

# Kafka Consumer Recovery Runbook

This runbook covers a stalled or lagging Kafka consumer group on this
platform — currently the diagnostic consumer
(`KAFKA_CONSUMER_GROUP`, subscribed to `diagnostics.ping`), with the same
recovery shape applying to any future consumer group this platform adds
on top of the shared `runConsumer()`/dead-letter wiring.

## Recognizing the symptom

A message was published (`POST /api/diagnostics/kafka-messages` returned
`202` with a `key`) but never shows up when polling
`GET /api/diagnostics/kafka-messages` for that same key, even after
waiting well past the normal sub-second consume latency. This is
different from a message landing in the dead-letter topic
(`diagnostics.ping.dlq`) — a DLQ'd message *was* consumed, just failed
processing; a message that never appears at all was either never
delivered to the consumer or the consumer itself has stopped making
progress.

## Step 1: Check whether the consumer process is running at all

The consumer starts as part of the backend process itself
(`startDiagnosticConsumer()`, called from `server.ts` at boot, guarded
the same way Mongo/Redis/Kafka connection failures are — a Kafka
connection failure at boot does not crash the backend, but it does mean
no consumer ever started). If the backend process logs show
`failed to connect to Kafka on startup`, the fix is restarting the
backend process once the broker is reachable again — this platform does
not implement an automatic reconnect-and-retry loop for the initial
connection, by design (see the note on this in `backend/README.md`'s
Common Errors section) — a deliberate scope decision, not an oversight,
revisit it if it becomes a recurring operational pain point.

## Step 2: Check for consumer lag, not just absence

If the consumer process is running, the next most common cause is lag —
the consumer is behind, not stopped. This shows up as: messages
*eventually* appear in `GET /api/diagnostics/kafka-messages`, just later
than expected, and the gap grows over time rather than staying constant.
Lag that grows without bound usually means `eachMessage` (the per-message
handler) is taking longer per message than messages are arriving — check
for anything in that handler doing unexpectedly slow work (a downstream
call added later without considering consumer throughput, for example).

## Step 3: Check the dead-letter topic

If a specific message never appears but others published around the
same time do, that message likely failed processing and was routed to
`diagnostics.ping.dlq` — check there before assuming it was lost
entirely. `consumerFactory.ts` always commits the offset after handling
a message, success or failure (with failures going to the DLQ when one
is configured) specifically so one permanently-bad message can't stall
every message behind it in the same partition. That's a deliberate
trade-off: a message that fails for a *transient* reason (a downstream
dependency briefly down) also moves on rather than being retried
in-place, which is why this platform leans on producer-side idempotency
and DLQ inspection rather than consumer-side retry loops.

## Step 4: Check consumer group membership after a topic/partition change

If `KAFKA_CONSUMER_GROUP` ever changes (a new deploy with a different
group id, intentionally or by accident), the new group starts consuming
from the current end of the topic, not from messages published before
the group existed — this looks exactly like "message lost" from the
publisher's point of view but is actually expected Kafka behavior for a
brand-new consumer group. Confirm the group id in the current deploy
matches what was running when the message was published.

## Step 5: Confirm recovery

Publish a fresh diagnostic message and confirm it appears in
`GET /api/diagnostics/kafka-messages` within the normal sub-second
window, with `consumedAt` later than `publishedAt` — the same
producer → broker → consumer round-trip proof this platform's own README
verification steps already describe. That's sufficient confirmation; no
backfill of missed messages is possible or expected once they've fallen
off the consumer's view of the topic (this platform does not currently
replay from an earlier offset as part of recovery).
