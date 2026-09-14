"""
Proves the Phase 16 retry + circuit breaker behavior actually wired into
app/tools/backend_tools_client.py's `_request()` -- the Python-side
mirror of backend/tests/aiServiceClient.resilience.unit.test.ts. Distinct
from test_backend_tools_client.py (Phase 10), which only covers request
shape and basic failure normalization.

Each test calls `importlib.reload()` on the module under test after
patching `app.utils.circuit_breaker.time.monotonic` and
`app.utils.retry.asyncio.sleep`, so every test gets its own fresh
`_backend_breaker` module-level instance (CLOSED, 0 consecutive
failures) -- the breaker's whole point is remembering state across
calls, so without this the tests would be order-dependent on each other,
same reasoning the TypeScript twin's `vi.resetModules()` uses.
"""

from __future__ import annotations

import importlib
from unittest.mock import patch

import httpx
import pytest

from app.clients.backend_client import BackendUnavailableError


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict:
        assert self._payload is not None
        return self._payload


class _QueuedFakeClient:
    """Returns/raises the next queued outcome on each successive request(), like a mock call queue."""

    def __init__(self, outcomes: list[_FakeResponse | Exception]) -> None:
        self._outcomes = outcomes
        self.call_count = 0

    async def __aenter__(self) -> "_QueuedFakeClient":
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        return False

    async def request(self, method: str, url: str, *, params: dict | None = None, json: dict | None = None):
        outcome = self._outcomes[min(self.call_count, len(self._outcomes) - 1)]
        self.call_count += 1
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.fixture
def tools_client(monkeypatch: pytest.MonkeyPatch):
    """
    A freshly reloaded app.tools.backend_tools_client module, with real
    delays/clock removed so tests run instantly and deterministically.
    """
    import app.utils.circuit_breaker as circuit_breaker_module
    import app.utils.retry as retry_module

    async def fast_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(retry_module.asyncio, "sleep", fast_sleep)

    fake_now = {"t": 0.0}
    monkeypatch.setattr(circuit_breaker_module.time, "monotonic", lambda: fake_now["t"])

    import app.tools.backend_tools_client as module

    module = importlib.reload(module)
    yield module, fake_now
    importlib.reload(module)  # leave a clean module behind for the next test file/session


def _with_client(queued_client: _QueuedFakeClient):
    return patch("app.tools.backend_tools_client.httpx.AsyncClient", lambda **kwargs: queued_client)


async def test_retries_once_after_a_connection_failure_and_returns_the_eventual_success(tools_client) -> None:
    module, _ = tools_client
    client = _QueuedFakeClient([httpx.ConnectError("refused"), _FakeResponse(200, {"data": {"ok": True}})])

    with _with_client(client):
        result = await module.get_services()

    assert result == {"ok": True}
    assert client.call_count == 2  # 1 initial + 1 retry


async def test_retries_once_after_a_connection_failure_then_still_fails(tools_client) -> None:
    module, _ = tools_client
    client = _QueuedFakeClient([httpx.ConnectError("refused"), httpx.ConnectError("refused")])

    with _with_client(client):
        with pytest.raises(BackendUnavailableError):
            await module.get_services()

    assert client.call_count == 2  # 1 initial + 1 retry, then gives up


async def test_does_not_retry_a_timeout(tools_client) -> None:
    module, _ = tools_client
    client = _QueuedFakeClient([httpx.TimeoutException("timed out")])

    with _with_client(client):
        with pytest.raises(BackendUnavailableError):
            await module.get_services()

    assert client.call_count == 1  # no retry at all -- a timeout is never retried


async def test_does_not_retry_a_non_2xx_response(tools_client) -> None:
    module, _ = tools_client
    client = _QueuedFakeClient([_FakeResponse(500, text="backend crashed")])

    with _with_client(client):
        with pytest.raises(BackendUnavailableError):
            await module.get_services()

    assert client.call_count == 1  # the backend DID respond -- no retry


async def test_circuit_trips_open_after_3_consecutive_failed_calls_then_fails_fast(tools_client) -> None:
    module, _ = tools_client

    for _ in range(3):
        client = _QueuedFakeClient([httpx.ConnectError("refused"), httpx.ConnectError("refused")])
        with _with_client(client):
            with pytest.raises(BackendUnavailableError):
                await module.get_services()

    # 4th call: breaker is OPEN -- no network attempt at all.
    never_called_client = _QueuedFakeClient([_FakeResponse(200, {"data": {"ok": True}})])
    with _with_client(never_called_client):
        with pytest.raises(BackendUnavailableError, match="circuit breaker is open"):
            await module.get_services()

    assert never_called_client.call_count == 0


async def test_a_non_2xx_response_does_not_count_as_a_breaker_failure(tools_client) -> None:
    module, _ = tools_client

    for _ in range(5):
        client = _QueuedFakeClient([_FakeResponse(503, text="busy")])
        with _with_client(client):
            with pytest.raises(BackendUnavailableError):
                await module.get_services()

    # Breaker must still be CLOSED: a subsequent success goes through cleanly.
    success_client = _QueuedFakeClient([_FakeResponse(200, {"data": {"ok": True}})])
    with _with_client(success_client):
        result = await module.get_services()

    assert result == {"ok": True}
