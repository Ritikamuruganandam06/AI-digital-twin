"""
Groq chat-completion client (docs/phases.md row 9: "Groq client,
configurable model, basic chat completion").

Scope discipline: this module ONLY sends chat messages to Groq's Chat
Completions endpoint and returns the reply. It does not offer Groq any
tool schemas, does not decide when to call a tool, does not touch RAG/
Qdrant, and is not wired into the agent loop -- that orchestration starts
in Phase 10 (docs/architecture.md §8, §10). Per docs/architecture.md §9,
the LLM's job is strictly reasoning/explanation; it is never the source
of a simulation number or metric value, so nothing in this module (or
anywhere else in the AI service) manufactures application data -- it only
relays messages to Groq and returns what comes back.

Plain httpx against Groq's OpenAI-compatible REST API, the same style as
app/clients/backend_client.py, rather than adding the `groq` SDK as a
dependency for what is currently a single endpoint call (ground rule: no
unnecessary frameworks/dependencies).

Phase 16 wraps the network call with a retry (connection failures only,
never a timeout or a non-2xx -- same narrow scope as
app/tools/backend_tools_client.py's `_request()`) and a circuit breaker.
Groq is the clearest, most concrete justification of the three Phase 16
circuit-breaker application points: it is CONFIRMED blocked/unreachable
in this sandbox (see ai-service/README.md's "What could and couldn't be
verified here"), so a breaker here directly improves this sandbox's own
observed behavior -- every agent iteration that calls Groq while it's
down fails fast instead of each paying its own _REQUEST_TIMEOUT_SECONDS
wait.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings
from app.utils.circuit_breaker import CircuitBreaker, CircuitOpenError
from app.utils.retry import RetryOptions, with_retry

_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"
_REQUEST_TIMEOUT_SECONDS = 30.0
_DEFAULT_TEMPERATURE = 0.2

# One retry, a short fixed backoff -- same reasoning as
# backend_tools_client.py's _RETRY_OPTIONS: a second consecutive
# connection failure this close together means Groq (or the network path
# to it) is actually unreachable right now, not a one-off blip.
_RETRY_OPTIONS = RetryOptions(retries=1, base_delay_seconds=0.3, is_retryable=lambda exc: isinstance(exc, httpx.ConnectError))

# 3 consecutive failures trips the breaker; 30s cooldown before the next
# probe -- the same thresholds as the other two Phase 16 breakers
# (backend_tools_client.py, aiServiceClient.ts), for consistency rather
# than because Groq specifically demands a different number.
_groq_breaker = CircuitBreaker(failure_threshold=3, reset_timeout_seconds=30.0)


class GroqClientError(Exception):
    """Raised when a Groq chat-completion call fails for any reason."""


class GroqConfigError(GroqClientError):
    """Raised when GROQ_API_KEY isn't configured -- caught before any network call is made."""


async def create_chat_completion(
    messages: list[dict[str, Any]],
    *,
    model: str | None = None,
    temperature: float = _DEFAULT_TEMPERATURE,
    max_tokens: int | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Sends `messages` (OpenAI-style `[{"role": ..., "content": ...}, ...]`)
    to Groq's Chat Completions endpoint and returns the parsed JSON
    response unchanged.

    `model` overrides the configured `LLM_MODEL` for this one call; most
    callers should omit it and rely on the env-configured default (§9:
    "configured via LLM_MODEL, not hardcoded").

    `tools` (Phase 10) is an optional list of OpenAI/Groq-shaped function
    tool schemas (see app/tools/schemas.py) -- passed through unchanged so
    this module stays a plain, generic Groq client with no opinion about
    what a "tool" is; `tool_choice` (e.g. "auto") is forwarded alongside
    it. Both are simply omitted from the request payload when not given,
    which is exactly Phase 9's plain chat-completion behavior.

    Raises GroqConfigError if GROQ_API_KEY isn't set (never sends a
    request with a missing/empty key), or GroqClientError for any network
    failure or non-2xx response -- mirroring how
    app/clients/backend_client.py normalizes failures for its caller.
    """
    settings = get_settings()

    if not settings.groq_api_key:
        raise GroqConfigError(
            "GROQ_API_KEY is not set. Copy ai-service/.env.example to .env and set a real key "
            "from https://console.groq.com before calling the Groq client."
        )

    payload: dict[str, Any] = {
        "model": model or settings.llm_model,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if tools is not None:
        payload["tools"] = tools
    if tool_choice is not None:
        payload["tool_choice"] = tool_choice

    headers = {
        "Authorization": f"Bearer {settings.groq_api_key}",
        "Content-Type": "application/json",
    }

    async def _do_request() -> httpx.Response:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            return await client.post(_CHAT_COMPLETIONS_URL, json=payload, headers=headers)

    try:
        response = await _groq_breaker.execute(lambda: with_retry(_do_request, _RETRY_OPTIONS))
    except CircuitOpenError as exc:
        raise GroqClientError(
            f"Groq circuit breaker is open for {_CHAT_COMPLETIONS_URL} (too many recent failures) -- "
            "not attempting a network call"
        ) from exc
    except httpx.RequestError as exc:
        raise GroqClientError(f"Could not reach Groq at {_CHAT_COMPLETIONS_URL}: {exc}") from exc

    if response.status_code >= 400:
        # A non-2xx response is a real answer from Groq, not a
        # connectivity problem -- this runs after _groq_breaker.execute
        # has already recorded the call a success, so it's never retried
        # and never trips the breaker.
        raise GroqClientError(
            f"Groq returned HTTP {response.status_code} for model '{payload['model']}': "
            f"{response.text[:300]}"
        )

    return response.json()


async def get_chat_reply(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    temperature: float = _DEFAULT_TEMPERATURE,
    max_tokens: int | None = None,
) -> str:
    """
    Convenience wrapper: same as create_chat_completion, but returns just
    the assistant's reply text instead of the full response envelope.

    Reasoning models Groq hosts (e.g. openai/gpt-oss-120b,
    openai/gpt-oss-20b) put their final answer in `message.content` same
    as any other model, but return their internal chain-of-thought in a
    separate `message.reasoning` field (console.groq.com/docs/reasoning)
    rather than mixed into `content`. If the completion is truncated
    before the model reaches a final answer (`finish_reason == "length"`
    -- most often because the reasoning phase alone used up the whole
    token budget), `content` comes back as an empty string while
    `reasoning` holds whatever partial reasoning text was generated. A
    naive `message["content"]` read then silently returns "" instead of
    surfacing that. This falls back to `reasoning` (checking both the
    `reasoning` field GPT-OSS models use and `reasoning_content`, which
    some other reasoning models/providers use) when `content` is empty,
    and only raises if neither has anything -- with enough detail
    (`finish_reason`, token usage) to diagnose why.
    """
    completion = await create_chat_completion(
        messages, model=model, temperature=temperature, max_tokens=max_tokens
    )

    try:
        choice = completion["choices"][0]
        message = choice["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise GroqClientError(f"Unexpected Groq response shape: {completion}") from exc

    content = (message.get("content") or "").strip()
    if content:
        return content

    reasoning = (message.get("reasoning") or message.get("reasoning_content") or "").strip()
    if reasoning:
        return reasoning

    finish_reason = choice.get("finish_reason")
    raise GroqClientError(
        "Groq returned an empty message.content and no message.reasoning/"
        f"reasoning_content (finish_reason={finish_reason!r}, usage={completion.get('usage')!r}). "
        "For reasoning models this usually means max_tokens was too low for the "
        "model to finish reasoning before hitting the completion limit."
    )
