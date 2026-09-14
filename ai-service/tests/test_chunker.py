"""
Tests for app/rag/chunker.py. All pure-function tests -- no network, no
mocking needed. Includes a real run against this project's actual
`knowledge/` documents (not synthetic fixtures) since chunk_size/overlap
were justified specifically against their real shape.
"""

from __future__ import annotations

from pathlib import Path

from app.rag.chunker import CHUNK_OVERLAP_CHARS, CHUNK_SIZE_CHARS, chunk_document, chunk_text
from app.rag.loader import load_all_documents

_KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent.parent / "knowledge"


def test_short_text_produces_a_single_chunk() -> None:
    chunks = chunk_text("A short paragraph that fits easily in one chunk.")
    assert chunks == ["A short paragraph that fits easily in one chunk."]


def test_empty_text_produces_no_chunks() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []


def test_no_chunk_exceeds_the_configured_size() -> None:
    body = "\n\n".join(f"Paragraph number {i} with some real sentence content in it." for i in range(50))
    chunks = chunk_text(body, chunk_size=200, overlap=30)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 200


def test_consecutive_chunks_share_overlapping_content() -> None:
    body = "\n\n".join(f"Paragraph {i}: " + ("word " * 20) for i in range(10))
    chunks = chunk_text(body, chunk_size=150, overlap=50)
    assert len(chunks) > 1
    # The tail of one chunk should reappear at the head of the next --
    # that's what "overlap" means here.
    for prev, nxt in zip(chunks, chunks[1:]):
        tail = prev[-50:]
        assert tail in nxt, f"expected the previous chunk's tail to carry into the next chunk"


def test_a_paragraph_larger_than_chunk_size_is_split_on_sentence_boundaries() -> None:
    huge_paragraph = " ".join(f"This is sentence number {i}." for i in range(100))
    chunks = chunk_text(huge_paragraph, chunk_size=200, overlap=20)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 200
        # Every chunk should end on a real sentence boundary, not a
        # mid-word cut.
        assert chunk.rstrip().endswith(".")


def test_chunk_document_attaches_the_full_metadata_schema_to_every_chunk() -> None:
    chunks = chunk_document(
        document_id="runbooks/example",
        source_path="runbooks/example.md",
        document_type="runbooks",
        related_service="payment-service",
        title="Example Runbook",
        updated="2026-01-01",
        body="First paragraph.\n\nSecond paragraph.",
    )
    assert len(chunks) >= 1
    for i, chunk in enumerate(chunks):
        assert chunk.chunk_id == f"runbooks/example#{i}"
        assert chunk.document_id == "runbooks/example"
        assert chunk.source_path == "runbooks/example.md"
        assert chunk.document_type == "runbooks"
        assert chunk.related_service == "payment-service"
        assert chunk.title == "Example Runbook"
        assert chunk.updated == "2026-01-01"
        assert chunk.chunk_index == i


def test_chunking_the_real_knowledge_base_produces_sane_output() -> None:
    """
    The real proof this chunk_size/overlap justification is honest: run
    it against this project's actual 7 knowledge/ documents (not a
    synthetic fixture) and check the results are what the module
    docstring claims -- multiple chunks per document, nothing oversized,
    every chunk carrying real, non-empty content.
    """
    documents = load_all_documents(_KNOWLEDGE_ROOT)
    assert len(documents) == 7, (
        f"expected 7 real knowledge documents at {_KNOWLEDGE_ROOT}, found {len(documents)} -- "
        "has the knowledge base changed since this test was written?"
    )

    total_chunks = 0
    for doc in documents:
        chunks = chunk_document(
            document_id=doc.document_id,
            source_path=doc.source_path,
            document_type=doc.document_type,
            related_service=doc.related_service,
            title=doc.title,
            updated=doc.updated,
            body=doc.body,
        )
        assert len(chunks) >= 1, f"{doc.source_path} produced no chunks"
        for chunk in chunks:
            assert 0 < len(chunk.text) <= CHUNK_SIZE_CHARS
            assert chunk.text.strip() == chunk.text  # no leading/trailing whitespace left in
        total_chunks += len(chunks)

    # Every real document in this knowledge base is long enough to need
    # more than one chunk at CHUNK_SIZE_CHARS=1000 -- if this ever drops
    # to 1, either a document shrank a lot or chunking broke.
    assert total_chunks >= len(documents) * 2
