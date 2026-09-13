"""
Phase 8's boundary-proof endpoint. Demonstrates that this service can
reach the Node backend's read-only digital-twin data over HTTP -- and
only over HTTP, through app/clients/backend_client.py -- with nothing
else (no direct DB/cache/broker access) involved.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.clients.backend_client import BackendUnavailableError, get_services

router = APIRouter(prefix="/api/backend", tags=["backend-boundary"])


@router.get("/services")
async def backend_services() -> dict:
    """
    Calls the Node backend's `GET /api/services` through the boundary
    client and returns its response body unchanged.

    If the backend is unreachable or errors, this returns a normal 502
    response instead of crashing or hanging this process (Phase 8
    requirement: handle backend connection failures cleanly).
    """
    try:
        return await get_services()
    except BackendUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
