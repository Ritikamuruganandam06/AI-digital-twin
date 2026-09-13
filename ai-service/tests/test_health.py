"""Phase 8: the service boots and its own health endpoint responds."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_200_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-service"


def test_health_reports_configured_env() -> None:
    response = client.get("/health")

    assert response.json()["env"] in {"development", "test", "production"}
