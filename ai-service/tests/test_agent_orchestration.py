"""
The real proof docs/phases.md row 13's verification column asks for:
"Test matrix of question types produces correct tool/RAG usage" -- one
test per row of docs/architecture.md §14's decision table:

| Question                                              | Decision      |
|--------------------------------------------------------|---------------|
| "What is the current Payment Service latency?"         | Tool only     |
| "What is the Payment Service recovery procedure?"       | RAG only      |
| "Payment Service is down. What should I do?"            | Tool + RAG    |
| "What happens if Payment Service fails?"                 | Simulation tool |
| "Explain what a circuit breaker is."                     | Neither       |

docs/architecture.md §14 is explicit that this decision is made by the
LLM itself via the tool-calling interface, not a separate hardcoded
classifier -- there is no decision function in this codebase to unit-test
directly. What these tests actually verify, since Groq is unreachable in
this build sandbox (no credentials -- see ai-service/README.md), is the
other half of the claim: that when Groq (mocked here to return the
decision a competent LLM would make for each question, standing in for
the real thing) calls a given tool, run_agent()/execute_tool_call()
route it correctly -- a live/simulation tool call reaches
backend_tools_client (would hit the real backend), search_knowledge_base
reaches app/rag/retriever.py directly (never the backend), a "tool + RAG"
question exercises both paths in the same run, and a "neither" question
never calls execute_tool_call at all. Only create_chat_completion is
mocked in every test below -- execute_tool_call, the dispatcher actually
under test, runs for real, with only its two leaf dependencies
(tools_client's backend calls, and the RAG retriever) mocked at the
boundary this sandbox can't reach.

The one live end-to-end version of this same proof -- a real Groq call
that itself decides tool vs RAG vs both -- is
test_agent_orchestration_live.py, gated on real Groq + backend + Qdrant +
HF access, expected to skip in this sandbox for the same reasons every
other live test in this project does.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agent.loop import run_agent
from app.config import get_settings
from app.rag.retriever import RetrievedChunk


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _final_answer_completion(text: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": "stop"}]}


def _tool_call_completion(tool_name: str, arguments_json: str, call_id: str = "call_1") -> dict:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {"id": call_id, "type": "function", "function": {"name": tool_name, "arguments": arguments_json}}
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ]
    }


_SAMPLE_CHUNK = RetrievedChunk(
    text="Step 1: confirm payment-service's health via get_service before doing anything else.",
    score=0.83,
    document_id="runbooks/payment-service-recovery",
    source_path="runbooks/payment-service-recovery.md",
    document_type="runbooks",
    related_service="payment-service",
    title="Payment Service Recovery Runbook",
    chunk_id="runbooks/payment-service-recovery#0",
)


@pytest.mark.asyncio
async def test_a_live_metrics_question_uses_a_tool_only_never_the_knowledge_base() -> None:
    """"What is the current Payment Service latency?" -> Tool only."""
    responses = [
        _tool_call_completion("get_service_metrics", '{"serviceName": "payment-service"}'),
        _final_answer_completion("Payment service's latest p99 latency is 240ms."),
    ]

    with (
        patch("app.agent.loop.create_chat_completion", new=AsyncMock(side_effect=responses)),
        patch(
            "app.tools.executor.tools_client.get_service_metrics",
            new=AsyncMock(return_value=[{"latencyMs": 240}]),
        ) as mocked_metrics,
        patch("app.tools.executor.retrieve_knowledge") as mocked_rag,
    ):
        result = await run_agent("What is the current Payment Service latency?")

    mocked_metrics.assert_awaited_once()
    mocked_rag.assert_not_called()
    assert len(result.steps) == 1
    assert result.steps[0].tool_name == "get_service_metrics"
    assert result.steps[0].is_rag_query is False
    assert result.stopped_reason == "final_answer"


@pytest.mark.asyncio
async def test_a_recovery_procedure_question_uses_rag_only_never_a_backend_tool() -> None:
    """"What is the Payment Service recovery procedure?" -> RAG only."""
    responses = [
        _tool_call_completion("search_knowledge_base", '{"query": "payment service recovery procedure"}'),
        _final_answer_completion("Per the payment-service recovery runbook: first confirm its health..."),
    ]

    with (
        patch("app.agent.loop.create_chat_completion", new=AsyncMock(side_effect=responses)),
        patch("app.tools.executor.retrieve_knowledge", return_value=[_SAMPLE_CHUNK]) as mocked_rag,
        patch("app.tools.executor.tools_client") as mocked_backend,
    ):
        result = await run_agent("What is the Payment Service recovery procedure?")

    mocked_rag.assert_called_once_with("payment service recovery procedure", 5)
    assert mocked_backend.method_calls == []
    assert len(result.steps) == 1
    assert result.steps[0].tool_name == "search_knowledge_base"
    assert result.steps[0].is_rag_query is True
    assert result.steps[0].result["results"][0]["documentId"] == "runbooks/payment-service-recovery"


@pytest.mark.asyncio
async def test_an_active_incident_question_uses_both_a_tool_and_rag_in_the_same_run() -> None:
    """"Payment Service is down. What should I do?" -> Tool + RAG."""
    responses = [
        _tool_call_completion("get_service", '{"serviceName": "payment-service"}', call_id="call_1"),
        _tool_call_completion("search_knowledge_base", '{"query": "payment service down recovery"}', call_id="call_2"),
        _final_answer_completion(
            "payment-service is currently unhealthy. Per the recovery runbook: first confirm its health..."
        ),
    ]

    with (
        patch("app.agent.loop.create_chat_completion", new=AsyncMock(side_effect=responses)),
        patch(
            "app.tools.executor.tools_client.get_service",
            new=AsyncMock(return_value={"name": "payment-service", "health": "unhealthy"}),
        ) as mocked_get_service,
        patch("app.tools.executor.retrieve_knowledge", return_value=[_SAMPLE_CHUNK]) as mocked_rag,
    ):
        result = await run_agent("Payment Service is down. What should I do?")

    mocked_get_service.assert_awaited_once_with("payment-service")
    mocked_rag.assert_called_once()
    assert len(result.steps) == 2
    assert result.steps[0].tool_name == "get_service"
    assert result.steps[0].is_rag_query is False
    assert result.steps[1].tool_name == "search_knowledge_base"
    assert result.steps[1].is_rag_query is True
    assert result.iterations == 3


@pytest.mark.asyncio
async def test_a_what_if_question_uses_the_deterministic_simulation_tool_not_rag() -> None:
    """"What happens if Payment Service fails?" -> Simulation tool."""
    responses = [
        _tool_call_completion("simulate_service_failure", '{"serviceName": "payment-service"}'),
        _final_answer_completion("If payment-service fails, order-service and notification-service cascade."),
    ]

    with (
        patch("app.agent.loop.create_chat_completion", new=AsyncMock(side_effect=responses)),
        patch(
            "app.tools.executor.tools_client.simulate_service_failure",
            new=AsyncMock(return_value={"affectedServices": ["order-service", "notification-service"]}),
        ) as mocked_sim,
        patch("app.tools.executor.retrieve_knowledge") as mocked_rag,
    ):
        result = await run_agent("What happens if Payment Service fails?")

    mocked_sim.assert_awaited_once_with("payment-service")
    mocked_rag.assert_not_called()
    assert len(result.steps) == 1
    assert result.steps[0].tool_name == "simulate_service_failure"
    assert result.steps[0].is_rag_query is False


@pytest.mark.asyncio
async def test_a_general_knowledge_question_uses_neither_tools_nor_rag() -> None:
    """"Explain what a circuit breaker is." -> Neither."""
    with (
        patch(
            "app.agent.loop.create_chat_completion",
            new=AsyncMock(
                return_value=_final_answer_completion(
                    "A circuit breaker stops calls to a failing dependency for a cooldown period..."
                )
            ),
        ),
        patch("app.tools.executor.tools_client") as mocked_backend,
        patch("app.tools.executor.retrieve_knowledge") as mocked_rag,
    ):
        result = await run_agent("Explain what a circuit breaker is.")

    assert mocked_backend.method_calls == []
    mocked_rag.assert_not_called()
    assert result.steps == []
    assert result.iterations == 1
    assert result.stopped_reason == "final_answer"
    assert "circuit breaker" in result.answer.lower()
