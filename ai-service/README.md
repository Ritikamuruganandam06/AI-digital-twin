# ai-service

Python + FastAPI AI service. Eventually owns agent orchestration,
Groq/Llama interaction, tool-calling execution, and RAG (chunking,
embedding, Qdrant retrieval) — see `../docs/architecture.md` §2, §8, §15.
Talks to the backend only through its HTTP tool API — never directly to
MongoDB, Redis, or Kafka.

## Phase 16 status: Reliability patterns

Phase 15 (JWT auth + RBAC) was backend-only — nothing in this service
changed for it, see `backend/README.md`. Phase 16 (docs/phases.md row 16;
docs/architecture.md §17) is the first phase to touch this service again
since Phase 14, and — same as the backend side — started with an audit,
not new code: `app/clients/backend_client.py`'s and
`app/tools/backend_tools_client.py`'s httpx timeouts
(`_REQUEST_TIMEOUT_SECONDS`), `app/llm/groq_client.py`'s timeout, and
`app/config.py`'s `agent_max_iterations`/`agent_tool_timeout_ms` (fully
wired into `app/agent/loop.py`'s `run_agent()` since Phase 10) were all
already real. Retry-with-backoff and a circuit breaker were not — this
phase adds both, as the Python-side mirror of
`backend/src/utils/retry.ts`/`backend/src/utils/circuitBreaker.ts`:

- `app/utils/retry.py`'s `with_retry()` — same narrow-by-default design
  as the TypeScript version: a caller passes `is_retryable` to say
  exactly which failures qualify for a retry; nothing is retried unless
  explicitly approved. Proven correct in complete isolation
  (`tests/test_retry.py`, 6 tests, `asyncio.sleep` patched so backoff
  timing is asserted precisely without actually waiting).
- `app/utils/circuit_breaker.py`'s `CircuitBreaker` — the same
  hand-implemented CLOSED→OPEN→HALF_OPEN→CLOSED state machine as the
  TypeScript version, `time.monotonic()`-based. Proven correct in
  complete isolation (`tests/test_circuit_breaker.py`, 7 tests,
  `time.monotonic` patched to a controllable fake clock).
- Both are wired into `app/tools/backend_tools_client.py`'s `_request()`
  (the single helper all 18 tool functions funnel through) and
  `app/llm/groq_client.py`'s `create_chat_completion()` — one retry for a
  genuine `httpx.ConnectError` only (never a timeout, never a non-2xx: a
  timeout would double an already-long wait competing with
  `AGENT_TOOL_TIMEOUT_MS`'s own budget, and a non-2xx means the
  dependency DID respond), wrapped in a circuit breaker (3 consecutive
  failures trips it, 30s cooldown). **Groq is the clearest, most concrete
  justification of the two breaker placements**: it is CONFIRMED
  blocked/unreachable in this sandbox (see "What could and couldn't be
  verified here" below), so this breaker directly improves this
  sandbox's own observed behavior, not a hypothetical one. Each wiring is
  proven with its own dedicated resilience test file
  (`tests/test_backend_tools_client_resilience.py`,
  `tests/test_groq_client_resilience.py`, 6 tests each) — distinct from
  the existing `test_backend_tools_client.py`/`test_groq_client.py`,
  which only cover request shape and basic failure normalization, not
  retry counts or breaker state transitions.

Additive and backward-compatible: every existing test in both files still
passes unchanged (`test_backend_tools_client.py` 7/7,
`test_groq_client.py` 11/11) — 106 tests passing total (up from 87),
same 6 skips as every phase since Phase 13, for the same confirmed
reasons. See `backend/README.md`'s Phase 16 section for the matching
Node-side work (`aiServiceClient.ts`'s retry+breaker, rate limiting,
idempotency, and the new Kafka DLQ failure-injection test) and "Design
decisions" below for why each threshold is a plain constant, not a new
env var.

<details>
<summary>Phase 14 status (agent execution trace persistence) — still accurate, collapsed for length</summary>

This phase's actual persistence work lives in `backend/README.md` (§16's
`agentexecutions` MongoDB collection, `POST /api/assistant/ask`, `GET
/api/executions[/:id]`) — per `docs/architecture.md` §15, this service
has no MongoDB client and never will. What changed here is small but
required: `docs/architecture.md` §16 asks for persisted steps "with
timestamps," and Phase 13's `ToolCallStep` didn't have one.

- `app/agent/loop.py`'s `ToolCallStep` gained a `timestamp: str` field,
  populated by a `default_factory` that captures
  `datetime.now(timezone.utc).isoformat()` at the exact moment each step
  is constructed — i.e. right after that step's real tool call returns.
  This is a genuine per-step capture time, not a value invented later by
  whichever backend endpoint eventually persists it.
- `app/api/agent.py`'s `ToolCallStepResponse` now includes `timestamp`, so
  it's part of `POST /agent/invoke`'s response body, not just an internal
  field.
- `tests/test_agent_loop.py::test_each_step_gets_a_real_timestamp_in_call_order`
  proves both properties that matter: every step's timestamp parses as a
  real ISO 8601 datetime, and across a multi-step run, timestamps are
  non-decreasing in the same order the steps actually ran in — Groq and
  the executor both mocked (same discipline as every other test in that
  file), but the timestamp capture itself is real code, not mocked.

Additive and backward-compatible: `timestamp` has a default, so every
existing direct `ToolCallStep(...)` construction (including in
`tests/test_agent_endpoint.py`) still works unchanged — 86 existing tests
still pass, plus this one new test, 87 total, same 6 skips as Phase 13
for the same confirmed reasons.

</details>

<details>
<summary>Phase 13 status (Agent + Tools + RAG orchestration) — still accurate, collapsed for length</summary>

Implemented now, on top of Phase 10's tool-calling loop and Phase 12's
retriever — this is the phase that finally connects them:

- **`search_knowledge_base` is now a tool**, added to
  `app/tools/schemas.py`'s `TOOL_DEFINITIONS` alongside the 18 backend
  tools from Phase 10, under a new `PrivilegeTier.KNOWLEDGE_RETRIEVAL`.
  This is the entire mechanism behind "Full decision logic (tools/RAG/
  both/neither)" (`docs/phases.md` row 13): there is **no separate
  classifier function anywhere in this codebase** that decides tool vs.
  RAG. Per `docs/architecture.md` §14, "this decision is made by the LLM
  itself via the tool-calling interface" — Groq is simply offered
  `search_knowledge_base` as one more tool among 19, and
  `app/agent/loop.py`'s `SYSTEM_PROMPT` is what teaches it when a
  question needs live/simulation data, documented guidance, both, or
  neither.
