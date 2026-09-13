"""
The real "LLM calls a tool, tool hits real backend data, result returned"
proof docs/phases.md row 10's verification column asks for -- no mocking
anywhere in this file: a real call to Groq, which (if it decides to) makes
a real HTTP call through app/tools/backend_tools_client.py to a really
running Node backend, which (if its MongoDB is connected and seeded) reads
real data.

Skipped unless BOTH:
  - a real GROQ_API_KEY is configured (same check test_groq_client_live.py
    uses), and
  - the Node backend is actually reachable at BACKEND_BASE_URL right now.

Neither is true in this repo's build sandbox (no Groq credentials, and no
backend process running here), so this test is expected to skip there.
Run it on your machine with: the backend started (`npm start` or `npm run
dev` in backend/, ideally after `npm run seed` so tool calls return real
topology data instead of a 503), and a real GROQ_API_KEY in ai-service/.env.
"""

from __future__ import annotations

import httpx
import pytest

from app.agent.loop import run_agent
from app.config import get_settings

_BACKEND_HEALTH_CHECK_TIMEOUT_SECONDS = 2.0


def _backend_reachable() -> bool:
    try:
        response = httpx.get(
            f"{get_settings().backend_base_url}/health", timeout=_BACKEND_HEALTH_CHECK_TIMEOUT_SECONDS
        )
        return response.status_code < 500
    except httpx.RequestError:
        return False


pytestmark = pytest.mark.skipif(
    not get_settings().groq_api_key or not _backend_reachable(),
    reason=(
        "Requires both a real GROQ_API_KEY (ai-service/.env) and the Node backend running and "
        "reachable at BACKEND_BASE_URL -- set/start both to run this live end-to-end test."
    ),
)


@pytest.mark.asyncio
async def test_agent_calls_a_real_tool_against_the_real_backend() -> None:
    result = await run_agent("How many services are currently in the system, and are any of them unhealthy?")

    assert result.stopped_reason in {"final_answer", "iteration_limit"}
    assert len(result.steps) > 0, "expected the agent to call at least one real tool for this question"
    assert result.answer.strip() != ""

    # Every step's result really came from the backend (or a clean error
    # from it) -- never fabricated by this test.
    for step in result.steps:
        assert isinstance(step.result, dict)
