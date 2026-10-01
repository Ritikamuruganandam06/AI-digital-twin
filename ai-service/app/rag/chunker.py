
from __future__ import annotations

import re
from dataclasses import dataclass

CHUNK_SIZE_CHARS = 1000
CHUNK_OVERLAP_CHARS = 150


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    document_id: str
    source_path: str
    document_type: str
    related_service: str
    title: str
    updated: str
    text: str
    chunk_index: int


def _split_into_paragraphs(body: str) -> list[str]:
    """Splits on blank lines. A markdown header line stays attached to whatever paragraph follows it (there's never a blank line between a header and its content in this knowledge base's own documents), so a header never ends up alone in its own chunk."""
    return [block.strip() for block in re.split(r"\n\s*\n", body) if block.strip()]


def _split_oversized_paragraph(paragraph: str, max_len: int) -> list[str]:
    """Fallback for a single paragraph longer than max_len: pack sentences greedily up to max_len each, so chunking degrades gracefully instead of producing one oversized chunk."""
    sentences = re.split(r"(?<=[.!?])\s+", paragraph)
    pieces: list[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) > max_len and current:
            pieces.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces


def chunk_text(body: str, chunk_size: int = CHUNK_SIZE_CHARS, overlap: int = CHUNK_OVERLAP_CHARS) -> list[str]:
    """
    Packs paragraphs greedily into chunks up to `chunk_size` characters,
    carrying the trailing `overlap` characters of one chunk into the
    start of the next. Returns plain chunk text strings in document
    order -- metadata is attached by chunk_document() below.
    """
    if not body.strip():
        return []

    paragraphs: list[str] = []
    for para in _split_into_paragraphs(body):
        if len(para) > chunk_size:
            paragraphs.extend(_split_oversized_paragraph(para, chunk_size))
        else:
            paragraphs.append(para)

    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        candidate = f"{current}\n\n{para}" if current else para
        if len(candidate) > chunk_size and current:
            chunks.append(current)
            tail = current[-overlap:] if overlap > 0 else ""
            # Only carry the overlap tail forward if doing so still fits
            # within chunk_size -- `para` alone is already guaranteed to
            # fit (paragraphs longer than chunk_size were pre-split
            # above), but tail + para together might not be. Dropping the
            # tail for just this one boundary is a better trade than
            # silently exceeding the hard size cap.
            if tail and len(tail) + 2 + len(para) <= chunk_size:
                current = f"{tail}\n\n{para}".strip()
            else:
                current = para
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def chunk_document(
    *,
    document_id: str,
    source_path: str,
    document_type: str,
    related_service: str,
    title: str,
    updated: str,
    body: str,
) -> list[Chunk]:
    """Chunks one document's body text and attaches the full metadata schema to every resulting chunk."""
    return [
        Chunk(
            chunk_id=f"{document_id}#{i}",
            document_id=document_id,
            source_path=source_path,
            document_type=document_type,
            related_service=related_service,
            title=title,
            updated=updated,
            text=text,
            chunk_index=i,
        )
        for i, text in enumerate(chunk_text(body))
    ]