- `app/tools/executor.py`'s `_search_knowledge_base()` dispatches
  differently from every other tool: every other tool goes through
  `backend_tools_client` (an HTTP call to the Node backend, per
  `docs/architecture.md` §15's "AI service has no MongoDB/Redis/Kafka
  client"); `search_knowledge_base` calls `app/rag/retriever.retrieve()`
  **in-process**, since RAG has always been the AI service's own
  responsibility (§2, §13) and never crosses the backend boundary. It
  runs via `asyncio.to_thread` since `retrieve()` is a synchronous, local-
  embedding call, unlike every other (already-async, HTTP-bound) tool
  handler. `EmbeddingError`/`QdrantUnavailableError` are caught here the
  same way `BackendUnavailableError` already was — a failed knowledge
  search comes back as a structured `{"error": ...}` fed to the LLM, never
  a crash.
- `ToolCallStep` gained an `is_rag_query: bool` field (set from
  `get_tool_privilege(name) == PrivilegeTier.KNOWLEDGE_RETRIEVAL`), now
  also returned from `POST /agent/invoke` per step — enough to see, per
  step, whether the agent used a live/simulation tool or a knowledge-base
  search, without needing a persisted execution trace (still Phase 14's
  job).
- `SYSTEM_PROMPT` was rewritten to explicitly teach the two-kinds-of-tool
  distinction from `docs/architecture.md` §14's decision table (live/
  simulation tools for current-state and what-if questions;
  `search_knowledge_base` for recovery/troubleshooting guidance; both
  together for "X is down, what should I do?"-shaped questions; neither
  for the LLM's own general knowledge) — this prompt text is the actual
  "decision logic" the phase's deliverable refers to, not a code branch.

**Verification (`docs/phases.md` row 13: "Test matrix of question types
produces correct tool/RAG usage")** — `tests/test_agent_orchestration.py`
is one test per row of `docs/architecture.md` §14's table:

| Question | Decision | Test |
|---|---|---|
| "What is the current Payment Service latency?" | Tool only | `test_a_live_metrics_question_uses_a_tool_only_never_the_knowledge_base` |
| "What is the Payment Service recovery procedure?" | RAG only | `test_a_recovery_procedure_question_uses_rag_only_never_a_backend_tool` |
| "Payment Service is down. What should I do?" | Tool + RAG | `test_an_active_incident_question_uses_both_a_tool_and_rag_in_the_same_run` |
| "What happens if Payment Service fails?" | Simulation tool | `test_a_what_if_question_uses_the_deterministic_simulation_tool_not_rag` |
| "Explain what a circuit breaker is." | Neither | `test_a_general_knowledge_question_uses_neither_tools_nor_rag` |

**One honest, important caveat about what these tests actually prove:**
`docs/architecture.md` §14 is explicit the tool-vs-RAG decision is made
*by the LLM itself* — there is no decision function in this codebase to
unit-test directly, and Groq is unreachable in this build sandbox (no
credentials, same as every prior phase). So each test above mocks
`create_chat_completion` to return the decision a competent LLM *would*
make for that question (standing in for the real thing) and then lets
the real, unmocked `execute_tool_call()` dispatcher run — only its two
leaf dependencies (`tools_client`'s backend calls, and the RAG retriever)
are mocked at the boundary this sandbox can't reach. What's proven for
real: when Groq decides to call a given tool, it is routed correctly —
backend tools reach `tools_client`, `search_knowledge_base` reaches the
retriever directly and never touches the backend, and a "neither"
question makes zero tool calls. What's *not* proven here — because it
can't be, without real Groq access — is that Groq itself would make
these particular decisions for these particular questions.
`tests/test_agent_orchestration_live.py` is the real version of this
proof (a genuine Groq call deciding for itself, against a real backend
and real Qdrant instance, ingesting the knowledge base first) — gated on
all four of `GROQ_API_KEY` + backend + Qdrant + `huggingface.co` being
reachable, and expected to skip here for the same reasons every other
live test in this project does. Run it on your machine to see a real LLM
make this call.

Deliberately **not** in this phase: persisting the execution trace to
MongoDB (`docs/architecture.md` §16, `agentexecutions` collection) — that
was Phase 14's job (done in `backend/`, see this file's Phase 14 section
above); `is_rag_query` is returned in the HTTP response precisely so
Phase 14's trace-writer has it without recomputing anything. No changes
to `docs/architecture.md` were needed — §14's decision table and "via the
tool-calling interface" description already specified exactly this
design when it was written in Phase 1.

</details>

<details>
<summary>Phase 12 status (RAG ingestion and retrieval) — still accurate, collapsed for length</summary>

Implemented then, on top of Phase 11's embedding pipeline and Qdrant
client:

- **`../knowledge/` is now real** — 7 markdown documents across
  architecture/runbooks/incidents/troubleshooting (`system-architecture.md`,
  `payment-service-recovery.md`, `redis-failure-runbook.md`,
  `kafka-consumer-recovery.md`, `incident-payment-outage.md`,
  `high-latency-troubleshooting.md`, `high-error-rate-troubleshooting.md`),
  each with a small frontmatter block (`title`/`related_service`/`updated`)
  and real, specific content about *this* project's own modeled system —
  not generic placeholder text. See `../knowledge/README.md`.
- `app/rag/loader.py` — parses a document's frontmatter and derives
  `document_id`/`source_path`/`document_type` from its path (the folder
  a document lives in IS its type — never an independent frontmatter
  value that could disagree with it).
- `app/rag/chunker.py` — splits a document's body into overlapping
  chunks, attaching the full metadata schema docs/architecture.md §12
  calls for (document id, chunk id, source path, document type, related
  service, version/timestamp). `CHUNK_SIZE_CHARS=1000` /
  `CHUNK_OVERLAP_CHARS=150`, justified in the module's own docstring
  against this knowledge base's actual document shape (see "Design
  decisions" below for the summary).
- `app/rag/ingest.py` — `ingest_knowledge_base(knowledge_root)`: loads
  every document, chunks it, embeds every chunk (Phase 11's
  `embed_texts()`), and upserts them into Qdrant (Phase 11's
  `ensure_collection()`/`upsert_points()`) with a deterministic point id
  per chunk, so re-running ingestion after editing a document updates its
  points in place rather than duplicating them. Runnable directly:
  `python -m app.rag.ingest`.
- `app/rag/retriever.py` — `retrieve(question, top_k, score_threshold)`:
  docs/phases.md row 12's actual "retriever" deliverable. Embeds the
  question, searches Qdrant, and drops anything scoring below
  `DEFAULT_SCORE_THRESHOLD` (0.5) before returning — "no relevant
  knowledge found" is a normal return value (an empty list), not an
  error.

A real chunker bug was found and fixed this phase via testing against the
real knowledge base, not a synthetic edge case — see the Phase 12 design
decisions further down for the full story.

</details>

<details>
<summary>Phase 11 status (Qdrant + embedding model) — still accurate, collapsed for length</summary>

Implemented then, alongside (not on top of) Phase 10's agent loop — these
are independent, not sequential dependencies:

- `app/rag/embedding.py` — turns text into vectors. Uses
  [fastembed](https://github.com/qdrant/fastembed) (ONNX-based, no
  PyTorch) rather than `sentence-transformers` or a paid embedding API;
  `embed_text(text)`/`embed_texts(texts)` embed real strings with the
  model named by `EMBEDDING_MODEL` (default `BAAI/bge-small-en-v1.5`, 384
  dimensions), and `get_embedding_dimension()` returns that model's known
  vector size. Every model load and embed failure normalizes into one
  `EmbeddingError`.
- `app/rag/qdrant_client.py` — a thin wrapper around the real
  `qdrant-client` library, talking to a real Qdrant instance at
  `QDRANT_URL` (never an in-memory/local-mode stand-in in application
  code — same "real dependency, never faked" rule as Mongo/Redis/Kafka).
  `ensure_collection(vector_size)` is idempotent (creates the
  `QDRANT_COLLECTION` collection only if missing, cosine distance);
  `upsert_points(points)` and `search(query_vector, top_k)` do exactly
  what their names say. Every failure normalizes into one
  `QdrantUnavailableError`, the same pattern `backend_client.py` and
  `groq_client.py` already established for their own dependencies.

Deliberately **not** in this phase (`docs/phases.md` row 11's scope is
"Qdrant client, embedding pipeline" — nothing more): no chunking of
`knowledge/` documents, no metadata schema, and nothing wired into the
agent loop or a new HTTP endpoint. `docs/architecture.md` §12 is explicit
that chunk size/overlap/metadata are "chosen and justified concretely in
Phase 12, once real runbook/incident documents exist to chunk" — picking
them now, against no real documents, would be exactly the kind of
premature design this project avoids. Deciding *when* to retrieve at all
is Phase 13's job ("Agent + Tools + RAG orchestration").

</details>

<details>
<summary>Phase 10 status (agent tool calling) — still accurate, collapsed for length</summary>

Implemented then, on top of Phase 9's Groq client:

- `app/tools/schemas.py` — `TOOL_DEFINITIONS`, one entry per backend tool
  (18 total), each with an OpenAI/Groq-compatible JSON-schema
  `{name, description, parameters}`; `TOOL_SCHEMAS` is what actually gets
  sent to Groq's `tools` param, and `TOOL_PRIVILEGE` maps each tool name
  to a `PrivilegeTier` (`READ_ONLY`, `SIMULATION`, `PRIVILEGED_SAFE`,
  `PRIVILEGED_MUTATING`) per `docs/architecture.md` §10.
- `app/tools/backend_tools_client.py` — one async function per tool, each
  a plain `httpx` call to the matching `backend/src/tools/*` route (Phase
  10's other half); raises `BackendUnavailableError` the same way
  `app/clients/backend_client.py` already does.
- `app/tools/executor.py` — `execute_tool_call(name, arguments)`: looks up
  the tool, calls its backend-client function, and **never raises** — a
  bad tool name, a missing argument, or a backend failure all become a
  structured `{"error": "..."}"` dict instead of an exception, so one bad
  tool call can't crash the agent loop. This is also where the one
  non-trivial Phase 10 decision lives: `create_incident` is
  `PRIVILEGED_MUTATING`, and the executor's dispatch table for it
  (`_propose_create_incident`) never calls the real backend endpoint at
  all — it returns `{"status": "PROPOSED_NOT_EXECUTED", "proposedIncident": {...}}`
  instead, regardless of what arguments the LLM supplies. `recommend_scaling`
  (`PRIVILEGED_SAFE`) executes for real, since it only returns a
  recommendation and mutates nothing.
- `app/agent/loop.py` — `run_agent(question)`: the actual tool-calling
  loop. Sends the conversation (plus `TOOL_SCHEMAS`) to Groq, and for as
  long as Groq keeps asking for tool calls (up to `AGENT_MAX_ITERATIONS`,
  default 6), executes each one via `execute_tool_call` (each capped at
  `AGENT_TOOL_TIMEOUT_MS`, default 10000ms) and feeds the real result back
  in as a `role: "tool"` message, until Groq returns a plain answer instead
  of more tool calls, or the iteration cap is hit. Reuses
  `get_chat_reply()`'s content-vs-`reasoning` fallback (Phase 9's bug fix)
  for the final answer, since the same GPT-OSS reasoning-model behavior
  applies here too.
- `app/api/agent.py` — `POST /agent/invoke`: the one new HTTP endpoint,
  `{"question": "..."}` in, `{"answer", "steps", "iterations",
  "stopped_reason"}` out. `steps` is the full tool-call trace (tool name,
  arguments, real result) for this request — not persisted anywhere yet
  (that's Phase 14's job, `docs/architecture.md` §8 step 7/§16), just
  returned in the response.
- `app/llm/groq_client.py` — `create_chat_completion()` extended with
  optional `tools`/`tool_choice` params (only added to the request payload
  when provided, so every Phase 9 call site and test is unaffected);
  `get_chat_reply()` itself is completely unchanged.

Deliberately **not** in this phase (`docs/phases.md` row 10's scope is
"tool schemas + tool execution loop against backend tool API" — nothing
more): no RAG/retrieval (Phase 11-12), no persisted execution trace
(Phase 14), no streaming responses, and no frontend. RAG's own row (11)
is explicit that the agent's *tool-calling* ability comes first,
grounding-via-retrieval second — this phase is exactly that ordering.

<details>
<summary>Phase 9 status (Groq + Llama integration) — still accurate, collapsed for length</summary>

Implemented then, on top of Phase 8's skeleton:

- `app/llm/groq_client.py` — the only code in this service that talks to
  Groq. `create_chat_completion(messages, ...)` sends an OpenAI-style
  `messages` list to Groq's Chat Completions endpoint and returns the
  parsed response; `get_chat_reply(messages, ...)` is a convenience
  wrapper that returns just the assistant's reply text.
- The model is configurable via `LLM_MODEL` (default
  `llama-3.3-70b-versatile`, Groq's current production Llama model as of
  this phase), never hardcoded elsewhere (`docs/architecture.md` §9).
  `LLM_PROVIDER` is read too (`groq`), making the provider explicit even
  though only one is implemented.
- `GROQ_API_KEY` is read from env only, never hardcoded, and the client
  refuses to make a request (raising `GroqConfigError` before touching
  the network) if it's missing or empty.
- Every non-2xx response and every network failure is normalized into a
  single `GroqClientError`, the same pattern `backend_client.py`
  established in Phase 8.

Deliberately **not** in this phase (`docs/phases.md` row 9's scope is
"Groq client, configurable model, basic chat completion" — nothing more):
no tool schemas offered to Groq, no tool-calling loop, no RAG, no agent
orchestration, no new HTTP endpoint on this service, and no persisted
execution trace. `groq_client.py` is not imported or called from
anywhere else yet — Phase 10 is what wires it into the agent loop against
`app/api`/`app/tools`/`app/agent`.

</details>

</details>

## Structure (through Phase 16)

```
ai-service/
├── app/
│   ├── main.py              FastAPI app instance, entrypoint; Phase 10 adds agent_router
│   ├── config.py            env var loading (ENV, PORT, BACKEND_BASE_URL, LOG_LEVEL,
│   │                        LLM_PROVIDER, LLM_MODEL, GROQ_API_KEY, AGENT_MAX_ITERATIONS,
│   │                        AGENT_TOOL_TIMEOUT_MS, QDRANT_URL, QDRANT_COLLECTION, EMBEDDING_MODEL)
│   ├── api/
│   │   ├── health.py        GET /health
│   │   ├── backend_proxy.py GET /api/backend/services (Phase 8's boundary-proof endpoint)
│   │   └── agent.py         Phase 10 — POST /agent/invoke; Phase 13 adds is_rag_query, Phase 14 adds timestamp per step
│   ├── clients/
│   │   └── backend_client.py  the ONLY code that talks to the Node backend directly (Phase 8's boundary proof; NOT a tool); deliberately NOT given a Phase 16 circuit breaker — too lightly used to meet the bar
│   ├── llm/
│   │   └── groq_client.py     the ONLY code that talks to Groq (Phase 9; tools/tool_choice added in Phase 10); Phase 16 — wraps the request in with_retry() + a module-level CircuitBreaker
│   ├── utils/
│   │   ├── retry.py            Phase 16 — with_retry(): generic exponential-backoff retry, opt-in is_retryable predicate (Python mirror of backend/src/utils/retry.ts)
│   │   └── circuit_breaker.py  Phase 16 — CircuitBreaker: hand-implemented CLOSED->OPEN->HALF_OPEN->CLOSED state machine (Python mirror of backend/src/utils/circuitBreaker.ts)
│   ├── rag/                    wired into the agent loop as of Phase 13, via search_knowledge_base
│   │   ├── embedding.py        Phase 11 — embed_text()/embed_texts() via fastembed, get_embedding_dimension()
│   │   ├── qdrant_client.py    Phase 11 — ensure_collection()/upsert_points()/search() against a real Qdrant instance
│   │   ├── loader.py           Phase 12 — parses knowledge/*.md frontmatter, derives metadata from path
│   │   ├── chunker.py          Phase 12 — chunk_document(): CHUNK_SIZE_CHARS=1000 / CHUNK_OVERLAP_CHARS=150
│   │   ├── ingest.py           Phase 12 — ingest_knowledge_base(): loader -> chunker -> embed -> upsert; `python -m app.rag.ingest`
│   │   └── retriever.py        Phase 12 — retrieve(): embed question -> search -> relevance-filter -> chunks; called directly by executor.py as of Phase 13
│   ├── tools/                  Phase 10; Phase 13 adds search_knowledge_base
│   │   ├── schemas.py          TOOL_DEFINITIONS / TOOL_SCHEMAS / TOOL_PRIVILEGE (19 tools, 5 privilege tiers)
│   │   ├── backend_tools_client.py   one async function per backend tool -> backend/src/tools/* route (search_knowledge_base is NOT here -- it never calls the backend); Phase 16 — _request() wraps every call in with_retry() + a shared CircuitBreaker
│   │   └── executor.py         execute_tool_call() — dispatch + privilege enforcement, never raises; search_knowledge_base calls app/rag/retriever.py directly
│   └── agent/                  Phase 10; Phase 13 rewrites SYSTEM_PROMPT for tool/RAG decision logic
│       └── loop.py             run_agent() — the tool-calling loop (iteration cap, per-tool timeout); ToolCallStep.is_rag_query added Phase 13, .timestamp added Phase 14
├── tests/
│   ├── test_health.py
│   ├── test_backend_client.py           unit tests, httpx mocked
│   ├── test_backend_boundary_route.py   route tests, backend_client mocked
│   ├── test_groq_client.py              unit tests, httpx mocked (always run)
│   ├── test_groq_client_live.py         REAL Groq call — skipped unless GROQ_API_KEY is set
│   ├── test_backend_tools_client.py     Phase 10 — unit tests, httpx mocked
│   ├── test_executor.py                 Phase 10 — dispatch + privilege-enforcement; Phase 13 adds search_knowledge_base dispatch + error-handling tests
│   ├── test_agent_loop.py               Phase 10 — control-flow tests, Groq + executor both mocked; Phase 14 adds the real per-step timestamp test
│   ├── test_agent_endpoint.py           Phase 10 — HTTP layer only, run_agent mocked
│   ├── test_agent_live.py               Phase 10 — REAL end-to-end: real Groq + real backend, both required
│   ├── test_embedding.py                Phase 11 — mostly mocked (always run) + one REAL, unmocked semantic-similarity proof
│   ├── test_qdrant_client.py            Phase 11 — a REAL negative-connection proof (always run) + a REAL embed->upsert->search proof (needs real Qdrant)
│   ├── test_loader.py                   Phase 12 — REAL, against the actual knowledge/ documents (always run, no network needed)
│   ├── test_chunker.py                  Phase 12 — REAL, against the actual knowledge/ documents (always run, no network needed)
│   ├── test_ingest.py                   Phase 12 — orchestration logic, embedding/Qdrant mocked (always run)
│   ├── test_retriever.py                Phase 12 — score-filtering logic, embedding/Qdrant mocked (always run)
│   ├── test_rag_live.py                 Phase 12 — THE real "question -> relevant chunks" proof (needs real Qdrant + model download)
│   ├── test_agent_orchestration.py      Phase 13 — THE test matrix: one test per docs/architecture.md §14 decision-table row, Groq mocked, executor real
│   ├── test_agent_orchestration_live.py Phase 13 — REAL end-to-end: real Groq decides tool vs RAG vs both itself (needs Groq + backend + Qdrant + HF, all four)
│   ├── test_retry.py                          Phase 16 — with_retry(), asyncio.sleep patched, no I/O needed
│   ├── test_circuit_breaker.py                Phase 16 — CircuitBreaker's full state machine, time.monotonic patched, no I/O needed
│   ├── test_backend_tools_client_resilience.py Phase 16 — _request()'s actual retry+breaker wiring, httpx mocked, module reloaded per test for a fresh breaker
│   └── test_groq_client_resilience.py          Phase 16 — create_chat_completion()'s actual retry+breaker wiring, httpx mocked, module reloaded per test for a fresh breaker
├── requirements.txt
├── pytest.ini
└── .env.example
```

`../knowledge/` (7 real markdown documents, Phase 12) is the other half
of this phase's file tree — see `../knowledge/README.md`.

## Install

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Then edit `.env` and set a real `GROQ_API_KEY` from
https://console.groq.com if you want to run the live Groq test or call
the client for real — the placeholder value in `.env.example` will make
every real call fail with a 401, on purpose (never commit a real key).

## Run

Requires the Node backend running first (`cd ../backend && npm start`, or
`npm run dev` — see `../backend/README.md`), since `/api/backend/services`
(Phase 8) still calls it.

```bash
cd ai-service
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Verify

Phase 8's endpoints verify the same way as before (see the Phase 8
section below). Phase 9 has no new HTTP endpoint — `docs/phases.md`'s
verification for that phase is a test, not an HTTP proof. To verify the
Groq client directly without pytest:

```bash
cd ai-service
source .venv/bin/activate
python3 -c "
import asyncio
from app.llm.groq_client import get_chat_reply

async def main():
    reply = await get_chat_reply([{'role': 'user', 'content': 'Reply with exactly: pong'}])
    print(reply)

asyncio.run(main())
"
```

This requires a real `GROQ_API_KEY` in `.env` (loaded by whatever process
manager sources it, or exported in your shell) — without one it raises
`GroqConfigError` immediately, without attempting a network call.

Phase 10 finally has an assistant-facing endpoint — `docs/phases.md` row
10's verification is "LLM calls a tool, tool hits real backend data,
result returned":

```bash
# with both the Node backend (port 4000, ideally after `npm run seed`)
# and this service (port 8000) running, and a real GROQ_API_KEY in .env:
curl -s -X POST http://localhost:8000/agent/invoke \
  -H "Content-Type: application/json" \
  -d '{"question": "How many services are currently in the system, and are any of them unhealthy?"}' | json_pp
```

With a real key and a seeded backend, expect `steps` to contain at least
one real `get_services`/`get_current_system_state` call whose `result`
matches the seeded topology, and `answer` to describe it in prose. This
repo's build sandbox has neither (no Groq credentials, and this sandbox's
own egress proxy blocks `api.groq.com` outright — see "What could and
couldn't be verified here"), so the same command there returns a clean
200 explaining exactly that instead of a crash:

```json
{"answer":"The AI service could not reach Groq: Could not reach Groq at https://api.groq.com/openai/v1/chat/completions: 403 Forbidden","steps":[],"iterations":1,"stopped_reason":"groq_error"}
```

— which is itself proof the wiring is real: this is a genuine outbound
HTTPS attempt to Groq's real API, made from inside `run_agent()` through
`create_chat_completion()`, rejected only by this sandbox's own proxy
(the same pattern the Phase 9 dotenv-fix turn established). With no
`GROQ_API_KEY` configured at all, the same endpoint fails even earlier,
before any network call, with `"The AI service is not configured to call
Groq: GROQ_API_KEY is not set..."` — both are HTTP 200, not a 500, because
`run_agent()` catches `GroqConfigError`/`GroqClientError` and returns them
as a normal (if unhelpful) answer rather than raising.

The real backend side of the same proof doesn't need Groq at all — every
`/internal/tools/*` route is a real HTTP endpoint on a real running
process:

```bash
curl -s http://localhost:4000/internal/tools/services | json_pp
curl -s http://localhost:4000/internal/tools/bottleneck | json_pp
```

In this sandbox (no MongoDB) both return a genuine `503 Database is
currently unavailable` from the real backend process — not a mock.

Phase 11 has no new HTTP endpoint either (same reasoning as Phase 9 — row
11's verification is "Embed -> upsert -> search round-trip verified", a
test-level proof, not an HTTP one). To see it directly without pytest:

```bash
cd ai-service
source .venv/bin/activate
python3 -c "
from app.rag.embedding import embed_texts, get_embedding_dimension
from app.rag import qdrant_client as qc

vectors = embed_texts(['Payment service is down.', 'Payment service outage.', 'Sunny weather in Paris.'])
print('dimension:', get_embedding_dimension(), 'vectors:', len(vectors))

qc.ensure_collection(vector_size=get_embedding_dimension())
qc.upsert_points([{'id': i, 'vector': v} for i, v in enumerate(vectors)])
print(qc.search(vectors[0], top_k=3))
"
```

The first call downloads `BAAI/bge-small-en-v1.5`'s weights once (needs
outbound access to `huggingface.co`); everything after requires a real
Qdrant instance reachable at `QDRANT_URL`. Neither is available in this
build sandbox — see "What could and couldn't be verified here."

Phase 12's verification is exactly `docs/phases.md` row 12's own wording:
"Question -> relevant chunks retrieved, with justified chunk size/overlap".
No new HTTP endpoint here either — this is still infrastructure/pipeline
work, not something a user or the agent calls directly yet (that's Phase
13). Ingest the real knowledge base, then ask real questions against it:

```bash
cd ai-service
source .venv/bin/activate
python -m app.rag.ingest
# Ingested 7 document(s) into 43 chunk(s) (collection created).

python3 -c "
from app.rag.retriever import retrieve

for chunk in retrieve('What should I do if payment-service is down?'):
    print(f'{chunk.score:.3f}  {chunk.document_id}  ({chunk.related_service})')
"
```

With a real Qdrant instance and the model downloaded, the top result
should be a chunk from `runbooks/payment-service-recovery`, scoring
noticeably higher than anything from an unrelated document — that's the
actual "relevant chunks retrieved" proof. Chunking itself (the other half
of this phase's verification — "justified chunk size/overlap") needs
neither Qdrant nor a network call and **is proven in this build sandbox**
right now:

```bash
python3 -c "
from pathlib import Path
from app.rag.loader import load_all_documents
from app.rag.chunker import chunk_document

for doc in load_all_documents(Path('../knowledge')):
    chunks = chunk_document(document_id=doc.document_id, source_path=doc.source_path,
        document_type=doc.document_type, related_service=doc.related_service,
        title=doc.title, updated=doc.updated, body=doc.body)
    print(f'{doc.source_path:50s} {len(chunks)} chunks')
"
```

Phase 13's verification (`docs/phases.md` row 13: "Test matrix of question
types produces correct tool/RAG usage") is primarily a test-suite proof —
see "Tests" below — but the same `POST /agent/invoke` endpoint from Phase
10 is now the one place all of it comes together:

```bash
# with the Node backend (port 4000, ideally seeded), this service (port
# 8000), a real GROQ_API_KEY, and an ingested Qdrant instance all running:
curl -s -X POST http://localhost:8000/agent/invoke \
  -H "Content-Type: application/json" \
  -d '{"question": "Payment service is down. What should I do?"}' | json_pp
```

With everything real, expect `steps` to contain both a live-state tool
call (e.g. `get_service`) with `is_rag_query: false` and a
`search_knowledge_base` call with `is_rag_query: true`, and `answer` to
combine both — current status plus the documented recovery procedure.
This build sandbox has none of the four preconditions (no Groq
credentials, no backend/Qdrant running, `huggingface.co` blocked), so the
same command here returns the same honest `groq_error` response Phase 10
already documented above — `search_knowledge_base` being offered to Groq
doesn't change that failure mode, since the request never gets past
reaching Groq at all in this sandbox.

## Tests

```bash
cd ai-service
source .venv/bin/activate
pytest -v
```

112 tests (Phase 16 adds 25: 6 in `test_retry.py`, 7 in
`test_circuit_breaker.py`, 6 in `test_backend_tools_client_resilience.py`,
6 in `test_groq_client_resilience.py`). Six require real, unmocked
network access this build sandbox doesn't have and are **automatically
skipped** here — the same 6 skips as every phase since Phase 13, 106
passed:

- `test_groq_client_live.py` — real Groq call; skipped, `GROQ_API_KEY` unset.
- `test_agent_live.py` — real Groq call that (if it decides to) makes a
  real HTTP call through `app/tools/backend_tools_client.py` to a
  really-running Node backend; skipped, both preconditions unmet.
- `test_embedding.py::test_embedding_model_produces_real_semantically_meaningful_vectors`
  — really loads `BAAI/bge-small-en-v1.5` and checks a real semantic-
  similarity property; skipped, `huggingface.co` unreachable through this
  sandbox's own egress proxy (confirmed with a real, rejected `httpx`
  request — see "What could and couldn't be verified here", not assumed).
- `test_qdrant_client.py::test_embed_upsert_search_round_trip_against_a_real_qdrant_instance`
  — the real embed -> upsert -> search proof `docs/phases.md` row 11
  asks for; skipped, no Qdrant instance reachable at `QDRANT_URL`.
- `test_rag_live.py::test_ingest_the_real_knowledge_base_then_retrieve_relevant_chunks_for_real_questions`
  — Phase 12's own "Question -> relevant chunks retrieved" proof, ingesting
  the real 7-document knowledge base and retrieving against it; skipped,
  same two preconditions as the Qdrant round-trip test.
- `test_agent_orchestration_live.py::test_a_real_agent_run_combines_a_live_tool_and_a_real_rag_search_for_one_question`
  — Phase 13's real end-to-end proof: a genuine Groq call that itself
  decides to use both a live tool and `search_knowledge_base` for one
  question, against a really-ingested Qdrant instance and a really-running
  backend; skipped, needs all four of Groq/backend/Qdrant/`huggingface.co`
  reachable at once, none of which this sandbox has.

Phase 16's four new test files need no real infrastructure at all and are
fully verified here: `test_retry.py` and `test_circuit_breaker.py` test
the two new primitives in complete isolation (no network, no mocking
needed — they have no I/O to fake), and
`test_backend_tools_client_resilience.py`/`test_groq_client_resilience.py`
prove the actual retry+breaker wiring in `_request()`/
`create_chat_completion()` with `httpx` mocked (retry-then-succeed,
retry-then-fail, no-retry-on-timeout, no-retry-on-non-2xx, breaker trips
and fails fast, a non-2xx never counts as a breaker failure) — the module
under test is reloaded per test (`importlib.reload`) so each test gets a
fresh circuit breaker instance rather than inheriting state left behind
by the previous one.

Everything else — including two fully REAL (not mocked, no network
needed) proofs against this project's actual `knowledge/` documents,
`test_loader.py::test_load_all_documents_against_the_real_knowledge_base`
and `test_chunker.py::test_chunking_the_real_knowledge_base_produces_sane_output`,
plus `test_qdrant_client.py::test_functions_raise_a_clean_error_when_qdrant_is_unreachable`
(a REAL connection-refused proof against `127.0.0.1:1`, the same
technique `backend/tests/kafka.negative.test.ts` uses for Kafka), plus
Phase 13's own `test_agent_orchestration.py` (the test matrix — Groq
mocked with the decision a competent LLM would make per question, but
the actual `execute_tool_call()` dispatcher underneath runs for real,
only its `tools_client`/RAG-retriever leaf calls mocked) — mocks only its
actual external network boundary (`httpx`/Groq/the tool executor/the
embedding model/Qdrant, as appropriate) and needs no real credentials or
running services; all pass in this sandbox. None of the 6 skipped tests'
proofs has been run for real by pytest itself here — the manual commands
under "Verify" above substitute for that, following the same deferral
pattern Phase 5 used for the Kafka broker. Set a real `GROQ_API_KEY`,
start the Node backend, and start a real Qdrant instance with normal
internet access, then re-run `pytest -v` to get all six proofs from
pytest itself on your machine.

