"""
Tests for app/rag/retriever.py, with embedding.py and qdrant_client.py
both mocked -- verifies retrieve()'s own logic (score-threshold
filtering, RetrievedChunk mapping), not real embedding/search behavior
(that's test_rag_live.py's job).
"""

from __future__ import annotations

from unittest.mock import patch

from app.rag.retriever import retrieve


def _fake_result(chunk_id: str, score: float, text: str = "some chunk text") -> dict:
    return {
        "id": chunk_id,
        "score": score,
        "payload": {
            "chunk_id": chunk_id,
            "document_id": "runbooks/example",
            "source_path": "runbooks/example.md",
            "document_type": "runbooks",
            "related_service": "payment-service",
            "title": "Example",
            "text": text,
            "chunk_index": 0,
        },
    }


def test_retrieve_embeds_the_question_and_searches() -> None:
    with (
        patch("app.rag.retriever.embed_text", return_value=[0.1, 0.2, 0.3]) as mocked_embed,
        patch("app.rag.retriever.search", return_value=[_fake_result("a#0", 0.9)]) as mocked_search,
    ):
        results = retrieve("What do I do if payment-service is down?", top_k=3)

    mocked_embed.assert_called_once_with("What do I do if payment-service is down?")
    mocked_search.assert_called_once_with([0.1, 0.2, 0.3], top_k=3)
    assert len(results) == 1
    assert results[0].chunk_id == "a#0"
    assert results[0].score == 0.9
    assert results[0].related_service == "payment-service"


def test_retrieve_filters_out_results_below_the_score_threshold() -> None:
    with (
        patch("app.rag.retriever.embed_text", return_value=[0.0]),
        patch(
            "app.rag.retriever.search",
            return_value=[_fake_result("a#0", 0.9), _fake_result("b#0", 0.3), _fake_result("c#0", 0.51)],
        ),
    ):
        results = retrieve("question", score_threshold=0.5)

    returned_ids = [r.chunk_id for r in results]
    assert returned_ids == ["a#0", "c#0"]  # 0.3 filtered out, order preserved otherwise


def test_retrieve_returns_an_empty_list_when_nothing_clears_the_threshold() -> None:
    with (
        patch("app.rag.retriever.embed_text", return_value=[0.0]),
        patch("app.rag.retriever.search", return_value=[_fake_result("a#0", 0.1)]),
    ):
        results = retrieve("an unrelated question", score_threshold=0.5)

    assert results == []
