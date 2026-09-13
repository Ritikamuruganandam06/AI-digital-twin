"""
Tests for app/tools/executor.py: dispatch, error handling (never raises),
and -- the important one -- that create_incident (PRIVILEGED_MUTATING)
never actually calls the mutating backend endpoint, no matter what
arguments it's given, while recommend_scaling (PRIVILEGED_SAFE) does
execute for real.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.clients.backend_client import BackendUnavailableError
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