## What could and couldn't be verified here

This build sandbox blocks outbound HTTPS to several hosts by organization
policy — the same kind of limitation `backend/README.md` documents for
`fastdl.mongodb.org` (Phase 3) and the Apache Kafka distribution hosts
(Phase 5):

- `api.groq.com` — confirmed blocked (Phase 9's live-test-fix turn: a real
  `httpx.ProxyError: 403 Forbidden` from a genuine outbound attempt).
- `huggingface.co` — confirmed blocked the same way this phase, both by
  `test_embedding.py`'s own reachability check and by a direct attempt to
  load `BAAI/bge-small-en-v1.5`, which fails with the identical
  `httpx.ProxyError: 403 Forbidden`.
- No real Qdrant instance is reachable at `QDRANT_URL` in this sandbox
  either — there's no Docker (project rule), no Qdrant `apt` package, and
  both a prebuilt-binary download (GitHub releases) and a package-registry
  install path returned `403` through this sandbox's own egress proxy when
  checked directly.

What's actually been verified here, versus what needs your machine:

- **Phase 9/10 (Groq, tool-calling):** see their own sections above and
  `backend/README.md`'s Phase 10 write-up — unchanged by this phase.
- **Phase 11 — `app/rag/embedding.py`'s logic (batching, caching, error
  normalization, the known-dimension table) is fully verified here**,
  mocked at the model boundary the same way `test_groq_client.py` mocks
  `httpx` — 7/7 passing. **The model itself producing real, semantically
  meaningful vectors is not verified here** — `huggingface.co` is
  blocked, confirmed above, not assumed. Run
  `pytest tests/test_embedding.py` on a machine with normal internet
  access to get that proof; the one-time download is small (~130MB).
