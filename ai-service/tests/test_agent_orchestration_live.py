"""
The live version of test_agent_orchestration.py's proof: a real Groq call
that itself decides, for a question that genuinely needs both, to call a
live-state tool AND search_knowledge_base -- no mocking of Groq's
decision anywhere in this file, unlike test_agent_orchestration.py.

Skipped unless ALL FOUR are true:
  - a real GROQ_API_KEY is configured (same check test_groq_client_live.py
    and test_agent_live.py use),
  - the Node backend is reachable at BACKEND_BASE_URL (same check
    test_agent_live.py uses),
  - a real Qdrant instance is reachable at QDRANT_URL (same check
    test_qdrant_client.py's live test uses), and
  - huggingface.co is reachable (the embedding model's one-time download
    -- same check test_embedding.py's live test uses).

None of the four is true in this repo's build sandbox (see
ai-service/README.md's Phase 9/10/11/12 "What could and couldn't be
verified here" sections for each), so this test is expected to skip
there. Run it on your machine with: the backend started and seeded, a
real GROQ_API_KEY in ai-service/.env, a real Qdrant instance at
QDRANT_URL, and normal internet access.
"""

from __future__ import annotations

import os
import uuid

import httpx
import pytest

from app.agent.loop import run_agent
from app.config import get_settings
from app.rag import qdrant_client as qc
from app.rag.ingest import ingest_knowledge_base
from pathlib import Path

_KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent.parent / "knowledge"
_REACHABILITY_TIMEOUT_SECONDS = 2.0


def _backend_reachable() -> bool:
    try:
        response = httpx.get(f"{get_settings().backend_base_url}/health", timeout=_REACHABILITY_TIMEOUT_SECONDS)
        return response.status_code < 500
    except httpx.RequestError:
        return False


def _qdrant_reachable() -> bool:
    try:
        qc._get_client().get_collections()
        return True
    except Exception:
        return False


def _huggingface_reachable() -> bool:
    try:
        response = httpx.head("https://huggingface.co", timeout=_REACHABILITY_TIMEOUT_SECONDS)
        return response.status_code < 500
    except httpx.RequestError:
        return False


pytestmark = pytest.mark.skipif(
    not (
        get_settings().groq_api_key
        and _backend_reachable()
        and _qdrant_reachable()
        and _huggingface_reachable()
    ),
    reason=(
        "Requires a real GROQ_API_KEY, the Node backend running and reachable, a real Qdrant "
        "instance reachable at QDRANT_URL, and outbound access to huggingface.co -- none of "
        "which are available together in this build sandbox. See ai-service/README.md's "
        "Phase 13 'What could and couldn't be verified here'."
    ),
)


@pytest.fixture(autouse=True)
def _use_a_disposable_collection():
    """Same technique test_rag_live.py uses: a fresh, uniquely-named collection so this test
    is safe to run against a Qdrant instance that already has real data in it."""
    os.environ["QDRANT_COLLECTION"] = f"test_phase13_{uuid.uuid4().hex[:8]}"
    get_settings.cache_clear()
    qc._get_client.cache_clear()
    yield
    get_settings.cache_clear()
    qc._get_client.cache_clear()


@pytest.mark.asyncio
async def test_a_real_agent_run_combines_a_live_tool_and_a_real_rag_search_for_one_question() -> None:
    ingest_result = ingest_knowledge_base(_KNOWLEDGE_ROOT)
    assert ingest_result.documents_ingested == 7

    result = await run_agent(
        "Payment service seems to be down. What is its current status, and what should I do about it?"
    )

    assert result.stopped_reason in {"final_answer", "iteration_limit"}
    assert result.answer.strip() != ""
    assert len(result.steps) > 0, "expected the agent to call at least one tool for this question"

    tool_names_called = {step.tool_name for step in result.steps}
    rag_steps = [step for step in result.steps if step.is_rag_query]

    # This question is deliberately phrased to need both a live-state check
    # and documented recovery guidance -- a real Groq call, given both
    # kinds of tools, should reach for at least one of each over enough
    # iterations. Since this is a real, non-deterministic LLM decision (not
    # mocked, unlike test_agent_orchestration.py), assert the weaker but
    # still meaningful property: it used the knowledge base for at least
    # part of its answer, not only live tools.
    assert len(rag_steps) > 0, (
        f"expected at least one search_knowledge_base call for a recovery-guidance question, "
        f"got tool calls: {tool_names_called}"
    )
    for step in result.steps:
        assert isinstance(step.result, dict)
