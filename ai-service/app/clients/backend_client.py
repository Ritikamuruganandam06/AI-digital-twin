

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
