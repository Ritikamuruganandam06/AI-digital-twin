# ai-service

Python + FastAPI agent service. Owns agent orchestration, Groq/Llama
interaction, tool-calling execution, and RAG (chunking, embedding, Qdrant
retrieval). Talks to the backend only through its HTTP tool API — never
directly to MongoDB, Redis, or Kafka.

Not implemented yet — this is a Phase 1 placeholder. Implementation begins
Phase 8. See `../docs/architecture.md` and `../docs/phases.md`.

## Planned structure

```
ai-service/
├── app/
│   ├── agent/    orchestration loop, planning, execution trace
│   ├── tools/    tool schemas + HTTP clients calling the backend
│   ├── rag/      chunking, embedding, Qdrant client, retriever
│   ├── llm/      Groq client, prompt templates
│   └── api/      FastAPI routers
├── tests/
├── requirements.txt
└── .env
```

Copy `.env.example` to `.env` once Phase 8 scaffolds the app.
