"""
Unit tests for the boundary client itself (app/clients/backend_client.py),
with httpx mocked out -- no real network call, no dependency on a running
Node backend. Covers both the success path and the two failure modes the
route layer needs to turn into a clean 502 (requirement #8): a refused
connection, and a non-2xx response from the backend.
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from app.clients.backend_client import BackendUnavailableError, get_services


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict:
        assert self._payload is not None
        return self._payload


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient as an async context manager."""

    def __init__(self, response: _FakeResponse | None = None, raise_error: Exception | None = None) -> None:
        self._response = response
        self._raise_error = raise_error

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        return False

    async def get(self, url: str) -> _FakeResponse:
        if self._raise_error is not None:
            raise self._raise_error
        assert self._response is not None
        return self._response


@pytest.mark.asyncio
async def test_get_services_returns_backend_payload_unchanged() -> None:
    fake_payload = {"data": [{"name": "order-service"}], "cacheHit": False}

    with patch(
        "app.clients.backend_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(200, fake_payload)),
    ):
        result = await get_services()

    assert result == fake_payload


@pytest.mark.asyncio
async def test_get_services_raises_backend_unavailable_on_connection_failure() -> None:
    with patch(
        "app.clients.backend_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(raise_error=httpx.ConnectError("connection refused")),
    ):
        with pytest.raises(BackendUnavailableError):
            await get_services()


@pytest.mark.asyncio
async def test_get_services_raises_backend_unavailable_on_error_status() -> None:
    with patch(
        "app.clients.backend_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(503, text="database not connected")),
    ):
        with pytest.raises(BackendUnavailableError):
            await get_services()
