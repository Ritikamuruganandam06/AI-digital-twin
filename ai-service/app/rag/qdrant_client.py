
from __future__ import annotations

from functools import lru_cache
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from qdrant_client.http.exceptions import ApiException

from app.config import get_settings


class QdrantUnavailableError(Exception):
    """
    Raised whenever Qdrant can't be reached or returns an error --
    connection refused, DNS failure, timeout, or a non-2xx response from a
    reachable-but-erroring Qdrant. Every function below normalizes onto
    this one exception type, the same pattern `backend_client.py`
    (Phase 8) and `groq_client.py` (Phase 9) already established for
    their own external dependency.
    """


@lru_cache(maxsize=1)
def _get_client() -> QdrantClient:
    settings = get_settings()
    return QdrantClient(url=settings.qdrant_url)


def ensure_collection(vector_size: int) -> bool:
    """
    Creates the configured collection (QDRANT_COLLECTION) if it doesn't
    already exist, sized for `vector_size` (from
    app/rag/embedding.py's get_embedding_dimension()) with cosine
    distance -- the standard choice for normalized sentence-embedding
    models like BAAI/bge-small-en-v1.5. Returns True if the collection was
    just created, False if it already existed. Idempotent: safe to call
    on every startup/ingestion run, the same idempotent-by-design pattern
    `ensureTopics()` established for Kafka in Phase 5.
    """
    settings = get_settings()
    client = _get_client()
    try:
        if client.collection_exists(settings.qdrant_collection):
            return False
        client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=qmodels.VectorParams(size=vector_size, distance=qmodels.Distance.COSINE),
        )
        return True
    except ApiException as exc:
        raise QdrantUnavailableError(f"Could not reach Qdrant at {settings.qdrant_url}: {exc}") from exc


def upsert_points(points: list[dict[str, Any]]) -> int:
    """
    Upserts a batch of {"id", "vector", "payload"?} dicts into the
    configured collection. Returns the number of points written. `id` may
    be an int or a UUID string (Qdrant's own point-id rules); `payload` is
    optional free-form metadata (document id, chunk id, source path, ... --
    the metadata schema Phase 12 will actually populate).
    """
    if not points:
        return 0
    settings = get_settings()
    client = _get_client()
    try:
        client.upsert(
            collection_name=settings.qdrant_collection,
            points=[
                qmodels.PointStruct(id=p["id"], vector=p["vector"], payload=p.get("payload") or {})
                for p in points
            ],
        )
        return len(points)
    except ApiException as exc:
        raise QdrantUnavailableError(f"Could not reach Qdrant at {settings.qdrant_url}: {exc}") from exc


def search(query_vector: list[float], top_k: int = 5) -> list[dict[str, Any]]:
    """
    Vector similarity search against the configured collection. Returns up
    to `top_k` {"id", "score", "payload"} dicts, highest similarity first.
    """
    settings = get_settings()
    client = _get_client()
    try:
        results = client.query_points(
            collection_name=settings.qdrant_collection,
            query=query_vector,
            limit=top_k,
        ).points
        return [{"id": r.id, "score": r.score, "payload": r.payload} for r in results]
    except ApiException as exc:
        raise QdrantUnavailableError(f"Could not reach Qdrant at {settings.qdrant_url}: {exc}") from exc