- **Phase 11 — `app/rag/qdrant_client.py`'s error-handling is fully
  verified here for real**, against a real dead port (`127.0.0.1:1`), not
  a mock — the exact same technique `kafka.negative.test.ts` uses. **The
  real embed -> upsert -> search round trip docs/phases.md row 11 asks
  for is not verified here** — no Qdrant instance reachable, confirmed
  above. Start a real Qdrant (binary or local server — see the root
  README's prerequisites; no Docker) at `QDRANT_URL` and run
  `pytest tests/test_qdrant_client.py` to complete this proof on your
  machine.
- **Phase 12 — the entire knowledge/loader/chunker pipeline is fully
  verified here, for real, against this project's actual 7 documents** —
  `test_loader.py` and `test_chunker.py`'s real-knowledge-base tests need
  neither Qdrant nor a network call, and pass in this sandbox exactly as
  they would anywhere else. **The embedding + Qdrant half — actually
  ingesting those chunks and retrieving them for a real question — is not
  verified here**, for the same two reasons as Phase 11 (`huggingface.co`
  and Qdrant both unreachable, confirmed above). Start a real Qdrant
  instance with normal internet access and run `pytest tests/test_rag_live.py`
  (or `python -m app.rag.ingest` plus the `python3 -c` snippet under
  "Verify") to get docs/phases.md row 12's actual "Question -> relevant
  chunks retrieved" proof on your machine.
- **Phase 13 — the tool/RAG dispatch mechanics are fully verified here,
  for real:** `test_agent_orchestration.py`'s five tests exercise the
  real, unmocked `execute_tool_call()` for every row of
  `docs/architecture.md` §14's decision table, proving that when a tool
  call happens, it's routed correctly (backend tools reach
  `tools_client`; `search_knowledge_base` reaches the retriever directly
  and never the backend); `test_executor.py`'s new tests prove
  `search_knowledge_base`'s own dispatch, argument defaulting, and clean
  error handling for both `EmbeddingError` and `QdrantUnavailableError`.
  **What is not verified here is Groq's own decision-making** — every
  test above mocks `create_chat_completion` to return the decision a
  competent LLM would make, because Groq itself is unreachable in this
  sandbox (same `api.groq.com` block as every prior phase). Whether a
  real Llama model, given both kinds of tools and this phase's
  `SYSTEM_PROMPT`, actually makes the same five decisions is exactly what
  `test_agent_orchestration_live.py` checks, and it's expected to skip
  here for the same reason. Run it on your machine (with the backend
  seeded and a knowledge base ingested) to get that proof for real.
