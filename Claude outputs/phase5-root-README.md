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
├── backend/        Node.js + TypeScript + Express API, Mongo/Redis/Kafka (Phases 2–7, 14–16)
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

**Phases 1–5 complete:** repository scaffolding, the Express app skeleton
(health checks, structured logging, correlation IDs, centralized error
handling), a real MongoDB/Mongoose connection with a verified CRUD proof,
a real Redis/ioredis connection with a working cache-aside layer in front
of it, and real Kafka/KafkaJS integration (idempotent producer, consumer
group, dead-letter topic, explicit topic creation) with a producer → topic
→ consumer diagnostic proof. See `docs/phases.md` for what Phase 6 onward
will add, and `backend/README.md` for how to run and verify what exists so
far — including exactly which parts of Phase 5 could be verified in the
sandbox this was built in, and which need a real broker on your machine.

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
