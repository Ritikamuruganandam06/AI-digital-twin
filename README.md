# AI Digital Twin & What-If Simulation Platform

A full-stack agentic AI platform that models a small distributed e-commerce
system as a **digital twin** and lets an LLM-based agent investigate it:
diagnose health, trace blast radius, run deterministic what-if simulations,
and recommend recovery actions — grounded in both live system state and a
retrieval-augmented knowledge base of runbooks and incident reports.

This is **not** a chatbot wrapped around a database. It is an investigation
and simulation platform where the LLM plans and explains, and deterministic
application code computes.

## Repository structure

```
ai-digital-twin/
├── frontend/       React + TypeScript + Vite UI (Phase 17)
├── backend/        Node.js + TypeScript + Express API, Mongo/Redis/Kafka (Phases 2–7, 10, 14–16)
├── ai-service/     Python + FastAPI agent, Groq/Llama, tools, RAG (Phases 8–13)
├── knowledge/      Source markdown documents ingested into the RAG pipeline (Phase 12)
├── docs/           Architecture, API, and design documentation (maintained continuously)
└── tests/          Cross-service / end-to-end tests (Phase 19)
```

## Documentation

Start here:

- [`docs/architecture.md`](docs/architecture.md) — system architecture, component responsibilities, communication flow, and every major design decision.
- [`docs/phases.md`](docs/phases.md) — the phase-by-phase build roadmap this project follows.
- [`docs/env-vars.md`](docs/env-vars.md) — every environment variable used across all three services.

## Status

**Phases 1–7 complete:** repository scaffolding, the Express app skeleton
(health checks, structured logging, correlation IDs, centralized error
handling), a real MongoDB/Mongoose connection with a verified CRUD proof, a
real Redis/ioredis connection with a working cache-aside layer in front of
it, real Kafka/KafkaJS integration (idempotent producer, consumer group,
dead-letter topic, explicit topic creation) with a producer → topic →
consumer diagnostic proof, the digital twin's real data model — services
(topology + dependency graph + health), metrics, events, and incidents as
actual MongoDB collections, with a seed script and query endpoints that
return the modeled topology — and the deterministic simulation engine
(`backend/src/services/simulation/`): 8 pure, side-effect-free functions
covering service failure, traffic increase, database failure, cache
failure, high latency, high error rate, blast-radius calculation, and
bottleneck detection, each with dedicated unit tests.

**Phase 8 complete:** the Python FastAPI AI service now exists as a real,
separately-running third service (`ai-service/`) — a skeleton with its own
`GET /health` endpoint and one HTTP boundary call to the Node backend's
existing read-only `GET /api/services` endpoint via `GET
/api/backend/services`, implemented in `ai-service/app/clients/backend_client.py`.
This is deliberately the entire scope: no Groq/LLM client, no agent loop,
no tool-calling, no RAG, no Qdrant, and — like the Node backend — no
direct MongoDB/Redis/Kafka client at all (`docs/architecture.md` §15: the
AI service can only ever reach live data by going through the backend's
own validated, authorized tool API). A dead or unreachable backend
returns a clean `502` from this service instead of crashing or hanging
it. See `ai-service/README.md` for exactly how this was verified with
both real processes running, including the one sandbox-specific caveat
(the same kind every phase so far has had for at least one dependency):
this repo's sandbox has no real MongoDB available, so the *live* proof
run here shows a real backend response of `503` (DB unavailable)
converted into a real `502` by the AI service — a genuine network round
trip between two real, unmocked processes, just not populated with seeded
topology data. Running the same two commands on a machine where the
backend's MongoDB is already connected (as verified in Phase 3/6) returns
`200` with real service data instead.

