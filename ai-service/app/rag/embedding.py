

from __future__ import annotations

from functools import lru_cache

from fastembed import TextEmbedding

from app.config import get_settings

# Known output dimensions for fastembed's supported models, so
# get_embedding_dimension() doesn't need to embed a throwaway string (and
# therefore doesn't need the model downloaded/loaded) just to learn a
# number that's actually fixed per model. Extend this if EMBEDDING_MODEL
# is ever pointed at a different supported model.
_KNOWN_DIMENSIONS: dict[str, int] = {
    "BAAI/bge-small-en-v1.5": 384,
    "BAAI/bge-small-en": 384,
    "BAAI/bge-small-zh-v1.5": 512,
}


class EmbeddingError(Exception):
    """
    Raised when the embedding model can't be loaded (its one-time weight
    download failed -- e.g. blocked by an outbound network policy, the
    same failure mode `test_groq_client_live.py` and
    `mongodb-memory-server` have hit in this sandbox in earlier phases) or
    can't embed the given text.
    """


@lru_cache(maxsize=1)
def _get_model() -> TextEmbedding:
    """
    Loads (and, on first call, downloads) the configured embedding model.
    Cached for the life of the process -- loading it is comparatively
    expensive and its weights never change while the process is running.
    Tests patch this function directly rather than mocking fastembed's
    internals, the same "mock at the boundary" pattern
    `test_groq_client.py` uses for `httpx`.
    """
    settings = get_settings()
    try:
        return TextEmbedding(model_name=settings.embedding_model)
    except Exception as exc:  # fastembed/huggingface_hub raise a mix of exception types
        raise EmbeddingError(
            f"Could not load embedding model {settings.embedding_model!r}: {exc}"
        ) from exc


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embeds a batch of strings. Returns one vector (list[float]) per input string, same order."""
    if not texts:
        return []
    model = _get_model()
    try:
        return [vector.tolist() for vector in model.embed(texts)]
    except EmbeddingError:
        raise
    except Exception as exc:
        raise EmbeddingError(f"Embedding failed: {exc}") from exc


def embed_text(text: str) -> list[float]:
    """Convenience wrapper for a single string."""
    return embed_texts([text])[0]


def get_embedding_dimension() -> int:
    """
    The configured model's output vector size -- what
    qdrant_client.ensure_collection() needs to create/validate the
    collection with the right VectorParams.size.
    """
    settings = get_settings()
    if settings.embedding_model in _KNOWN_DIMENSIONS:
        return _KNOWN_DIMENSIONS[settings.embedding_model]
    # An EMBEDDING_MODEL this module doesn't have a known dimension for --
    # fall back to actually embedding a probe string rather than guessing.
    return len(embed_text("dimension probe"))
