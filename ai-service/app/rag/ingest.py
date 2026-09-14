"""
Ties loader.py + chunker.py + embedding.py + qdrant_client.py together:
walks `knowledge/`, chunks every document, embeds every chunk, and
upserts the results into Qdrant. This is docs/phases.md row 12's
"knowledge/ documents ingested" half; retriever.py is the "retriever"
half that reads what this writes.

Run directly (from ai-service/, with the venv active):

    python -m app.rag.ingest

See ai-service/README.md's Phase 12 section for what this requires (a
real Qdrant instance at QDRANT_URL, and outbound access to
huggingface.co for the embedding model's one-time weight download) and
what happened when it was run in this project's build sandbox, where
neither is reachable.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from app.rag.chunker import Chunk, chunk_document
from app.rag.embedding import embed_texts, get_embedding_dimension
from app.rag.loader import load_all_documents
from app.rag.qdrant_client import ensure_collection, upsert_points

# A fixed namespace so the same chunk_id always maps to the same Qdrant
# point id across separate ingestion runs -- re-running ingestion after
# editing a document UPDATES that document's points in place (Qdrant's
# upsert semantics) instead of creating duplicates alongside stale ones.
_POINT_ID_NAMESPACE = uuid.UUID("6f2f9f2e-2b8a-4f0e-9a7a-1f8f8a9c9a0a")


@dataclass(frozen=True)
class IngestResult:
    documents_ingested: int
    chunks_upserted: int
    collection_created: bool


def _point_id_for(chunk_id: str) -> str:
    return str(uuid.uuid5(_POINT_ID_NAMESPACE, chunk_id))


def _chunks_to_points(chunks: list[Chunk], vectors: list[list[float]]) -> list[dict]:
    return [
        {
            "id": _point_id_for(chunk.chunk_id),
            "vector": vector,
            "payload": {
                "chunk_id": chunk.chunk_id,
                "document_id": chunk.document_id,
                "source_path": chunk.source_path,
                "document_type": chunk.document_type,
                "related_service": chunk.related_service,
                "title": chunk.title,
                "updated": chunk.updated,
                "text": chunk.text,
                "chunk_index": chunk.chunk_index,
            },
        }
        for chunk, vector in zip(chunks, vectors)
    ]


def ingest_knowledge_base(knowledge_root: Path) -> IngestResult:
    """Loads every document under `knowledge_root`, chunks, embeds, and upserts all of them into Qdrant. Safe to re-run (idempotent point ids)."""
    documents = load_all_documents(knowledge_root)

    all_chunks: list[Chunk] = []
    for doc in documents:
        all_chunks.extend(
            chunk_document(
                document_id=doc.document_id,
                source_path=doc.source_path,
                document_type=doc.document_type,
                related_service=doc.related_service,
                title=doc.title,
                updated=doc.updated,
                body=doc.body,
            )
        )

    if not all_chunks:
        return IngestResult(documents_ingested=len(documents), chunks_upserted=0, collection_created=False)

    vectors = embed_texts([chunk.text for chunk in all_chunks])
    created = ensure_collection(vector_size=get_embedding_dimension())
    written = upsert_points(_chunks_to_points(all_chunks, vectors))

    return IngestResult(documents_ingested=len(documents), chunks_upserted=written, collection_created=created)


def _default_knowledge_root() -> Path:
    # ai-service/app/rag/ingest.py -> repo root -> knowledge/
    return Path(__file__).resolve().parent.parent.parent.parent / "knowledge"


if __name__ == "__main__":
    result = ingest_knowledge_base(_default_knowledge_root())
    print(
        f"Ingested {result.documents_ingested} document(s) into "
        f"{result.chunks_upserted} chunk(s) "
        f"(collection {'created' if result.collection_created else 'already existed'})."
    )
