"""
Tests for app/rag/loader.py. Pure-function tests using tmp_path-created
fixture files (isolated and deterministic) plus one real run against
this project's actual `knowledge/` documents.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.rag.loader import DocumentParseError, load_all_documents, load_document

_KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent.parent / "knowledge"


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_parses_frontmatter_and_derives_metadata_from_path(tmp_path: Path) -> None:
    doc_path = tmp_path / "runbooks" / "example.md"
    _write(
        doc_path,
        "---\ntitle: Example Runbook\nrelated_service: payment-service\nupdated: 2026-01-01\n---\n\n# Example\n\nBody text.",
    )

    doc = load_document(doc_path, tmp_path)

    assert doc.document_id == "runbooks/example"
    assert doc.source_path == "runbooks/example.md"
    assert doc.document_type == "runbooks"  # derived from the folder, not frontmatter
    assert doc.related_service == "payment-service"
    assert doc.title == "Example Runbook"
    assert doc.updated == "2026-01-01"
    assert doc.body == "# Example\n\nBody text."


def test_missing_opening_delimiter_raises_document_parse_error(tmp_path: Path) -> None:
    doc_path = tmp_path / "runbooks" / "bad.md"
    _write(doc_path, "title: Example\n---\n\nBody")

    with pytest.raises(DocumentParseError, match="opening"):
        load_document(doc_path, tmp_path)


def test_missing_closing_delimiter_raises_document_parse_error(tmp_path: Path) -> None:
    doc_path = tmp_path / "runbooks" / "bad.md"
    _write(doc_path, "---\ntitle: Example\n\nBody with no closing delimiter")

    with pytest.raises(DocumentParseError, match="closing"):
        load_document(doc_path, tmp_path)


def test_missing_required_field_raises_document_parse_error(tmp_path: Path) -> None:
    doc_path = tmp_path / "runbooks" / "incomplete.md"
    _write(doc_path, "---\ntitle: Example\n---\n\nBody")  # missing related_service, updated

    with pytest.raises(DocumentParseError, match="missing required frontmatter field"):
        load_document(doc_path, tmp_path)


def test_load_all_documents_skips_the_top_level_readme(tmp_path: Path) -> None:
    _write(tmp_path / "README.md", "# Not a knowledge document\n\nJust describes the folder.")
    _write(
        tmp_path / "runbooks" / "real-doc.md",
        "---\ntitle: Real\nrelated_service: all\nupdated: 2026-01-01\n---\n\nBody.",
    )

    docs = load_all_documents(tmp_path)

    assert len(docs) == 1
    assert docs[0].document_id == "runbooks/real-doc"


def test_load_all_documents_against_the_real_knowledge_base() -> None:
    """The real proof: this project's actual 7 knowledge/ documents all parse cleanly."""
    docs = load_all_documents(_KNOWLEDGE_ROOT)

    assert len(docs) == 7
    document_types = {doc.document_type for doc in docs}
    assert document_types == {"architecture", "runbooks", "incidents", "troubleshooting"}
    for doc in docs:
        assert doc.title
        assert doc.related_service
        assert doc.updated
        assert doc.body