- **Phase 16 — `with_retry()` and `CircuitBreaker` are fully verified
  here, genuinely, not "as much as this sandbox allows."** Both have zero
  I/O — `test_retry.py` and `test_circuit_breaker.py` (13/13 passing)
  prove exact backoff timing and state-transition boundaries with a
  patched clock/sleep, and there was nothing this sandbox's network
  restrictions could have blocked here even in principle.
  **`backend_tools_client.py`'s and `groq_client.py`'s actual wiring of
  both primitives is also fully verified here** — 12/12 passing across
  the two new resilience test files, `httpx` mocked at the same boundary
  every other test in this project mocks it at. What is *not* re-verified
  by these particular tests is the underlying claim that Groq is
  reachable/unreachable — that's `api.groq.com` being confirmed blocked
  above, which is exactly the condition this phase's circuit breaker on
  `groq_client.py` is designed to handle gracefully. If you run this
  service with normal internet access and a valid `GROQ_API_KEY`, the
  breaker simply never trips in ordinary operation (every real call
  succeeds); to see it trip for real, you'd need Groq to actually be
  down, which `test_groq_client_resilience.py`'s mocked-failure tests
  already prove correct without needing that coincidence.

## Design decisions

**Phase 16:**

- **Audit first, code second.** Before writing `retry.py` or
  `circuit_breaker.py`, every existing timeout/retry path in both
  services was read directly, not assumed — see `backend/README.md`'s
  matching Phase 16 design-decisions bullet for the full list of what
  turned out to already be real. Only genuinely missing patterns got new
  code, per docs/architecture.md §17's own instruction.
