"""Tests for POST /agent/invoke with app.agent.loop.run_agent mocked -- the HTTP layer only."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.agent.loop import AgentResult, ToolCallStep
from app.main import app

client = TestClient(app)


def test_invoke_returns_the_agent_result_shape() -> None:
    fake_result = AgentResult(
        answer="Payment service is healthy.",
        steps=[ToolCallStep(tool_name="get_service", arguments={"serviceName": "payment-service"}, result={"result": {}})],
        iterations=2,
        stopped_reason="final_answer",
    )

    with patch("app.api.agent.run_agent", new=AsyncMock(return_value=fake_result)):
        response = client.post("/agent/invoke", json={"question": "Is payment-service healthy?"})

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "Payment service is healthy."
    assert body["iterations"] == 2
    assert body["stopped_reason"] == "final_answer"
    assert body["steps"][0]["tool_name"] == "get_service"


def test_invoke_rejects_an_empty_question() -> None:
    response = client.post("/agent/invoke", json={"question": "   "})
    assert response.status_code == 400


def test_invoke_rejects_a_missing_question_field() -> None:
    response = client.post("/agent/invoke", json={})
    assert response.status_code == 422  # FastAPI/pydantic validation error
