# ai-service

Python + FastAPI AI service. Eventually owns agent orchestration,
Groq/Llama interaction, tool-calling execution, and RAG (chunking,
embedding, Qdrant retrieval) — see `../docs/architecture.md` §2, §8, §15.
Talks to the backend only through its HTTP tool API — never directly to
MongoDB, Redis, or Kafka.

## Phase 11 status: Qdrant + embedding model

Implemented now, alongside (not on top of) Phase 10's agent loop — these
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

## Structure (through Phase 11)

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
│   │   └── agent.py         Phase 10 — POST /agent/invoke
│   ├── clients/
│   │   └── backend_client.py  the ONLY code that talks to the Node backend directly (Phase 8's boundary proof; NOT a tool)
│   ├── llm/
│   │   └── groq_client.py     the ONLY code that talks to Groq (Phase 9; tools/tool_choice added in Phase 10)
│   ├── rag/                    Phase 11 — not yet wired into anything else
│   │   ├── embedding.py        embed_text()/embed_texts() via fastembed, get_embedding_dimension()
│   │   └── qdrant_client.py    ensure_collection()/upsert_points()/search() against a real Qdrant instance
│   ├── tools/                  Phase 10
│   │   ├── schemas.py          TOOL_DEFINITIONS / TOOL_SCHEMAS / TOOL_PRIVILEGE (18 tools, 4 privilege tiers)
│   │   ├── backend_tools_client.py   one async function per tool -> backend/src/tools/* route
│   │   └── executor.py         execute_tool_call() — dispatch + privilege enforcement, never raises
│   └── agent/                  Phase 10
│       └── loop.py             run_agent() — the tool-calling loop (iteration cap, per-tool timeout)
├── tests/
│   ├── test_health.py
│   ├── test_backend_client.py           unit tests, httpx mocked
│   ├── test_backend_boundary_route.py   route tests, backend_client mocked
│   ├── test_groq_client.py              unit tests, httpx mocked (always run)
│   ├── test_groq_client_live.py         REAL Groq call — skipped unless GROQ_API_KEY is set
│   ├── test_backend_tools_client.py     Phase 10 — unit tests, httpx mocked
│   ├── test_executor.py                 Phase 10 — dispatch + THE privilege-enforcement test
│   ├── test_agent_loop.py               Phase 10 — control-flow tests, Groq + executor both mocked
│   ├── test_agent_endpoint.py           Phase 10 — HTTP layer only, run_agent mocked
│   ├── test_agent_live.py               Phase 10 — REAL end-to-end: real Groq + real backend, both required
│   ├── test_embedding.py                Phase 11 — mostly mocked (always run) + one REAL, unmocked semantic-similarity proof
│   └── test_qdrant_client.py            Phase 11 — a REAL negative-connection proof (always run) + a REAL embed->upsert->search proof (needs real Qdrant)
├── requirements.txt
├── pytest.ini
└── .env.example
```

Chunking (`app/rag/chunker.py` or similar) from the eventual structure in
`../docs/architecture.md` §4 is intentionally still not created — it's
Phase 12's job, once real `knowledge/` documents exist to chunk.

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

## Tests

```bash
cd ai-service
source .venv/bin/activate
pytest -v
```

54 tests. `tests/test_groq_client_live.py`, `tests/test_agent_live.py`,
and one test in `tests/test_embedding.py` +
`tests/test_qdrant_client.py` each require real, unmocked network access
this build sandbox doesn't have and are **automatically skipped** here —
4 skips total, 50 passed:

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

Everything else — including
`test_qdrant_client.py::test_functions_raise_a_clean_error_when_qdrant_is_unreachable`,
a REAL (not mocked) connection-refused proof against `127.0.0.1:1`, the
same technique `backend/tests/kafka.negative.test.ts` uses for Kafka —
mocks only its actual external network boundary (`httpx`/Groq/the tool
executor/the embedding model, as appropriate) and needs no real
credentials or running services; all pass in this sandbox. None of the 4
skipped tests' proofs has been run for real by pytest itself here — the
manual commands under "Verify" above substitute for that, following the
same deferral pattern Phase 5 used for the Kafka broker. Set a real
`GROQ_API_KEY`, start the Node backend, and start a real Qdrant instance,
then re-run `pytest -v` to get all four proofs from pytest itself on your
machine.

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

## Design decisions

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
