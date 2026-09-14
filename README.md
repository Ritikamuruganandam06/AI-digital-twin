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

**Phase 12 complete:** the knowledge base is now real, and there's a
working chunking → embedding → Qdrant ingestion pipeline plus a retriever
on top of it. `knowledge/` holds 7 substantive markdown documents across
architecture/runbooks/incidents/troubleshooting — specific, internally
consistent content about this project's own modeled 5-service topology,
not placeholder text (see `knowledge/README.md`). `ai-service/app/rag/loader.py`
parses each document's frontmatter; `chunker.py` splits it into
overlapping chunks (`CHUNK_SIZE_CHARS=1000`/`CHUNK_OVERLAP_CHARS=150`,
justified in the module's own docstring against these documents' real
shape — resolving `docs/architecture.md` §12's "chosen and justified
concretely in Phase 12" requirement); `ingest.py` ties loader, chunker,
and Phase 11's embedding/Qdrant modules together
(`python -m app.rag.ingest`); and `retriever.py`'s `retrieve(question)`
is the actual "retriever" deliverable, applying a relevance-score filter
before returning chunks. Deliberately not in this phase: wiring any of
this into the agent loop or a new HTTP endpoint — deciding *when* to
retrieve is Phase 13's job. **One honest caveat:** row 12's verification
is "Question → relevant chunks retrieved" — the chunking half of that is
fully verified here, for real, against the actual 7 documents (no network
needed); the embedding+Qdrant half is not, for the same reasons as Phase
11 (`huggingface.co` and Qdrant both unreachable from this sandbox,
confirmed directly, not assumed). One real bug surfaced and fixed during
this phase: the chunker's overlap logic could push a chunk past its size
cap when a full-size paragraph followed a full chunk — caught by a test
running against the real documents, not a synthetic edge case. 70 passed,
5 skipped, all for confirmed reasons, no failures.

**Phase 13 complete:** the agent loop can now use tools, RAG, both, or
neither, per question — and the entire "decision logic"
`docs/phases.md` row 13 asks for lives in one place: `search_knowledge_base`
(Phase 12's retriever) is offered to Groq as one more tool alongside the
18 backend tools from Phase 10, under a new
`PrivilegeTier.KNOWLEDGE_RETRIEVAL`, and `ai-service/app/agent/loop.py`'s
system prompt teaches it when each kind is warranted — exactly what
`docs/architecture.md` §14 specified back in Phase 1 ("made by the LLM
itself via the tool-calling interface ... rather than a separate
hardcoded classifier"). There is deliberately no classifier function
anywhere in this codebase. Unlike every other tool, `search_knowledge_base`
never reaches the Node backend — `ai-service/app/tools/executor.py` calls
`app/rag/retriever.py` in-process instead, since RAG has always been the
AI service's own responsibility (§2, §15). Each step in the agent's
response now also carries `is_rag_query`, so which kind of tool the agent
used is visible per step without needing a persisted trace (Phase 14).
**One honest caveat, the same shape as every prior phase:** row 13's
verification is "Test matrix of question types produces correct tool/RAG
usage" — since the decision itself is made by Groq, not this codebase,
and Groq is unreachable here (same `api.groq.com` block as every prior
phase), `ai-service/tests/test_agent_orchestration.py`'s five tests (one
per row of §14's decision table) mock only Groq's decision and let the
real, unmocked dispatcher underneath prove the *routing* is correct —
backend tools reach the backend, `search_knowledge_base` reaches the
retriever and never the backend. Whether a real Llama model actually
makes these same five decisions is what
`test_agent_orchestration_live.py` checks for real, gated on Groq +
backend + Qdrant + `huggingface.co` all being reachable at once — none of
which this sandbox has, so it's expected to skip here too. 86 tests, 80
passed, 6 skipped, all for confirmed reasons, no failures. See
`ai-service/README.md`'s Phase 13 section for the exact commands and full
design-decision writeups.

**Phase 14 complete:** every agent invocation is now a persisted record,
retrievable via API — `docs/phases.md` row 14's "Agent Execution Trace."
This is the first backend work since Phase 10, and the first code
anywhere in this project that calls *from* the backend *to* the AI
service: `backend/src/clients/aiServiceClient.ts` (`AI_SERVICE_URL` had
sat unused in `.env` since Phase 1) is the mirror image of Phase 8's
`backend_client.py`, calling a real `POST /agent/invoke`. The new `POST
/api/assistant/ask` is `docs/architecture.md` §3's sequence diagram made
real: it calls the AI service, maps its response onto a new
`agentexecutions` MongoDB collection (`status` derived from
`stopped_reason` — completed/incomplete/error — and `retrievedDocuments`
denormalized out of any RAG steps), and persists it; `GET
/api/executions` and `GET /api/executions/:id` are the "retrievable via
API" half. On the AI-service side, Phase 13's `ToolCallStep` gained a
real per-step `timestamp`, captured the moment each tool call completes,
so the backend's trace never has to invent timing data.  **One honest
caveat, in three parts:** the pure transformation logic (status mapping,
RAG-result extraction, timestamp parsing, HTTP-layer validation) is fully
verified here for real — 27/27 passing, no database needed; the real
MongoDB persist-then-read-back round trip needs the same
`mongodb-memory-server` binary download blocked in this sandbox since
Phase 3; and the fully-live version (real MongoDB + a real running AI
service, no mocking at all) needs both running together, which this
sandbox has neither of — notably, it does *not* additionally need a real
`GROQ_API_KEY`, since even a real `groq_error` execution is a real,
correctly-persistable trace. See `backend/README.md`'s Phase 14 section
for the exact commands and full design-decision writeups.

**Phase 15 complete:** the platform now has real authentication and
authorization — `docs/phases.md` row 15's "JWT, RBAC
(USER/OPERATOR/ADMIN)." A new `users` collection
(`backend/src/models/user.model.ts`) backs `POST /api/auth/register` and
`POST /api/auth/login` (`backend/src/services/auth.service.ts`): real
bcrypt password hashing (never stores plaintext), real JWT issuance
(`backend/src/utils/jwt.ts`) carrying the user's id/email/role. Every
other `/api/*` route is now wired explicitly, per route, behind a new
`authenticate` middleware in `backend/src/app.ts` — stateless (no
database lookup per request, just signature + expiry verification) — and
`POST /api/incidents` additionally requires `authorize('OPERATOR')`, a
rank-based check (`USER < OPERATOR < ADMIN`) that a plain `USER` token
now genuinely gets rejected by with a real `403`, not just a documented
intent. `POST /api/assistant/ask` finally populates
`agentexecutions.userId` (left optional since Phase 14, explicitly
waiting on this phase) from the real authenticated caller.
`/api/auth/*` itself stays unauthenticated (you can't need a token to get
one), and `/internal/tools/*` deliberately stays outside this middleware
too — it's a separate service-to-service trust boundary between the AI
service and the backend (`docs/architecture.md` §15), not user-facing
RBAC. `npm run seed` now also creates 3 fixed demo accounts, one per
role, so USER/OPERATOR/ADMIN behavior can be exercised by hand. **One
honest note, not really a caveat this time:** unlike every prior phase,
this one needed almost no external infrastructure to verify for real —
bcrypt and JWT are pure libraries, not services to reach over a network —
so 26 of this phase's tests pass in this sandbox with no database at all;
only the full real-MongoDB round trip
(`backend/tests/auth.integration.test.ts`) hits the same
`mongodb-memory-server` binary-download block every other
`*.integration.test.ts` file in this repo has hit since Phase 3. See
`backend/README.md`'s Phase 15 section for the exact commands (including
the RBAC-rejection proof by hand) and full design-decision writeups.

**Phase 16 complete:** reliability patterns — `docs/phases.md` row 16's
"Timeouts, retries, circuit breaker, rate limiting, idempotency, DLQ, AI
iteration/timeout limits" — added only where an audit found a genuine
gap, per `docs/architecture.md` §17's own "not speculatively" rule.
Connection timeouts, Redis's bounded retry-with-backoff, Kafka's
idempotent producer and DLQ republish path, and the AI service's agent
iteration/tool-timeout limits were all already real; what was missing —
retry-with-backoff for cross-service HTTP calls, a circuit breaker, rate
limiting, idempotency, and an automated DLQ proof — is what this phase
adds. Two small, dependency-free, hand-implemented primitives
(`withRetry()` and a 3-state `CircuitBreaker`, `backend/src/utils/`) are
mirrored line-for-line in Python (`ai-service/app/utils/`) and wired into
every cross-service HTTP boundary that meets the bar: the backend's call
to the AI service, the AI service's calls to the backend's tool API, and
the AI service's calls to Groq — the last of which is the clearest case,
since `api.groq.com` is confirmed blocked in this very sandbox, making
the breaker's benefit directly observable rather than hypothetical. On
the backend, `RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX` — unused
`.env.example` entries since Phase 1 — are finally read by a Redis-backed
fixed-window limiter mounted on `/api/*` ahead of even `/api/auth` (so it
also guards login/register against brute force), and a new opt-in
`Idempotency-Key` middleware protects `POST /api/incidents` specifically
against duplicate submission on retry. Both new middleware fail open if
Redis is unreachable, the same posture the cache-aside layer already
established. **One honest note:** the two new primitives themselves need
no infrastructure at all and are fully, genuinely verified here (13/13
TypeScript, 13/13 Python, all isolated with fake timers/clocks); their
wiring into real HTTP clients is verified with the network boundary
mocked (same discipline every phase has used); the real, unmocked proofs
against Redis/MongoDB/Kafka (`rateLimiter.integration.test.ts`,
`idempotency.integration.test.ts`, the new
`kafka.dlq.integration.test.ts` failure-injection test) hit the exact
same three independent sandbox limitations every earlier phase already
documented (no local Redis, no `fastdl.mongodb.org` access, no reachable
Kafka broker) — not new limitations, the same ones, on new tests. See
`backend/README.md` and `ai-service/README.md`'s Phase 16 sections for
the exact commands and full design-decision writeups.

See `docs/phases.md` for what Phase 17 onward will add, and
`backend/README.md` / `ai-service/README.md` for how to run, seed, and
verify what exists so far — including exactly which parts of each phase
could be verified in the sandbox this was built in, and which need your
own machine (Kafka's broker, MongoDB's live data, a real Groq API key,
and a real Qdrant instance with normal internet access, in particular —
Phase 7's engine, most of Phase 15, and Phase 16's two new reliability
primitives, by contrast, needed no external infrastructure at all to
verify).

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
