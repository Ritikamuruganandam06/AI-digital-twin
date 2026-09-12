# tests

Cross-service / end-to-end tests (Phase 19) that exercise the full
question → agent → tool/RAG → grounded answer flow against real running
services (backend + AI service + MongoDB + Redis + Kafka + Qdrant).

Service-local tests (backend unit/integration tests, ai-service pytest
suite) live inside `backend/` and `ai-service/` respectively, next to the
code they test. This directory is only for tests that genuinely span
multiple services.

Nothing here yet — this is a Phase 1 placeholder.
