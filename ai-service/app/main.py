"""
AI service entrypoint.

Phase 8: service skeleton, its own health endpoint, and an HTTP boundary
to the Node backend. Phase 9: a Groq chat-completion client (not wired to
any endpoint on its own). Phase 10: tool schemas + a tool execution loop
against the backend's tool API, exposed here as POST /agent/invoke.
Phase 11: an embedding pipeline + Qdrant client (not wired to the agent
loop yet). Phase 12: a chunking/ingestion pipeline + retriever over a
real knowledge/ base (still not wired to the agent loop). Phase 13: the
agent loop now offers search_knowledge_base alongside every backend tool,
so POST /agent/invoke can use tools, RAG, both, or neither per question.
Phase 14: each step in that response now carries a real `timestamp`, and
the Node backend (not this service -- still no MongoDB/Redis/Kafka client
anywhere here) calls this endpoint and persists the result as an agent
execution trace; RAG still goes through app/rag/ (its own Qdrant client),
never through the backend (docs/architecture.md §2, §15).
"""

from __future__ import annotations

from fastapi import FastAPI

from app.api.agent import router as agent_router
from app.api.backend_proxy import router as backend_proxy_router
from app.api.health import router as health_router
from app.config import get_settings

app = FastAPI(
    title="AI Digital Twin - AI Service",
    version="0.1.0",
    description="Python FastAPI agent service (Phase 10: tool-calling agent loop).",
)

app.include_router(health_router)
app.include_router(backend_proxy_router)
app.include_router(agent_router)


def run() -> None:
    """Used by `python -m app.main` -- see ai-service/README.md for the run command."""
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, log_level=settings.log_level.lower())


if __name__ == "__main__":
    run()
