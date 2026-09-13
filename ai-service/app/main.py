"""
AI service entrypoint.

Phase 8: service skeleton, its own health endpoint, and an HTTP boundary
to the Node backend. Phase 9: a Groq chat-completion client (not wired to
any endpoint on its own). Phase 10: tool schemas + a tool execution loop
against the backend's tool API, exposed here as POST /agent/invoke. No
RAG, no Qdrant client, and no MongoDB/Redis/Kafka client anywhere in this
service -- those are Phases 11-14 (docs/architecture.md §2, §15).
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