- **Retry is narrow by construction, not by convention.** `RetryOptions.is_retryable`
  has no default that retries anything — a caller must explicitly decide
  which exceptions qualify. `backend_tools_client.py` and `groq_client.py`
  both pass `lambda exc: isinstance(exc, httpx.ConnectError)`: only "the
  request never reached the other side at all," never
  `httpx.TimeoutException` (would double an already-long wait, and inside
  the agent loop would compete with `AGENT_TOOL_TIMEOUT_MS`'s own budget)
  and never a non-2xx (the dependency genuinely answered).
- **One `CircuitBreaker` instance per dependency, module-level, not one
  per call.** `_backend_breaker` in `backend_tools_client.py` and
  `_groq_breaker` in `groq_client.py` are each created once and reused —
  a breaker only works if it remembers state across calls. `backend_client.py`
  (Phase 8's separate, far-less-used boundary-proof module) deliberately
  does not get one; it isn't called often enough or by anything
  latency-sensitive enough to justify it.
- **Hand-implemented, not a new dependency, and deliberately shaped to
  match the TypeScript version almost line for line.** Same reasoning
  this project has used for every other core mechanism (the agent loop
  itself, the executor's dispatch): a 3-state breaker and a
  backoff loop are small enough that a library adds a dependency without
  removing real complexity. Keeping the Python and TypeScript versions
  structurally identical means understanding one means recognizing the
  other, which matters for a reliability primitive specifically — the
  last thing you want during an actual incident is to relearn a
  differently-shaped implementation on whichever side is failing.
- **Thresholds are plain module-level constants, not new env vars.**
  `_RETRY_OPTIONS`, `_backend_breaker`/`_groq_breaker`'s
  `failure_threshold`/`reset_timeout_seconds` follow the same precedent
  `_REQUEST_TIMEOUT_SECONDS` already set in both `backend_client.py` and
  `backend_tools_client.py` — an internal implementation constant, not a
  configured value a deployment would reasonably need to tune per
  environment.
- **Groq gets a circuit breaker specifically because it's the one
  dependency confirmed unreachable in this very sandbox.** Of the three
  Phase 16 breaker placements across both services
  (`aiServiceClient.ts`, `backend_tools_client.py`, `groq_client.py`),
  this is the one where "a genuinely-down dependency" isn't hypothetical
  — `api.groq.com` being blocked here (see "What could and couldn't be
  verified here") is a real, observed condition this breaker directly
  improves the behavior of, not just a defensive pattern added on
  general principle.

**Phase 13:**

- **`search_knowledge_base` is offered as one more tool, not a second,
  separately-invoked code path.** `docs/architecture.md` §14 says the
  decision is "made by the LLM itself via the tool-calling interface ...
  rather than a separate hardcoded classifier" — the most literal way to
  honor that is to put RAG retrieval behind the exact same tool-calling
  mechanism Phase 10 already built, rather than writing an if/else that
  inspects the question first. There is deliberately no classifier
  function anywhere in this codebase; `SYSTEM_PROMPT` is the entire
  "decision logic."
- **A new `PrivilegeTier.KNOWLEDGE_RETRIEVAL`, not `READ_ONLY`.**
  `search_knowledge_base` is safe and side-effect-free like the
  `READ_ONLY` backend tools, but it structurally never reaches the
  backend at all — tagging it separately keeps `docs/architecture.md`
  §10's "the grouping is enforced, not just documented" promise honest:
  a future reader of `TOOL_PRIVILEGE` can tell, without reading
  `executor.py`, that this one tool doesn't follow the backend-HTTP-call
  pattern every other entry does.
- **`search_knowledge_base` calls `app/rag/retriever.py` directly from
  `executor.py`, never through `backend_tools_client`.** RAG has been the
  AI service's own responsibility since `docs/architecture.md` §2 was
  written in Phase 1 ("Python FastAPI AI service ... RAG retrieval") —
  routing it through the backend would mean giving the backend a reason
  to know about Qdrant, which it structurally never should (§13: Qdrant
  is "not a general application database", and it's the AI service's
  vector store specifically).
- **`retrieve()` runs via `asyncio.to_thread`, not awaited directly.**
  Every other tool handler in `executor.py` is naturally async (an httpx
  call to the backend); `retrieve()` is synchronous and can do real local
  CPU work (embedding). Calling it directly would block the event loop
  for every other concurrent request this FastAPI service is handling;
  `asyncio.to_thread` keeps the same "tools never block the agent loop"
  property Phase 10 established for backend calls.
- **`ToolCallStep.is_rag_query`, not a name-based check sprinkled through
  the codebase.** Computed once, in `loop.py`, from `get_tool_privilege()`
  — the same privilege-tier lookup `executor.py` already uses for
  enforcement — and returned through `POST /agent/invoke`. This makes
  "which steps used the knowledge base" a stable, structural fact instead
  of something every future consumer (Phase 14's trace writer, Phase 17's
  frontend trace view) would otherwise have to re-derive by checking tool
  names against a hardcoded list.
- **No hardcoded classifier, and no new tests trying to unit-test one.**
  Because the decision genuinely lives inside Groq's own reasoning (not
  in this codebase), the test matrix docs/phases.md row 13 asks for tests
  *dispatch correctness given a decision*, not *the decision itself* —
  see "What could and couldn't be verified here" for exactly where that
  line falls and why `test_agent_orchestration_live.py` exists as the
  real counterpart.

**Phase 12:**

- **7 real, substantive documents, not placeholder text.** Each averages
  ~600-700 words of specific, internally-consistent content about *this*
  project's own modeled 5-service topology (the same services/dependency
  graph Phase 6 seeded) — a generic "Lorem ipsum"-style knowledge base
  would have made the chunk-size justification and the retrieval proof
  both meaningless, since there would be nothing real to chunk correctly
  or retrieve relevantly.
- **A hand-rolled frontmatter parser, not PyYAML.** The schema is three
  flat string fields (`title`/`related_service`/`updated`) — adding a
  YAML dependency for that is the kind of unnecessary-dependency scope
  creep this project's ground rules rule out (mirrors why Phase 11 chose
  fastembed's plain-httpx style over adding more surface area than
  needed).
- **`document_type` comes from the folder, never from frontmatter.**
  `knowledge/README.md`'s planned structure already makes the folder a
  document lives in its type (architecture/runbooks/incidents/
  troubleshooting) — letting frontmatter also set a "type" would just
  create a second source of truth that could silently disagree with
  where the file actually lives.
- **Deterministic point ids (`uuid5` of the chunk id), not random ones.**
  Re-running `python -m app.rag.ingest` after editing a document updates
  that document's points in Qdrant in place (upsert semantics) instead of
  leaving stale duplicate points behind from the pre-edit version — the
  same "idempotent, safe to re-run" property `ensureTopics()` has for
  Kafka topics.
- **Chunk boundaries respect paragraph structure, with a sentence-level
  fallback for an oversized paragraph** — see `chunker.py`'s own
  docstring for the full chunk-size/overlap justification against this
  knowledge base's real document shape. One real bug this surfaced
  during development: naively appending the overlap tail from a full
  chunk onto the next full-size paragraph could push that combination
  past `CHUNK_SIZE_CHARS` — caught by
  `test_chunking_the_real_knowledge_base_produces_sane_output` failing
  against the real documents (not a synthetic edge case), fixed by
  skipping the overlap for that one boundary when tail+paragraph together
  wouldn't fit, rather than ever exceeding the hard size cap.
- **The relevance-score threshold (`DEFAULT_SCORE_THRESHOLD = 0.5`) is
  explicitly flagged as unvalidated, not presented as tuned.** It's a
  reasonable starting point for BAAI/bge-small-en-v1.5's typical score
  distribution, but this sandbox cannot actually run a retrieval query
  against real embeddings to check it empirically — see
  `retriever.py`'s own docstring. Claiming it was "tuned" without being
  able to observe a single real result would be exactly the kind of
  unverified infrastructure claim this project's ground rules prohibit.
- **No new HTTP endpoint, and nothing wired into the agent loop.** Same
  reasoning as Phase 11 and Phase 9: `docs/phases.md` row 12 asks for a
  chunking pipeline, ingested documents, and a retriever — not a decision
  about *when* to retrieve, which is explicitly Phase 13's job.

**Phase 11:**

- **fastembed, not `sentence-transformers` or a paid embedding API.**
  Full reasoning in `app/rag/embedding.py`'s own module docstring — in
  short: ONNX-only (no PyTorch this project has no GPU to use anyway),
  the library Qdrant's own client documents as its reference pairing, and
  no second paid-API credential needed alongside `GROQ_API_KEY`.
- **`BAAI/bge-small-en-v1.5`, resolved from `docs/env-vars.md`'s "TBD —
  Phase 11" placeholder.** A well-established, small (~130MB) general
  English embedding model already supported by fastembed out of the box
  — no custom conversion or training, matching the project's "no model
  training/fine-tuning" rule the same way running Llama's pretrained
  weights through Groq does.
- **`embedding.py` and `qdrant_client.py` are two separate modules, not
  one combined "add documents to Qdrant" helper**, even though
  `qdrant-client` itself ships a convenience `.add()`/`.query()` API that
  embeds internally via fastembed. `docs/architecture.md` §13 is explicit
  these are "distinct components" — keeping them separate here means
  Phase 12's chunker can call `embed_texts()` directly without depending
  on Qdrant-specific convenience wrappers, and `qdrant_client.py` stays
  usable with vectors from any source.
- **No in-memory/local-mode Qdrant anywhere in application code, and only
  a real dead port (never a fake client) in tests.** `qdrant-client`
  supports a `:memory:`/`path=`-based local mode that needs no server —
  tempting in a sandbox that can't run one, but it would mean
  `qdrant_client.py` (the code every later phase imports) was never
  actually tested against the real HTTP transport it uses in production.
  The negative test instead points a real `QdrantClient` at a real,
  connection-refused port — genuinely exercising the same code path a
  real outage would, the same reasoning `kafka.negative.test.ts` used for
  Kafka in Phase 5.
- **No new HTTP endpoint this phase**, mirroring Phase 9's own reasoning:
  `docs/phases.md` row 11 asks for a test-level proof ("Embed -> upsert ->
  search round-trip verified"), not an HTTP one, and there's no consumer
  for a retrieval endpoint yet (Phase 13 decides when to retrieve at all).
- **`ensure_collection()` is idempotent**, mirroring `ensureTopics()`'s
  role for Kafka (Phase 5) — safe to call on every ingestion run rather
  than requiring a separate one-time setup step.

**Phase 10:**

- **`create_incident` is intercepted in the executor, not left out of the
  tool list.** `docs/architecture.md` §10 is explicit: "the agent can
  *propose* one but cannot silently execute it." The alternative —
  simply not offering `create_incident` as a tool at all — would satisfy
  "never auto-executes" but not "the agent can propose one"; instead
  `_propose_create_incident` returns a structured, clearly-labeled
  `PROPOSED_NOT_EXECUTED` result (including the incident the LLM wanted
  to file) without ever touching `backend_tools_client.create_incident`,
  so the LLM can still tell the user "I'd recommend filing this incident"
  with concrete details, and a future phase can wire a real human-approval
  step on top of exactly this interception point.
  `test_create_incident_is_privileged_mutating_and_never_calls_the_real_backend`
  pins this down by mocking `tools_client.create_incident` and asserting
  `mocked.assert_not_awaited()` — not just that the response *looks*
  right, but that the real backend call genuinely never happened.
- **All 18 already-implemented backend tools are exposed, not just §10's
  named 10.** §10 explicitly lists 6 read-only + 6 simulation + 2
  privileged tools = 14 named tools; the backend actually implements all 8
  simulation functions (matching Phase 7's own resolution of the same
  §10/§11 list discrepancy — see `backend/README.md`'s Phase 10 design
  decisions) plus `get_current_system_state`, so 18 total. Under-exposing
  the 4 extra would mean the agent literally cannot call tools the backend
  already safely offers, for no benefit.
- **The executor never raises — always returns a dict.** A malformed tool
  name, a missing required argument, or a `BackendUnavailableError` all
  become `{"error": "..."}"` rather than propagating an exception up
  through `run_agent()`. This is what lets the agent loop treat every
  tool-call outcome uniformly (feed it back to Groq as the tool result and
  let the LLM decide what to do next) instead of needing a parallel
  exception-handling path alongside the normal result path.
- **The agent loop has both an iteration cap and a per-tool timeout, not
  just one or the other.** `AGENT_MAX_ITERATIONS` (default 6) bounds how
  many *rounds* of tool calls can happen — protection against Groq
  repeatedly asking for more tools without ever converging.
  `AGENT_TOOL_TIMEOUT_MS` (default 10000, via `asyncio.wait_for`) bounds
  how long any *single* tool call can hang — protection against one slow
  or wedged backend call stalling the whole request indefinitely. Neither
  alone covers what the other does.
- **`create_chat_completion`'s new `tools`/`tool_choice` params are
  optional and additive.** Both are only added to the outgoing payload
  when provided (`if tools: payload["tools"] = tools`), so every Phase 9
  call site, test, and the live-test's own request shape are completely
  unaffected — Phase 10 needed zero changes to `get_chat_reply()` or to
  any existing Phase 9 test.
- **The tool-call trace is returned in the HTTP response, not persisted.**
  `docs/architecture.md` §8 step 7 / §16 call for persisting a full
  execution trace to MongoDB — but that's explicitly Phase 14's job, and
  this service has no repository/model layer of its own yet (by design;
  see the top of this file: "Talks to the backend only through its HTTP
  tool API — never directly to MongoDB"). Returning `steps` in the
  response body is enough to satisfy *this* phase's own verification
  requirement without inventing a premature, ai-service-owned persistence
  layer that Phase 14 would just have to replace.

**Phase 9:**

- **Plain `httpx`, not the `groq` SDK.** One endpoint, one call shape —
  adding a dedicated SDK dependency for that would be the kind of
  unnecessary-framework scope creep the project's ground rules rule out.
  Kept in the same style as `app/clients/backend_client.py`.
- **`create_chat_completion` returns the raw parsed response;
  `get_chat_reply` is a separate convenience function.** Later phases
  (10+, the agent loop) will need the full response (tool-call fields,
  finish reason, usage) rather than just the text — building that
  consumer now, before Phase 10 needs it, would be scope creep in the
  other direction.
- **`GroqConfigError` (missing key) is checked and raised before any
  network call.** Cheaper and clearer than letting Groq's API return a
  401 for an obviously-missing key, and it's what makes
  `test_create_chat_completion_raises_config_error_without_api_key`
  assertable without any network mocking at all.
- **`LLM_MODEL` defaults to `llama-3.3-70b-versatile`** (Groq's current
  production Llama model, confirmed via console.groq.com/docs/models),
  but every call path reads it from config, never a literal string in
  `groq_client.py` — `docs/architecture.md` §9 is explicit that Groq's
  supported model names change and this must stay configurable.
- **A live-but-skippable test, not a mock-only test suite, for Groq
  itself.** `docs/phases.md` row 9's verification is "real completion
  returned from Groq, verified in a test" — a purely mocked test can't
  honestly claim that. Gating it on `GROQ_API_KEY` being present keeps
  the default `pytest` run hermetic (matching the project's testing
  rules) while still providing a real, automatable proof the moment a
  real key exists, without hardcoding one into the repo.
- **No new FastAPI endpoint this phase.** `docs/phases.md` row 9 asks for
  a test-level proof, not an HTTP one (contrast Phase 8's explicit
  boundary-endpoint requirement). Adding an endpoint before Phase 10 has
  an agent loop to put behind it would be a premature abstraction.

---

<details>
<summary>Phase 8 status: service skeleton + backend HTTP boundary (complete)</summary>

Implemented:

- A FastAPI app that boots and listens on `PORT` (default `8000`).
- Its own `GET /health` endpoint.
- `app/clients/backend_client.py` — the only way this service reaches the
  Node backend: a plain `httpx` `GET` to the backend's existing read-only
  `GET /api/services` endpoint (`backend/src/routes/services.route.ts`,
  Phase 6), reading `BACKEND_BASE_URL` from env.
- `GET /api/backend/services` — calls that client and returns the
  backend's response unchanged, or a clean `502` if the backend can't be
  reached or errors (never a crash or a hang).

Verify:

```bash
curl http://localhost:8000/health
# {"status":"ok","service":"ai-service","env":"development"}

curl -i http://localhost:8000/api/backend/services
# 200 with the backend's { "data": [...], "cacheHit": ... } body if the
# backend's MongoDB is connected and seeded (npm run seed in backend/);
# 502 with a descriptive "detail" message if the backend is unreachable
# or its own MongoDB isn't connected yet (the backend itself returns 503
# for GET /api/services in that case). Either way this process keeps
# running.
```

Design decisions:

- HTTP client, not a generated SDK or ORM-style wrapper — a single
  `httpx.AsyncClient` call is all the boundary needed.
- `backend_client.py` raises a plain `BackendUnavailableError`, not an
  HTTP-framework exception — keeps it testable and reusable independent
  of FastAPI, the same framework-agnostic style used for
  `backend/src/services/simulation` in Phase 7.
- Every non-2xx and every network error normalized into one exception
  type, so the route handler has exactly one failure case to handle.
- `.env.example` at the time listed only the four variables Phase 8 code
  read; Phase 9 has since added its own three.
- No `app/agent/`, `app/tools/`, `app/rag/`, `app/llm/` folders were
  created ahead of the phases that needed them.

</details>