**Phase 9 complete:** a Groq chat-completion client
(`ai-service/app/llm/groq_client.py`) — the only code in the AI service
that talks to Groq. `create_chat_completion()`/`get_chat_reply()` send an
OpenAI-style message list to Groq's Chat Completions API and return the
reply; the model is read from `LLM_MODEL` (default
`llama-3.3-70b-versatile`, Groq's current production Llama model) rather
than hardcoded anywhere, and a missing `GROQ_API_KEY` is rejected before
any network call is attempted. This is deliberately the entire scope per
`docs/phases.md` row 9 — no tool schemas offered to Groq, no tool-calling
loop, no agent orchestration, and nothing yet calls this client from
anywhere else in the service (that starts in Phase 10). **One honest
caveat:** row 9's own verification requirement is "real completion
returned from Groq, verified in a test" — this repo's build sandbox has
no Groq API key, so `tests/test_groq_client_live.py` (the real,
unmocked-network test that proves this) ran but was automatically
*skipped* there, not passed. Every other Groq-client test (7 of them)
mocks the network and passed. The live proof still needs to be run once
on a machine with a real `GROQ_API_KEY` in `ai-service/.env` — see
`ai-service/README.md` for the exact command, the same deferral pattern
Phase 5 used for the Kafka broker.

**Phase 10 complete:** the agent can now actually call tools. On the
backend side, `backend/src/tools/` adds 18 uncached HTTP routes mounted at
`/internal/tools` — 8 read-only, 8 simulation (Phase 7's engine, now fed
real topology), and 2 privileged — across three privilege tiers
(`docs/architecture.md` §10). On the AI-service side,
`ai-service/app/tools/` defines JSON-schema tool definitions for all 18 and
a privilege-enforcing executor, and the new `ai-service/app/agent/loop.py`
is the actual tool-calling loop: it sends the conversation plus those
schemas to Groq, executes whatever tools Groq asks for against the real
backend, feeds the real results back in, and repeats (bounded by an
iteration cap and a per-tool timeout) until Groq gives a final answer —
exposed at the new `POST /agent/invoke`. The one deliberately non-trivial
decision this phase made: `create_incident` is a mutating tool, so per
`docs/architecture.md` §10 ("the agent can *propose* one but cannot
silently execute it") the AI-service executor intercepts it and returns a
`PROPOSED_NOT_EXECUTED` result without ever calling the real,
incident-writing backend endpoint — pinned down by a dedicated test that
asserts the real backend call never happened, not just that the response
looks right. **One honest caveat, in two parts, same shape as every prior
phase:** row 10's verification is "LLM calls a tool, tool hits real
backend data, result returned" — this repo's build sandbox has neither a
real MongoDB (so the backend's tool routes return a genuine `503`, not
data) nor Groq credentials reachable through its own egress proxy (so
`POST /agent/invoke` returns a clean, real "could not reach Groq: 403
Forbidden" — a real outbound attempt, genuinely blocked, not a mock).
Both halves of the wiring were verified for real as far as this sandbox
allows; the full "real answer, grounded in real seeded data" proof needs
your own machine with both a real MongoDB and a real `GROQ_API_KEY`. See
`backend/README.md` and `ai-service/README.md`'s Phase 10 sections for
the exact commands and the full design-decision writeups.

**Phase 11 complete:** the AI service can now turn text into vectors and
store/search them in a real vector database — the two building blocks
Phase 12 (RAG ingestion) and Phase 13 (RAG orchestration) both need, built
independently of them. `ai-service/app/rag/embedding.py` embeds real text
via a local, ONNX-based model (`BAAI/bge-small-en-v1.5`, 384 dimensions,
via [fastembed](https://github.com/qdrant/fastembed) — no PyTorch, no
paid embedding API, no GPU required) — this resolves `docs/env-vars.md`'s
`EMBEDDING_MODEL` "TBD — Phase 11" placeholder. `app/rag/qdrant_client.py`
is a thin wrapper around the real Qdrant client, always talking to a real
Qdrant instance at `QDRANT_URL` in application code (the same
"real dependency, never faked" rule Mongo/Redis/Kafka already follow) —
`ensure_collection()`, `upsert_points()`, and `search()`. Deliberately not
in this phase: chunking any real `knowledge/` documents, a metadata
schema, or wiring either module into the agent loop — `docs/architecture.md`
§12 reserves chunk size/overlap/metadata decisions for Phase 12, "once
real runbook/incident documents exist to chunk," and deciding *when* to
retrieve at all is Phase 13's job. **One honest caveat:** row 11's
verification is "Embed → upsert → search round-trip verified" — this
repo's build sandbox can reach neither `huggingface.co` (the embedding
model's one-time weight download) nor any Qdrant instance (no Docker per
this project's rules, and both a prebuilt-binary download and a
package-registry install returned `403` through this sandbox's own egress
proxy when checked directly) — the same kind of organization-policy block
Phase 3/5/9 already hit for MongoDB/Kafka/Groq. Every piece of this
phase's logic that doesn't need those two things — batching, caching,
error normalization, and a real (not mocked) connection-refused proof
against a dead port, the same technique Phase 5's Kafka negative test
uses — is verified here for real: 50 passed, 4 skipped, all for confirmed
reasons, no failures. See `ai-service/README.md`'s Phase 11 section for
the exact commands to complete the real round-trip proof on your machine.

See `docs/phases.md` for what Phase 12 onward will add, and
`backend/README.md` / `ai-service/README.md` for how to run, seed, and
verify what exists so far — including exactly which parts of each phase
could be verified in the sandbox this was built in, and which need your
own machine (Kafka's broker, MongoDB's live data, a real Groq API key,
and now a real Qdrant instance, in particular — Phase 7's engine, by
contrast, needed no external infrastructure at all to verify).

## Local development prerequisites

These will be needed starting in later phases (nothing below is required to
work with the repository as it exists after Phase 1):

- Node.js 22 LTS and npm (Node 20 reached end-of-life in April 2026)
- Python 3.11+
- MongoDB 7.x running locally (`mongodb://localhost:27017`)
- Redis 7.x running locally (`redis://localhost:6379`)
- Apache Kafka (with Zookeeper or KRaft) running locally, e.g. via the official binary distribution
- Qdrant running locally (binary or local server)
- A Groq API key (https://console.groq.com)

No Docker and no Kubernetes are used in this project — every dependency
above runs as a plain local process/service. This is a deliberate choice
(see `docs/architecture.md`) so that each moving part is understood in
isolation before any orchestration layer is introduced.
