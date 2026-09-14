"""
Tests for app/rag/ingest.py's orchestration logic, with embedding.py and
qdrant_client.py both mocked at their own boundary (the same "mock at the
seam, not the whole subsystem" pattern every other phase's tests use) --
these verify ingest_knowledge_base() calls the right things with the
right shapes, not real embedding/Qdrant behavior (that's
test_rag_live.py's job).
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from app.rag.ingest import _point_id_for, ingest_knowledge_base


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _make_knowledge_base(root: Path) -> None:
    _write(
        root / "runbooks" / "one.md",
        "---\ntitle: One\nrelated_service: payment-service\nupdated: 2026-01-01\n---\n\nFirst paragraph.\n\nSecond paragraph.",
    )
    _write(
        root / "incidents" / "two.md",
        "---\ntitle: Two\nrelated_service: order-service\nupdated: 2026-01-02\n---\n\nOnly one paragraph here.",
    )


def test_point_id_is_deterministic_for_the_same_chunk_id() -> None:
    first = _point_id_for("runbooks/example#0")
    second = _point_id_for("runbooks/example#0")
    assert first == second


def test_point_id_differs_for_different_chunk_ids() -> None:
    assert _point_id_for("runbooks/example#0") != _point_id_for("runbooks/example#1")


def test_ingest_embeds_every_chunk_and_upserts_with_full_payload(tmp_path: Path) -> None:
    _make_knowledge_base(tmp_path)

    fake_vectors = [[0.1, 0.2], [0.3, 0.4]]  # one per chunk (both docs are short enough to be 1 chunk each)

    with (
        patch("app.rag.ingest.embed_texts", return_value=fake_vectors) as mocked_embed,
        patch("app.rag.ingest.get_embedding_dimension", return_value=2),
        patch("app.rag.ingest.ensure_collection", return_value=True) as mocked_ensure,
        patch("app.rag.ingest.upsert_points", return_value=2) as mocked_upsert,
    ):
        result = ingest_knowledge_base(tmp_path)

    assert result.documents_ingested == 2
    assert result.chunks_upserted == 2
    assert result.collection_created is True

    mocked_embed.assert_called_once()
    embedded_texts = mocked_embed.call_args[0][0]
    assert len(embedded_texts) == 2

    mocked_ensure.assert_called_once_with(vector_size=2)

    mocked_upsert.assert_called_once()
    points = mocked_upsert.call_args[0][0]
    assert len(points) == 2
    for point in points:
        assert set(point["payload"].keys()) == {
            "chunk_id",
            "document_id",
            "source_path",
            "document_type",
            "related_service",
            "title",
            "updated",
            "text",
            "chunk_index",
        }
        assert point["id"] == _point_id_for(point["payload"]["chunk_id"])


def test_ingest_of_an_empty_knowledge_base_upserts_nothing(tmp_path: Path) -> None:
    with (
        patch("app.rag.ingest.embed_texts") as mocked_embed,
        patch("app.rag.ingest.ensure_collection") as mocked_ensure,
        patch("app.rag.ingest.upsert_points") as mocked_upsert,
    ):
        result = ingest_knowledge_base(tmp_path)

    assert result == type(result)(documents_ingested=0, chunks_upserted=0, collection_created=False)
    mocked_embed.assert_not_called()
    mocked_ensure.assert_not_called()
    mocked_upsert.assert_not_called()
