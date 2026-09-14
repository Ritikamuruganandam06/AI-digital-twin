"""
Tests for app/agent/loop.py with Groq and the tool executor both mocked
-- these verify the loop's control flow (when to call a tool, when to
stop, what it does at the iteration cap), not real Groq or backend
behavior (that's test_groq_client_live.py's and the manual live-agent
verification's job respectively).
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from app.agent.loop import run_agent
from app.config import get_settings
from app.llm.groq_client import GroqClientError


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _final_answer_completion(text: str) -> dict:
    return {
        "choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
    }


def _tool_call_completion(tool_name: str, arguments_json: str, call_id: str = "call_1") -> dict:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": tool_name, "arguments": arguments_json},
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
    }


@pytest.mark.asyncio
async def test_returns_final_answer_immediately_when_no_tool_call_is_made() -> None:
    with patch(
        "app.agent.loop.create_chat_completion",
        new=AsyncMock(return_value=_final_answer_completion("Everything is healthy.")),
    ):
        result = await run_agent("Is everything healthy?")

    assert result.answer == "Everything is healthy."
    assert result.steps == []
    assert result.iterations == 1
    assert result.stopped_reason == "final_answer"


@pytest.mark.asyncio
async def test_executes_a_tool_call_then_returns_the_next_final_answer() -> None:
    responses = [
        _tool_call_completion("get_services", '{}'),
        _final_answer_completion("There are 5 services, all healthy."),
    ]

    with (
        patch("app.agent.loop.create_chat_completion", new=AsyncMock(side_effect=responses)),
        patch(
            "app.agent.loop.execute_tool_call",
            new=AsyncMock(return_value={"result": [{"name": "order-service"}]}),
        ) as mocked_exec,
    ):
        result = await run_agent("List the services.")

    mocked_exec.assert_awaited_once_with("get_services", {})
    assert result.answer == "There are 5 services, all healthy."
    assert result.iterations == 2
    assert len(result.steps) == 1
    assert result.steps[0].tool_name == "get_services"
    assert result.steps[0].result == {"result": [{"name": "order-service"}]}
    assert result.stopped_reason == "final_answer"


@pytest.mark.asyncio
async def test_falls_back_to_reasoning_field_for_the_final_answer() -> None:
    """Reasoning models (openai/gpt-oss-*) can leave `content` empty -- same fallback as get_chat_reply()."""
    completion = {
        "choices": [
            {"message": {"role": "assistant", "content": "", "reasoning": "the answer is pong"}, "finish_reason": "stop"}
        ]
    }

    with patch("app.agent.loop.create_chat_completion", new=AsyncMock(return_value=completion)):
        result = await run_agent("ping?")

    assert result.answer == "the answer is pong"


@pytest.mark.asyncio
async def test_stops_at_the_iteration_limit_instead_of_looping_forever(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_MAX_ITERATIONS", "3")

    always_wants_a_tool_call = AsyncMock(return_value=_tool_call_completion("get_services", "{}"))

    with (
        patch("app.agent.loop.create_chat_completion", new=always_wants_a_tool_call),
        patch("app.agent.loop.execute_tool_call", new=AsyncMock(return_value={"result": []})),
    ):
        result = await run_agent("Keep investigating forever.")

    assert result.stopped_reason == "iteration_limit"
    assert result.iterations == 3
    assert always_wants_a_tool_call.await_count == 3
    assert len(result.steps) == 3


@pytest.mark.asyncio
async def test_a_groq_failure_is_returned_cleanly_not_raised() -> None:
    with patch(
        "app.agent.loop.create_chat_completion",
        new=AsyncMock(side_effect=GroqClientError("Groq returned HTTP 503")),
    ):
        result = await run_agent("Is everything healthy?")

    assert result.stopped_reason == "groq_error"
    assert "Groq" in result.answer


@pytest.mark.asyncio
async def test_malformed_tool_arguments_are_handled_without_crashing() -> None:
    responses = [
        _tool_call_completion("get_service", "{not valid json"),
        _final_answer_completion("Couldn't parse that, but here's what I know anyway."),
    ]

    with patch("app.agent.loop.create_chat_completion", new=AsyncMock(side_effect=responses)):
        result = await run_agent("Tell me about a service.")

    assert len(result.steps) == 1
    assert "error" in result.steps[0].result
    assert result.answer == "Couldn't parse that, but here's what I know anyway."


@pytest.mark.asyncio
async def test_each_step_gets_a_real_timestamp_in_call_order() -> None:
    """
    docs/architecture.md §16: persisted steps need "timestamps". Phase 14
    proof that ToolCallStep.timestamp is a genuine per-step capture time
    (parseable, monotonically non-decreasing across steps in one run) --
    not a placeholder the backend has to invent when it persists this.
    """
    responses = [
        _tool_call_completion("get_services", "{}", call_id="call_1"),
        _tool_call_completion("search_knowledge_base", '{"query": "recovery"}', call_id="call_2"),
        _final_answer_completion("Done."),
    ]

    with (
        patch("app.agent.loop.create_chat_completion", new=AsyncMock(side_effect=responses)),
        patch("app.agent.loop.execute_tool_call", new=AsyncMock(return_value={"result": []})),
    ):
        result = await run_agent("List services, then check the runbook.")

    assert len(result.steps) == 2
    timestamps = [datetime.fromisoformat(step.timestamp) for step in result.steps]
    assert timestamps[0] <= timestamps[1], "steps should be timestamped in the order they actually ran"
