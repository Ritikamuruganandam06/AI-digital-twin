"""
Unit tests for app/llm/groq_client.py with httpx mocked out -- no real
network call, no dependency on a real GROQ_API_KEY. These are the
automated, CI-safe tests (same pattern as tests/test_backend_client.py).

The actual "real completion returned from Groq" proof required by
docs/phases.md row 9 lives in tests/test_groq_client_live.py, which only
runs when a real GROQ_API_KEY is present in the environment.
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from app.config import get_settings
from app.llm.groq_client import GroqClientError, GroqConfigError, create_chat_completion, get_chat_reply

_MESSAGES = [{"role": "user", "content": "Say hello in one word."}]


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    """Settings are cached (lru_cache); each test needs a fresh read of its own env vars."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict:
        assert self._payload is not None
        return self._payload


class _FakeAsyncClient:
    def __init__(self, response: _FakeResponse | None = None, raise_error: Exception | None = None) -> None:
        self._response = response
        self._raise_error = raise_error

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        return False

    async def post(self, url: str, json: dict, headers: dict) -> _FakeResponse:
        if self._raise_error is not None:
            raise self._raise_error
        assert self._response is not None
        return self._response


def _fake_completion_payload(reply: str = "Hello!") -> dict:
    return {
        "id": "chatcmpl-test",
        "model": "llama-3.3-70b-versatile",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": reply}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
    }


@pytest.mark.asyncio
async def test_create_chat_completion_raises_config_error_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    # If this ever gets called despite the missing key, fail loudly rather
    # than silently sending a request with an empty Authorization header.
    def _must_not_be_called(**kwargs: object) -> None:
        raise AssertionError("httpx.AsyncClient should not be constructed without GROQ_API_KEY set")

    with patch("app.llm.groq_client.httpx.AsyncClient", _must_not_be_called):
        with pytest.raises(GroqConfigError):
            await create_chat_completion(_MESSAGES)


@pytest.mark.asyncio
async def test_create_chat_completion_returns_parsed_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    fake_payload = _fake_completion_payload("Hi there!")

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(200, fake_payload)),
    ):
        result = await create_chat_completion(_MESSAGES)

    assert result == fake_payload


@pytest.mark.asyncio
async def test_get_chat_reply_extracts_message_content(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    fake_payload = _fake_completion_payload("Hi there!")

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(200, fake_payload)),
    ):
        reply = await get_chat_reply(_MESSAGES)

    assert reply == "Hi there!"


@pytest.mark.asyncio
async def test_create_chat_completion_uses_configured_model_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "some-other-model")
    seen_payloads: list[dict] = []

    class _CapturingClient(_FakeAsyncClient):
        async def post(self, url: str, json: dict, headers: dict) -> _FakeResponse:
            seen_payloads.append(json)
            return await super().post(url, json, headers)

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _CapturingClient(response=_FakeResponse(200, _fake_completion_payload())),
    ):
        await create_chat_completion(_MESSAGES)

    assert seen_payloads[0]["model"] == "some-other-model"


@pytest.mark.asyncio
async def test_create_chat_completion_raises_on_connection_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(raise_error=httpx.ConnectError("connection refused")),
    ):
        with pytest.raises(GroqClientError):
            await create_chat_completion(_MESSAGES)


@pytest.mark.asyncio
async def test_create_chat_completion_raises_on_error_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "bad-key")

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(401, text='{"error":"invalid api key"}')),
    ):
        with pytest.raises(GroqClientError):
            await create_chat_completion(_MESSAGES)


@pytest.mark.asyncio
async def test_get_chat_reply_raises_on_unexpected_response_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(200, {"unexpected": "shape"})),
    ):
        with pytest.raises(GroqClientError):
            await get_chat_reply(_MESSAGES)


def _reasoning_model_payload(content: str, reasoning: str, finish_reason: str = "length") -> dict:
    """
    Shapes a response the way Groq's reasoning models (openai/gpt-oss-120b,
    openai/gpt-oss-20b) return one: the final answer in `message.content`
    and internal chain-of-thought in a separate `message.reasoning` field
    (console.groq.com/docs/reasoning), with `finish_reason: "length"` when
    the completion was truncated before -- or entirely instead of --
    reaching a final answer.
    """
    return {
        "id": "chatcmpl-test-reasoning",
        "model": "openai/gpt-oss-120b",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content, "reasoning": reasoning},
                "finish_reason": finish_reason,
            }
        ],
        "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
    }


@pytest.mark.asyncio
async def test_get_chat_reply_falls_back_to_reasoning_when_content_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    Regression test for the real bug hit against the live Groq API with
    LLM_MODEL=openai/gpt-oss-120b: a low max_tokens can be entirely
    consumed by the model's internal reasoning before it emits any final
    `content`, leaving `content` empty while `reasoning` has text. Silently
    returning "" in that case is what the earlier version of this function
    did.
    """
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    fake_payload = _reasoning_model_payload(content="", reasoning="Thinking about how to answer...")

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(200, fake_payload)),
    ):
        reply = await get_chat_reply(_MESSAGES)

    assert reply == "Thinking about how to answer..."


@pytest.mark.asyncio
async def test_get_chat_reply_falls_back_to_reasoning_content_field(monkeypatch: pytest.MonkeyPatch) -> None:
    """Some reasoning models/providers use `reasoning_content` instead of `reasoning` -- both are checked."""
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    fake_payload = {
        "choices": [
            {
                "message": {"role": "assistant", "content": "", "reasoning_content": "chain of thought here"},
                "finish_reason": "length",
            }
        ],
        "usage": {},
    }

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(200, fake_payload)),
    ):
        reply = await get_chat_reply(_MESSAGES)

    assert reply == "chain of thought here"


@pytest.mark.asyncio
async def test_get_chat_reply_prefers_content_over_reasoning_when_both_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A normal, non-truncated reasoning-model response: content is the real answer and wins."""
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    fake_payload = _reasoning_model_payload(content="pong", reasoning="internal thoughts", finish_reason="stop")

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(200, fake_payload)),
    ):
        reply = await get_chat_reply(_MESSAGES)

    assert reply == "pong"


@pytest.mark.asyncio
async def test_get_chat_reply_raises_when_content_and_reasoning_both_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    fake_payload = _reasoning_model_payload(content="", reasoning="", finish_reason="length")

    with patch(
        "app.llm.groq_client.httpx.AsyncClient",
        lambda **kwargs: _FakeAsyncClient(response=_FakeResponse(200, fake_payload)),
    ):
        with pytest.raises(GroqClientError, match="finish_reason"):
            await get_chat_reply(_MESSAGES)
