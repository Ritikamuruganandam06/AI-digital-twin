# Development phases

Followed in this exact order. Each phase ends with a working, verified
increment and stops for explicit "NEXT" before continuing. See
`docs/architecture.md` for the design each phase implements.

| # | Phase | Core deliverable | Verification required |
|---|---|---|---|
| 1 | Architecture + repository structure + configuration | This repo skeleton, docs, env var contracts | N/A (planning phase) |
| 2 | Node.js + Express backend | App skeleton, middleware, health endpoint, structured logging | Server boots, `GET /health` returns 200 |
| 3 | MongoDB + Mongoose | Connection, first schema/model, repository layer | Real insert + read against local MongoDB via `GET /health` and a CRUD endpoint |
| 4 | Redis + ioredis | Connection, cache-aside helper | Real SET/GET/TTL proof via `GET /health` and a caching endpoint |
| 5 | Kafka + KafkaJS | Producer, consumer, topic(s) | Message published and actually consumed, observable in logs/tests |
| 6 | Digital Twin data model | Service topology, dependencies, metrics, incidents as real MongoDB data | Seed script + query endpoints return the modeled topology |
| 7 | Deterministic Simulation Engine | Pure TS functions for each simulation type | Unit tests covering each scenario's calculated output |
| 8 | Python FastAPI AI Service | Service skeleton, health endpoint, boundary to backend | Service boots, calls a backend read-only endpoint successfully |
| 9 | Groq + Llama integration | Groq client, configurable model, basic chat completion | Real completion returned from Groq, verified in a test |
| 10 | Agent Tool Calling | Tool schemas + tool execution loop against backend tool API | LLM calls a tool, tool hits real backend data, result returned |
| 11 | Qdrant + Embedding Model | Qdrant client, embedding pipeline | Embed → upsert → search round-trip verified |
| 12 | RAG ingestion and retrieval | Chunking pipeline, `knowledge/` documents ingested, retriever | Question → relevant chunks retrieved, with justified chunk size/overlap |
| 13 | Agent + Tools + RAG orchestration | Full decision logic (tools/RAG/both/neither) | Test matrix of question types produces correct tool/RAG usage |
| 14 | Agent Execution Trace | Persisted execution records | Trace retrievable via API, matches what actually happened |
| 15 | Authentication + Authorization | JWT, RBAC (USER/OPERATOR/ADMIN) | Privileged endpoints reject insufficient roles; tests per role |
| 16 | Reliability patterns | Timeouts, retries, circuit breaker, rate limiting, idempotency, DLQ, AI iteration/timeout limits | Failure-injection tests per pattern |
| 17 | React Frontend | System overview, topology, service details, AI assistant, what-if simulation, incidents, execution trace views | Manual + component tests against the real backend API |
| 18 | Observability | Structured logs, request/correlation/execution IDs, health dashboards | Logs show correlated IDs across a full request→agent→tool chain |
| 19 | End-to-End Testing | Cross-service test suite in `tests/` | Full question→agent→grounded-answer scenarios pass |

## Ground rules across every phase

- No Docker, no Kubernetes, no model training/fine-tuning, no LangChain/CrewAI.
- Every infrastructure claim ("MongoDB is connected", "Kafka works") must be
  backed by a runnable proof, not just configuration.
- The LLM never invents simulation results or system data — only
  deterministic application code produces those.
- React never talks to Mongo/Redis/Kafka/Qdrant/Groq directly.
- The Python AI service never talks to Mongo/Redis/Kafka directly — only
  through the Node.js backend's tool API.
