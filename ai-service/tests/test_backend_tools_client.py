"""
Unit tests for app/tools/backend_tools_client.py with httpx mocked --
same pattern as test_backend_client.py. Verifies each function hits the
right method/URL and unwraps the backend's {"data": ...} envelope.
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from app.clients.backend_client import BackendUnavailableError
from app.tools import backend_tools_client as tools_client


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict:
        assert self._payload is not None
        return self._payload


class _RecordingFakeClient:
    """Records every request() call it receives and returns a canned response."""

    last_call: dict | None = None

    def __init__(self, response: _FakeResponse | None = None, raise_error: Exception | None = None) -> None:
        self._response = response
        self._raise_error = raise_error

    async def __aenter__(self) -> "_RecordingFakeClient":
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        return False

    async def request(self, method: str, url: str, *, params: dict | None = None, json: dict | None = None) -> _FakeResponse:
        _RecordingFakeClient.last_call = {"method": method, "url": url, "params": params, "json": json}
        if self._raise_error is not None:
            raise self._raise_error
        assert self._response is not None
        return self._response


def _patched(response: _FakeResponse | None = None, raise_error: Exception | None = None):
    return patch(
        "app.tools.backend_tools_client.httpx.AsyncClient",
        lambda **kwargs: _RecordingFakeClient(response=response, raise_error=raise_error),
    )


@pytest.mark.asyncio
async def test_get_services_unwraps_data_envelope() -> None:
    with _patched(_FakeResponse(200, {"data": [{"name": "order-service"}]})):
        result = await tools_client.get_services()

    assert result == [{"name": "order-service"}]
    assert _RecordingFakeClient.last_call["method"] == "GET"
    assert _RecordingFakeClient.last_call["url"].endswith("/internal/tools/services")


@pytest.mark.asyncio
async def test_get_service_builds_the_right_path() -> None:
    with _patched(_FakeResponse(200, {"data": {"name": "payment-service"}})):
        result = await tools_client.get_service("payment-service")

    assert result == {"name": "payment-service"}
    assert _RecordingFakeClient.last_call["url"].endswith("/internal/tools/services/payment-service")


@pytest.mark.asyncio
async def test_get_service_metrics_passes_limit_as_query_param() -> None:
    with _patched(_FakeResponse(200, {"data": []})):
        await tools_client.get_service_metrics("payment-service", limit=5)

    assert _RecordingFakeClient.last_call["params"] == {"limit": 5}


@pytest.mark.asyncio
async def test_simulate_service_failure_posts_json_body() -> None:
    with _patched(_FakeResponse(200, {"data": {"scenario": "service_failure"}})):
        result = await tools_client.simulate_service_failure("db-service")

    assert result == {"scenario": "service_failure"}
    assert _RecordingFakeClient.last_call["method"] == "POST"
    assert _RecordingFakeClient.last_call["json"] == {"serviceName": "db-service"}


@pytest.mark.asyncio
async def test_create_incident_posts_all_fields() -> None:
    with _patched(_FakeResponse(201, {"data": {"id": "abc123"}})):
        result = await tools_client.create_incident(
            title="t", description="d", service_name="db-service", severity="high", affected_service_names=["api-service"]
        )

    assert result == {"id": "abc123"}
    assert _RecordingFakeClient.last_call["json"] == {
        "title": "t",
        "description": "d",
        "serviceName": "db-service",
        "severity": "high",
        "affectedServiceNames": ["api-service"],
    }


@pytest.mark.asyncio
async def test_raises_backend_unavailable_on_connection_failure() -> None:
    with _patched(raise_error=httpx.ConnectError("connection refused")):
        with pytest.raises(BackendUnavailableError):
            await tools_client.get_services()


@pytest.mark.asyncio
async def test_raises_backend_unavailable_on_error_status() -> None:
    with _patched(_FakeResponse(503, text='{"error":{"message":"Database is currently unavailable"}}')):
        with pytest.raises(BackendUnavailableError):
            await tools_client.find_bottleneck()
