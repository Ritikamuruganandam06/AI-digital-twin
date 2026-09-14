# knowledge

Source markdown documents ingested into the RAG pipeline (Phase 12). These
are project-specific technical documents, not general knowledge — the kind
of thing a real on-call engineer would keep in a wiki.

## Structure

```
knowledge/
├── architecture/
│   └── system-architecture.md          the modeled 5-service topology, dependency graph, health semantics
├── runbooks/
│   ├── payment-service-recovery.md     the most detailed runbook -- payment-service is this topology's
│   │                                   highest-value service to have a rehearsed recovery procedure for
│   ├── redis-failure-runbook.md        why a Redis outage is a performance incident, never a data incident
│   └── kafka-consumer-recovery.md      stalled/lagging consumer, DLQ, consumer-group-id gotchas
├── incidents/
│   └── incident-payment-outage.md      narrative writeup of the seeded "Elevated payment gateway
│                                       latency" incident record, kept in sync with it by hand
└── troubleshooting/
    ├── high-latency-troubleshooting.md
    └── high-error-rate-troubleshooting.md
```

## Document format

Every document starts with a small frontmatter block (plain `key: value`
lines between `---` delimiters, parsed by `ai-service/app/rag/loader.py`
— deliberately not YAML, see that module's docstring for why):

```markdown
---
title: Payment Service Recovery Runbook
related_service: payment-service
updated: 2026-02-20
---

# Payment Service Recovery Runbook
...body...
```

`related_service` is either a real seeded service name (`payment-service`,
`order-service`, ...) or `all` for a document that isn't specific to one
service. `document_type` is deliberately **not** a frontmatter field — a
document's type is the top-level folder it lives in
(architecture/runbooks/incidents/troubleshooting), so there's no
independent value a document could set that would ever legitimately
disagree with where the file actually lives.

## Ingestion

Chunked (`ai-service/app/rag/chunker.py`), embedded
(`ai-service/app/rag/embedding.py`), and upserted into Qdrant
(`ai-service/app/rag/qdrant_client.py`) by
`ai-service/app/rag/ingest.py` — run it with:

```bash
cd ai-service && source .venv/bin/activate && python -m app.rag.ingest
```

See `ai-service/README.md`'s Phase 12 section for what this requires (a
real Qdrant instance, and outbound access to huggingface.co for the
embedding model's one-time download) and the chunk-size/overlap
justification behind how these documents get split.
