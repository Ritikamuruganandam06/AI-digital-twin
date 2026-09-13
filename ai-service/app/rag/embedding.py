"""
Turns text into vectors -- one of the two distinct components Phase 11
(docs/phases.md row 11: "Qdrant client, embedding pipeline") builds.
docs/architecture.md §13 is explicit these are separate concerns: "The
embedding model and Qdrant are distinct components -- the embedding model
turns text into vectors; Qdrant stores and searches those vectors." This
module is only the first half; app/rag/qdrant_client.py is the second.

Chunking a real knowledge/ corpus and wiring this into the agent's
retrieval decision are explicitly NOT this phase's job -- docs/phases.md
row 12 ("RAG ingestion and retrieval") and docs/architecture.md §12 both
say chunk size/overlap/metadata are "chosen and justified concretely in
Phase 12, once real runbook/incident documents exist to chunk", and row
13 ("Agent + Tools + RAG orchestration") is what decides *when* to call
this at all. This phase proves only: text in, a real vector out, and a
real Qdrant round-trip using that vector (see qdrant_client.py).

## Why fastembed + BAAI/bge-small-en-v1.5, not sentence-transformers or a
   paid embedding API

- **fastembed, not sentence-transformers.** Both are legitimate; fastembed
  runs on ONNX Runtime (CPU-only, no PyTorch), so `pip install fastembed`
  pulls in ~100MB of ONNX/tokenizer dependencies instead of PyTorch's
  multi-hundred-MB CUDA-capable wheel this project has no GPU to use
  anyway. It's also the library Qdrant's own client documents as its
  reference integration for exactly this "embed text, upsert to Qdrant"
  pipeline shape.
- **Not a paid embedding API (OpenAI, Cohere, Voyage, ...).** That would
  mean a second paid-API credential alongside GROQ_API_KEY for a
  capability (turning text into a fixed-size vector) that a small local
  model handles perfectly well, and it would make Phase 11's own
  verification (embed -> upsert -> search) depend on a second network
  boundary and a second billing relationship for no real benefit at this
  project's scale.
- **BAAI/bge-small-en-v1.5 specifically.** A well-established general
  English embedding model, small enough (~130MB) to be a reasonable
  one-time download, and already one of fastembed's supported/default
  models -- no custom conversion or training involved, matching the
  project's "no model training/fine-tuning" ground rule (this only ever
  runs the model's existing pretrained weights for inference, exactly
  like Groq runs Llama's pretrained weights for inference). Its 384-dim
  output is what qdrant_client.py's collection is created with.
- **Never hardcoded.** Every call path reads the model name from
  `Settings.embedding_model` (`EMBEDDING_MODEL` env var), the same
  configurability rule Phase 9 established for `LLM_MODEL`
  (docs/architecture.md §9) -- Groq's model names change over time, and
  so, in principle, could the right embedding model for this project.
"""

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
