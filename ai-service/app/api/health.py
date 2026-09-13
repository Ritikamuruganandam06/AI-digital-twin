"""
The AI service's own liveness endpoint -- mirrors the role of
backend/src/routes/health.route.ts (Phase 2) for this service. Phase 8
scope only: reports that the FastAPI process is up and which env it
thinks it's running in. It does not check the backend or any other
dependency (that's what GET /api/backend/services proves separately).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter()


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "ai-service",
        "env": settings.env,
    }
