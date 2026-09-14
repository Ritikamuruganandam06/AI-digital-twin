"""
Splits a knowledge-base document's body text into overlapping chunks with
the metadata schema docs/architecture.md §12 calls for ("document id,
chunk id, source path, document type, related service, version/
timestamp"). This module only chunks already-loaded text; app/rag/loader.py
reads and parses the actual `knowledge/*.md` files (frontmatter, path-
derived metadata) that get passed in here.

## Chunk size and overlap, justified against this project's real documents

Every document in `knowledge/` (authored for Phase 12) is real: 7
markdown files across architecture/runbooks/incidents/troubleshooting,
each written as a sequence of short-to-medium paragraphs under markdown
headers -- the same shape a real internal engineering wiki page has, not
a handful of giant paragraphs and not one-sentence-per-paragraph either.
docs/architecture.md §12 is explicit that these numbers should be "chosen
and justified concretely in Phase 12, once real ... documents exist to
chunk" -- not picked arbitrarily in advance, so the justification below
is against these specific 7 documents' actual shape:

- **CHUNK_SIZE_CHARS = 1000** (roughly 150-200 words, 2-4 paragraphs of
  this knowledge base's typical paragraph length). Small enough that a
  retrieved chunk reads as a focused answer to one part of a question --
  the retrieval step feeds retrieved chunks directly into the LLM's
  context (docs/architecture.md §12's flow diagram), so a chunk the size
  of an entire runbook would waste context budget on mostly-irrelevant
  surrounding steps for every question that only needed one of them.
  Large enough that it holds a complete step or a complete paragraph of
  reasoning without truncating mid-thought for essentially every
  paragraph actually written in this knowledge base.
- **CHUNK_OVERLAP_CHARS = 150** (~15% of chunk size). These documents
  cross-reference themselves within a paragraph or two ("per Step 1's
  guidance...", "see the recovery runbook's Step 5...") -- a modest
  overlap gives a real chance that a cross-reference and the thing it
  refers to land in the same chunk, or at least in two adjacent chunks
  whose combined context still makes sense, instead of a hard,
  context-free cut between them. 150 characters carries roughly the last
  sentence or two of a paragraph forward without meaningfully inflating
  the total chunk count (overlap content is duplicated across chunks, so
  a much larger fraction here would trade precision for redundant
  storage and redundant embedding cost for little real benefit).
- **Chunking respects paragraph boundaries wherever possible** (packing
  whole paragraphs greedily up to CHUNK_SIZE_CHARS, never splitting
  inside one) rather than a blind fixed-width character cut -- so a chunk
  boundary essentially never falls mid-sentence for documents written in
  this project's own style. A paragraph longer than CHUNK_SIZE_CHARS on
  its own (none currently in `knowledge/`, but not guaranteed to stay
  that way as more documents are added) falls back to a sentence-boundary
  split so chunking never simply fails on an oversized paragraph.

Re-justify these numbers if `knowledge/`'s documents change shape
significantly (much longer/shorter paragraphs, code blocks, tables) --
they are a deliberate choice for *this* knowledge base, not a generic
default copied from a library.
"""

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
