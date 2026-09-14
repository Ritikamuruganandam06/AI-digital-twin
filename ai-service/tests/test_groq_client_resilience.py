"""
Proves the Phase 16 retry + circuit breaker behavior actually wired into
app/llm/groq_client.py's `create_chat_completion()` -- the Python-side
mirror of tests/test_backend_tools_client_resilience.py, same technique
(reload the module under test with time/sleep patched so every test gets
a fresh circuit breaker). Distinct from test_groq_client.py (Phase 9),
which only covers request shape and basic failure normalization.
"""

from __future__ import annotations

import importlib
from unittest.mock import patch

import httpx
import pytest

from app.config import get_settings


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict:
        assert self._payload is not None
        return self._payload


class _QueuedFakeClient:
    def __init__(self, outcomes: list[_FakeResponse | Exception]) -> None:
        self._outcomes = outcomes
        self.call_count = 0

    async def __aenter__(self) -> "_QueuedFakeClient":
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        return False

    async def post(self, url: str, json: dict, headers: dict):
        outcome = self._outcomes[min(self.call_count, len(self._outcomes) - 1)]
        self.call_count += 1
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.fixture
def groq_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    get_settings.cache_clear()

    import app.utils.circuit_breaker as circuit_breaker_module
    import app.utils.retry as retry_module

    async def fast_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(retry_module.asyncio, "sleep", fast_sleep)

    fake_now = {"t": 0.0}
    monkeypatch.setattr(circuit_breaker_module.time, "monotonic", lambda: fake_now["t"])

    import app.llm.groq_client as module

    module = importlib.reload(module)
    yield module
    importlib.reload(module)
    get_settings.cache_clear()


_MESSAGES = [{"role": "user", "content": "hi"}]
_COMPLETION_BODY = {"choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}]}


def _with_client(queued_client: _QueuedFakeClient):
    return patch("app.llm.groq_client.httpx.AsyncClient", lambda **kwargs: queued_client)


async def test_retries_once_after_a_connection_failure_and_returns_the_eventual_success(groq_client) -> None:
    module = groq_client
    client = _QueuedFakeClient([httpx.ConnectError("refused"), _FakeResponse(200, _COMPLETION_BODY)])

    with _with_client(client):
        result = await module.create_chat_completion(_MESSAGES)

    assert result == _COMPLETION_BODY
    assert client.call_count == 2  # 1 initial + 1 retry


async def test_retries_once_after_a_connection_failure_then_still_fails(groq_client) -> None:
    module = groq_client
    client = _QueuedFakeClient([httpx.ConnectError("refused"), httpx.ConnectError("refused")])

    with _with_client(client):
        with pytest.raises(module.GroqClientError):
            await module.create_chat_completion(_MESSAGES)

    assert client.call_count == 2


async def test_does_not_retry_a_timeout(groq_client) -> None:
    module = groq_client
    client = _QueuedFakeClient([httpx.TimeoutException("timed out")])

    with _with_client(client):
        with pytest.raises(module.GroqClientError):
            await module.create_chat_completion(_MESSAGES)

    assert client.call_count == 1


async def test_does_not_retry_a_non_2xx_response(groq_client) -> None:
    module = groq_client
    client = _QueuedFakeClient([_FakeResponse(500, text="groq is down")])

    with _with_client(client):
        with pytest.raises(module.GroqClientError):
            await module.create_chat_completion(_MESSAGES)

    assert client.call_count == 1


async def test_circuit_trips_open_after_3_consecutive_failed_calls_then_fails_fast(groq_client) -> None:
    module = groq_client

    for _ in range(3):
        client = _QueuedFakeClient([httpx.ConnectError("refused"), httpx.ConnectError("refused")])
        with _with_client(client):
            with pytest.raises(module.GroqClientError):
                await module.create_chat_completion(_MESSAGES)

    never_called_client = _QueuedFakeClient([_FakeResponse(200, _COMPLETION_BODY)])
    with _with_client(never_called_client):
        with pytest.raises(module.GroqClientError, match="circuit breaker is open"):
            await module.create_chat_completion(_MESSAGES)

    assert never_called_client.call_count == 0


async def test_a_non_2xx_response_does_not_count_as_a_breaker_failure(groq_client) -> None:
    module = groq_client

    for _ in range(5):
        client = _QueuedFakeClient([_FakeResponse(503, text="busy")])
        with _with_client(client):
            with pytest.raises(module.GroqClientError):
                await module.create_chat_completion(_MESSAGES)

    success_client = _QueuedFakeClient([_FakeResponse(200, _COMPLETION_BODY)])
    with _with_client(success_client):
        result = await module.create_chat_completion(_MESSAGES)

    assert result == _COMPLETION_BODY
