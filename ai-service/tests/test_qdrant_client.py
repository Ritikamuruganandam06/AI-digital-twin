"""
Tests for app/rag/qdrant_client.py.

test_functions_raise_a_clean_error_when_qdrant_is_unreachable is a REAL,
unmocked negative proof -- it points QDRANT_URL at 127.0.0.1:1 (a port
nothing listens on, the exact technique backend/tests/kafka.negative.test.ts
already uses for Kafka in Phase 5) and asserts a real connection attempt
fails cleanly into QdrantUnavailableError. No server, no mocking, no
network beyond localhost -- this passes in any sandbox.

test_embed_upsert_search_round_trip_against_a_real_qdrant_instance is
docs/phases.md row 11's actual verification requirement ("Embed -> upsert
-> search round-trip verified"). It talks to a REAL Qdrant instance at
QDRANT_URL and is skipped when one isn't reachable there -- this sandbox
has no way to run a Qdrant server (no Docker per project rules, and both
a prebuilt binary download and a package registry that could provide one
are blocked by this sandbox's own egress policy; see README). Start a
real Qdrant (binary or local server, per the root README's prerequisites)
at QDRANT_URL and re-run this file to get that proof on your machine.
"""

from __future__ import annotations

import os
import uuid

import pytest
from qdrant_client.http.exceptions import ApiException

from app.config import get_settings
from app.rag import qdrant_client as qc
from app.rag.embedding import embed_texts, get_embedding_dimension


def _qdrant_reachable() -> bool:
    try:
        qc._get_client().get_collections()
        return True
    except ApiException:
        return False
    except Exception:
        return False


@pytest.fixture(autouse=True)
def _clear_caches():
    get_settings.cache_clear()
    qc._get_client.cache_clear()
    yield
    get_settings.cache_clear()
    qc._get_client.cache_clear()


def test_functions_raise_a_clean_error_when_qdrant_is_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QDRANT_URL", "http://127.0.0.1:1")
    get_settings.cache_clear()
    qc._get_client.cache_clear()

    with pytest.raises(qc.QdrantUnavailableError, match="Could not reach Qdrant"):
        qc.ensure_collection(vector_size=384)

    with pytest.raises(qc.QdrantUnavailableError, match="Could not reach Qdrant"):
        qc.upsert_points([{"id": 1, "vector": [0.0] * 384}])

    with pytest.raises(qc.QdrantUnavailableError, match="Could not reach Qdrant"):
        qc.search([0.0] * 384)


@pytest.mark.skipif(
    not _qdrant_reachable(),
    reason=(
        "Requires a real Qdrant instance reachable at QDRANT_URL (default "
        "http://localhost:6333) -- not available in this sandbox (no Docker; "
        "a prebuilt binary download and package-registry install are both "
        "blocked by this sandbox's own egress policy). Start a real Qdrant "
        "on your machine and re-run to get docs/phases.md row 11's real "
        "embed -> upsert -> search round-trip proof."
    ),
)
def test_embed_upsert_search_round_trip_against_a_real_qdrant_instance() -> None:
    """
    The real proof: embed real text (app/rag/embedding.py), upsert the
    resulting vectors into a real Qdrant collection, and search with a
    query vector for a related sentence -- the nearest result should be
    the semantically closest point, by id, not just "a" result.
    """
    dimension = get_embedding_dimension()
    # A fresh, disposable collection per test run so this is safe to run
    # against a Qdrant instance that also has real data in it.
    os.environ["QDRANT_COLLECTION"] = f"test_phase11_{uuid.uuid4().hex[:8]}"
    get_settings.cache_clear()
    qc._get_client.cache_clear()

    corpus = {
        "payment": "The payment service is currently experiencing a full outage.",
        "order": "The order service successfully processed the request.",
        "weather": "It is sunny and warm in Paris today.",
    }
    ids = {"payment": 1, "order": 2, "weather": 3}
    vectors = embed_texts(list(corpus.values()))

    created = qc.ensure_collection(vector_size=dimension)
    assert created is True

    written = qc.upsert_points(
        [
            {"id": ids[key], "vector": vector, "payload": {"text": text}}
            for (key, text), vector in zip(corpus.items(), vectors)
        ]
    )
    assert written == 3

    query_vector = embed_texts(["Payment service is down."])[0]
    results = qc.search(query_vector, top_k=1)

    assert len(results) == 1
    assert results[0]["id"] == ids["payment"], (
        f"expected the payment-outage sentence to rank first for a payment-outage query, "
        f"got id={results[0]['id']!r} ({results[0]['payload']})"
    )
