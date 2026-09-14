"""
The real proof docs/phases.md row 12 asks for: "Question -> relevant
chunks retrieved, with justified chunk size/overlap". No mocking anywhere
in this file -- real documents, a real (locally-run) embedding model, and
a real Qdrant instance.

Skipped unless BOTH:
  - huggingface.co is reachable (the embedding model's one-time weight
    download -- same check test_embedding.py's live test uses), and
  - a real Qdrant instance is reachable at QDRANT_URL (same check
    test_qdrant_client.py's live test uses).

Neither is true in this repo's build sandbox (this sandbox's own egress
proxy blocks huggingface.co, and there's no Qdrant instance reachable --
see ai-service/README.md's Phase 12 "What could and couldn't be verified
here"), so this test is expected to skip there. Run it on your machine
with a real Qdrant instance at QDRANT_URL and normal internet access to
get this phase's actual verification proof.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import httpx
import pytest

from app.config import get_settings
from app.rag import qdrant_client as qc
from app.rag.ingest import ingest_knowledge_base
from app.rag.retriever import retrieve

_KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent.parent / "knowledge"
_HF_REACHABILITY_TIMEOUT_SECONDS = 5.0


def _huggingface_reachable() -> bool:
    try:
        response = httpx.head("https://huggingface.co", timeout=_HF_REACHABILITY_TIMEOUT_SECONDS)
        return response.status_code < 500
    except httpx.RequestError:
        return False


def _qdrant_reachable() -> bool:
    try:
        qc._get_client().get_collections()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not (_huggingface_reachable() and _qdrant_reachable()),
    reason=(
        "Requires BOTH outbound access to huggingface.co (the embedding model's "
        "one-time download) and a real Qdrant instance reachable at QDRANT_URL -- "
        "neither is available in this build sandbox. See ai-service/README.md's "
        "Phase 12 'What could and couldn't be verified here'."
    ),
)


@pytest.fixture(autouse=True)
def _use_a_disposable_collection():
    """A fresh, uniquely-named collection per test run -- safe against a Qdrant instance that already has real data in it, same technique test_qdrant_client.py's live test uses."""
    os.environ["QDRANT_COLLECTION"] = f"test_phase12_{uuid.uuid4().hex[:8]}"
    get_settings.cache_clear()
    qc._get_client.cache_clear()
    yield
    get_settings.cache_clear()
    qc._get_client.cache_clear()


def test_ingest_the_real_knowledge_base_then_retrieve_relevant_chunks_for_real_questions() -> None:
    result = ingest_knowledge_base(_KNOWLEDGE_ROOT)

    assert result.documents_ingested == 7
    assert result.chunks_upserted > 7  # every document produces more than one chunk (see test_chunker.py)
    assert result.collection_created is True

    # A question that should clearly retrieve the payment-service recovery runbook.
    payment_results = retrieve("What should I do if payment-service is down or degraded?", top_k=3)
    assert len(payment_results) > 0, "expected at least one relevant chunk for a payment-service question"
    assert any(r.related_service == "payment-service" for r in payment_results), (
        f"expected a payment-service-related chunk in the results, got: "
        f"{[(r.document_id, r.related_service, r.score) for r in payment_results]}"
    )

    # A question that should clearly retrieve the Kafka consumer runbook,
    # not the payment-service one -- proves retrieval discriminates
    # between documents, not just "returns something."
    kafka_results = retrieve("A published Kafka message never shows up on the consumer side, what do I check?", top_k=3)
    assert len(kafka_results) > 0, "expected at least one relevant chunk for a Kafka consumer question"
    assert any(r.document_id == "runbooks/kafka-consumer-recovery" for r in kafka_results), (
        f"expected the Kafka consumer recovery runbook in the results, got: "
        f"{[(r.document_id, r.score) for r in kafka_results]}"
    )

    # A question with no real answer in this knowledge base should not
    # force a confident-looking but meaningless match past the relevance
    # filter.
    unrelated_results = retrieve("What is the best recipe for chocolate chip cookies?", top_k=3)
    assert unrelated_results == [] or all(r.score < 0.7 for r in unrelated_results), (
        f"expected no high-confidence match for a completely unrelated question, got: "
        f"{[(r.document_id, r.score) for r in unrelated_results]}"
    )
