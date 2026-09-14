"""
Tests for app/tools/executor.py: dispatch, error handling (never raises),
and -- the important one -- that create_incident (PRIVILEGED_MUTATING)
never actually calls the mutating backend endpoint, no matter what
arguments it's given, while recommend_scaling (PRIVILEGED_SAFE) does
execute for real. Also (Phase 13) search_knowledge_base, which -- unlike
every other tool here -- never calls tools_client/the backend at all.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.clients.backend_client import BackendUnavailableError
from app.rag.embedding import EmbeddingError
from app.rag.qdrant_client import QdrantUnavailableError
from app.rag.retriever import RetrievedChunk
from app.tools.executor import execute_tool_call, get_tool_privilege
from app.tools.schemas import PrivilegeTier


@pytest.mark.asyncio
async def test_dispatches_a_simple_read_only_tool() -> None:
    with patch(
        "app.tools.executor.tools_client.get_services", new=AsyncMock(return_value=[{"name": "order-service"}])
    ):
        result = await execute_tool_call("get_services", {})

    assert result == {"result": [{"name": "order-service"}]}


@pytest.mark.asyncio
async def test_dispatches_a_tool_requiring_arguments() -> None:
    with patch(
        "app.tools.executor.tools_client.get_service", new=AsyncMock(return_value={"name": "payment-service"})
    ) as mocked:
        result = await execute_tool_call("get_service", {"serviceName": "payment-service"})

    mocked.assert_awaited_once_with("payment-service")
    # Already a dict, so execute_tool_call returns it unwrapped (only a
    # non-dict result, like a list, gets wrapped in {"result": ...}).
    assert result == {"name": "payment-service"}


@pytest.mark.asyncio
async def test_unknown_tool_name_returns_error_without_raising() -> None:
    result = await execute_tool_call("not_a_real_tool", {})
    assert "error" in result


@pytest.mark.asyncio
async def test_missing_required_argument_returns_error_without_raising() -> None:
    result = await execute_tool_call("get_service", {})  # missing serviceName
    assert "error" in result
    assert "get_service" in result["error"]


@pytest.mark.asyncio
async def test_backend_unavailable_becomes_a_structured_error_not_an_exception() -> None:
    with patch(
        "app.tools.executor.tools_client.get_services",
        new=AsyncMock(side_effect=BackendUnavailableError("backend is down")),
    ):
        result = await execute_tool_call("get_services", {})

    assert "error" in result
    assert "backend is down" in result["error"]


@pytest.mark.asyncio
async def test_recommend_scaling_is_privileged_safe_and_executes_for_real() -> None:
    assert get_tool_privilege("recommend_scaling") == PrivilegeTier.PRIVILEGED_SAFE

    with patch(
        "app.tools.executor.tools_client.recommend_scaling",
        new=AsyncMock(return_value={"recommendation": "scale_out"}),
    ) as mocked:
        result = await execute_tool_call("recommend_scaling", {"serviceName": "payment-service"})

    mocked.assert_awaited_once_with("payment-service")
    assert result == {"recommendation": "scale_out"}


@pytest.mark.asyncio
async def test_create_incident_is_privileged_mutating_and_never_calls_the_real_backend() -> None:
    """
    The core Phase 10 privilege guarantee (docs/architecture.md §10): "the
    agent can *propose* one but cannot silently execute it." Regardless of
    what arguments the LLM supplies, tools_client.create_incident (the
    function that would actually write to MongoDB) must never be called
    from inside execute_tool_call.
    """
    assert get_tool_privilege("create_incident") == PrivilegeTier.PRIVILEGED_MUTATING

    with patch("app.tools.executor.tools_client.create_incident", new=AsyncMock()) as mocked:
        result = await execute_tool_call(
            "create_incident",
            {
                "title": "Payment errors spiking",
                "description": "5xx rate jumped after a deploy.",
                "serviceName": "payment-service",
                "severity": "high",
            },
        )

    mocked.assert_not_awaited()
    assert result["status"] == "PROPOSED_NOT_EXECUTED"
    assert result["proposedIncident"]["serviceName"] == "payment-service"


@pytest.mark.asyncio
async def test_search_knowledge_base_is_its_own_privilege_tier_and_never_touches_the_backend() -> None:
    assert get_tool_privilege("search_knowledge_base") == PrivilegeTier.KNOWLEDGE_RETRIEVAL

    fake_chunks = [
        RetrievedChunk(
            text="Step 1: confirm payment-service's health via get_service.",
            score=0.81,
            document_id="runbooks/payment-service-recovery",
            source_path="runbooks/payment-service-recovery.md",
            document_type="runbooks",
            related_service="payment-service",
            title="Payment Service Recovery Runbook",
            chunk_id="runbooks/payment-service-recovery#0",
        )
    ]

    with (
        patch("app.tools.executor.retrieve_knowledge", return_value=fake_chunks) as mocked,
        patch("app.tools.executor.tools_client") as mocked_backend,
    ):
        result = await execute_tool_call("search_knowledge_base", {"query": "payment service recovery", "topK": 3})

    # Called with the RAG retriever directly, in a thread (asyncio.to_thread)
    # -- and the backend HTTP client was never touched for this tool.
    mocked.assert_called_once_with("payment service recovery", 3)
    assert mocked_backend.method_calls == []

    assert result["query"] == "payment service recovery"
    assert result["resultCount"] == 1
    assert result["results"][0]["documentId"] == "runbooks/payment-service-recovery"
    assert result["results"][0]["relatedService"] == "payment-service"
    assert result["results"][0]["score"] == 0.81


@pytest.mark.asyncio
async def test_search_knowledge_base_defaults_topk_to_five() -> None:
    with patch("app.tools.executor.retrieve_knowledge", return_value=[]) as mocked:
        result = await execute_tool_call("search_knowledge_base", {"query": "kafka consumer lag"})

    mocked.assert_called_once_with("kafka consumer lag", 5)
    assert result["resultCount"] == 0
    assert result["results"] == []


@pytest.mark.asyncio
async def test_search_knowledge_base_missing_query_returns_error_without_raising() -> None:
    result = await execute_tool_call("search_knowledge_base", {})
    assert "error" in result
    assert "search_knowledge_base" in result["error"]


@pytest.mark.asyncio
async def test_qdrant_unavailable_during_search_becomes_a_structured_error_not_an_exception() -> None:
    with patch(
        "app.tools.executor.retrieve_knowledge",
        side_effect=QdrantUnavailableError("Could not reach Qdrant at http://localhost:6333"),
    ):
        result = await execute_tool_call("search_knowledge_base", {"query": "redis failure"})

    assert "error" in result
    assert "Knowledge base search failed" in result["error"]


@pytest.mark.asyncio
async def test_embedding_failure_during_search_becomes_a_structured_error_not_an_exception() -> None:
    with patch(
        "app.tools.executor.retrieve_knowledge",
        side_effect=EmbeddingError("Could not load embedding model 'BAAI/bge-small-en-v1.5'"),
    ):
        result = await execute_tool_call("search_knowledge_base", {"query": "redis failure"})

    assert "error" in result
    assert "Knowledge base search failed" in result["error"]
