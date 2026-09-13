"""
Tests for GET /api/backend/services -- the demonstrable boundary endpoint
(requirement #7). Mocks app.api.backend_proxy.get_services so these run
with no real Node backend needed, and specifically proves requirement #8:
a backend failure comes back as a clean 502, and the FastAPI process
keeps serving requests afterward (it does not crash or hang).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.clients.backend_client import BackendUnavailableError
from app.main import app

client = TestClient(app)


def test_backend_services_returns_backend_payload_on_success() -> None:
    fake_payload = {"data": [{"name": "order-service"}], "cacheHit": True}

    with patch("app.api.backend_proxy.get_services", new=AsyncMock(return_value=fake_payload)):
        response = client.get("/api/backend/services")

    assert response.status_code == 200
    assert response.json() == fake_payload


def test_backend_services_returns_502_when_backend_unavailable() -> None:
    with patch(
        "app.api.backend_proxy.get_services",
        new=AsyncMock(
            side_effect=BackendUnavailableError(
                "Could not reach backend at http://localhost:4000/api/services: connection refused"
            )
        ),
    ):
        response = client.get("/api/backend/services")

    assert response.status_code == 502
    assert "Could not reach backend" in response.json()["detail"]


def test_service_keeps_serving_after_a_backend_failure() -> None:
    """A dead backend must not crash or hang this process (requirement #8)."""
    with patch(
        "app.api.backend_proxy.get_services",
        new=AsyncMock(side_effect=BackendUnavailableError("boom")),
    ):
        failed = client.get("/api/backend/services")

    still_alive = client.get("/health")

    assert failed.status_code == 502
    assert still_alive.status_code == 200
