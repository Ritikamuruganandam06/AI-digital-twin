"""
HTTP boundary between the AI service and the Node.js backend.

This is the ONLY way the AI service is allowed to reach live system data.
Per docs/architecture.md SS15 ("AI service / backend boundary"), this
service has no MongoDB/Redis/Kafka client and never will -- every piece
of data it eventually sees must first pass through the backend's own
validation/auth/business logic via a plain HTTP call like this one.
Phase 8 only proves the boundary exists and works end to end; later
phases add an LLM/agent/tool-calling layer on top of this module, not a
second way to reach the backend's data.

Deliberately framework-agnostic (no FastAPI/HTTPException here), the same
style used for backend/src/services/simulation in Phase 7 -- callers
(app/api routers) decide how to turn BackendUnavailableError into an HTTP
response.
"""

from __future__ import annotations

import httpx

from app.config import get_settings

_REQUEST_TIMEOUT_SECONDS = 5.0


class BackendUnavailableError(Exception):
    """Raised when the Node backend can't be reached or returns an error."""


async def get_services() -> dict:
    """
    Calls the backend's existing read-only `GET /api/services` endpoint
    (backend/src/routes/services.route.ts) and returns its parsed JSON
    body unchanged.

    Never lets a raw network exception (connection refused, timeout, DNS
    failure, ...) or a non-2xx backend response propagate past this
    function -- both are normalized into BackendUnavailableError so the
    caller can handle "backend is down" as a single, expected case rather
    than the FastAPI process crashing or hanging (Phase 8 requirement:
    handle backend connection failures cleanly).
    """
    settings = get_settings()
    url = f"{settings.backend_base_url}/api/services"

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(url)
    except httpx.RequestError as exc:
        raise BackendUnavailableError(f"Could not reach backend at {url}: {exc}") from exc

    if response.status_code >= 400:
        raise BackendUnavailableError(
            f"Backend returned HTTP {response.status_code} for {url}: {response.text[:200]}"
        )

    return response.json()
