# knowledge

Source markdown documents ingested into the RAG pipeline (Phase 12). These
are project-specific technical documents, not general knowledge — the kind
of thing a real on-call engineer would keep in a wiki.

## Planned structure

```
knowledge/
├── architecture/       system-architecture.md, service-level design docs
├── runbooks/           payment-service-recovery.md, redis-failure-runbook.md,
│                       kafka-consumer-recovery.md, ...
├── incidents/          incident-payment-outage.md, ...
└── troubleshooting/    general troubleshooting guides
```

Nothing is ingested yet — documents are authored and the ingestion
pipeline (chunking → embedding → Qdrant) is built in Phase 12, once the
digital twin and simulation engine exist to write realistic, consistent
documentation against.
