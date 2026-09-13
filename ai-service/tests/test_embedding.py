"""
Tests for app/rag/embedding.py.

test_embed_texts_and_embed_text_delegate_to_the_model and friends mock the
model boundary (app.rag.embedding._get_model), the same "mock at the
boundary, not the whole subsystem" pattern test_groq_client.py established
for httpx -- these run unconditionally, no network or download needed.

test_embedding_model_produces_real_semantically_meaningful_vectors is the
one REAL, unmocked test: it actually loads BAAI/bge-small-en-v1.5 (a
one-time download on first run) and checks the vectors it returns have a
real property a fake/random vector generator could not fake by accident --
two sentences about the same topic are more cosine-similar than two
sentences about unrelated topics. Skipped when the model's one-time
download isn't reachable (this sandbox's own egress proxy blocks
huggingface.co -- see README), the same deferral pattern
test_groq_client_live.py uses for GROQ_API_KEY/network.
"""

from __future__ import annotations

import math
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.rag.embedding import EmbeddingError, embed_text, embed_texts, get_embedding_dimension

_HF_REACHABILITY_TIMEOUT_SECONDS = 5.0


def _huggingface_reachable() -> bool:
    try:
        response = httpx.head("https://huggingface.co", timeout=_HF_REACHABILITY_TIMEOUT_SECONDS)
        return response.status_code < 500
    except httpx.RequestError:
        return False


@pytest.fixture(autouse=True)
def _clear_model_cache():
    from app.rag import embedding

    embedding._get_model.cache_clear()
    yield
    embedding._get_model.cache_clear()


def _fake_model(vectors: dict[str, list[float]]) -> MagicMock:
    """A fake fastembed TextEmbedding whose .embed() returns fixed vectors keyed by input text."""
    model = MagicMock()

    def _embed(texts):
        return [_FakeArray(vectors[t]) for t in texts]

    model.embed.side_effect = _embed
    return model


class _FakeArray(list):
    """fastembed's real .embed() yields numpy arrays with a .tolist() method -- a plain list needs one too to stand in for it."""

    def tolist(self) -> list[float]:
        return list(self)


def test_embed_texts_returns_one_vector_per_input_in_order() -> None:
    fake = _fake_model({"a": [1.0, 2.0], "b": [3.0, 4.0]})
    with patch("app.rag.embedding._get_model", return_value=fake):
        result = embed_texts(["a", "b"])

    assert result == [[1.0, 2.0], [3.0, 4.0]]


def test_embed_texts_of_empty_list_returns_empty_list_without_loading_the_model() -> None:
    with patch("app.rag.embedding._get_model") as mocked_get_model:
        result = embed_texts([])

    assert result == []
    mocked_get_model.assert_not_called()


def test_embed_text_returns_a_single_vector() -> None:
    fake = _fake_model({"hello": [0.1, 0.2, 0.3]})
    with patch("app.rag.embedding._get_model", return_value=fake):
        result = embed_text("hello")

    assert result == [0.1, 0.2, 0.3]


def test_embedding_failure_is_normalized_to_embedding_error() -> None:
    fake = MagicMock()
    fake.embed.side_effect = RuntimeError("onnxruntime blew up")
    with patch("app.rag.embedding._get_model", return_value=fake):
        with pytest.raises(EmbeddingError, match="Embedding failed"):
            embed_text("hello")


def test_model_load_failure_is_normalized_to_embedding_error() -> None:
    with patch("app.rag.embedding.TextEmbedding", side_effect=RuntimeError("download blocked")):
        with pytest.raises(EmbeddingError, match="Could not load embedding model"):
            embed_text("hello")


def test_get_embedding_dimension_uses_the_known_table_without_loading_the_model() -> None:
    # BAAI/bge-small-en-v1.5 is app/config.py's default -- this must not
    # need to call the (unpatched, unloadable-in-a-unit-test) real model.
    with patch("app.rag.embedding._get_model") as mocked_get_model:
        dimension = get_embedding_dimension()

    assert dimension == 384
    mocked_get_model.assert_not_called()


def test_get_embedding_dimension_probes_the_model_for_an_unknown_model_name(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("EMBEDDING_MODEL", "some/unlisted-model")
    get_settings.cache_clear()
    fake = _fake_model({"dimension probe": [0.0] * 512})
    try:
        with patch("app.rag.embedding._get_model", return_value=fake):
            dimension = get_embedding_dimension()
        assert dimension == 512
    finally:
        get_settings.cache_clear()


@pytest.mark.skipif(
    not _huggingface_reachable(),
    reason=(
        "Requires outbound access to huggingface.co for fastembed's one-time "
        "BAAI/bge-small-en-v1.5 weight download -- blocked in this sandbox by "
        "its own egress policy (see README's 'What could and couldn't be "
        "verified here')."
    ),
)
def test_embedding_model_produces_real_semantically_meaningful_vectors() -> None:
    """
    The real, unmocked proof: load the actual configured model and embed
    real sentences. A shape check alone (right length, floats) could pass
    even for a buggy model that returns garbage -- this additionally
    checks a property only a real semantic embedding has: two sentences
    about the *same* topic are more cosine-similar to each other than
    either is to a sentence about something unrelated.
    """
    vectors = embed_texts(
        [
            "The payment service is currently down.",
            "Payment service is experiencing an outage.",
            "The weather in Paris is sunny today.",
        ]
    )
    assert len(vectors) == 3
    for vector in vectors:
        assert len(vector) == 384
        assert all(isinstance(x, float) for x in vector)

    def cosine_similarity(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(y * y for y in b))
        return dot / (norm_a * norm_b)

    payment_vs_payment = cosine_similarity(vectors[0], vectors[1])
    payment_vs_weather = cosine_similarity(vectors[0], vectors[2])

    assert payment_vs_payment > payment_vs_weather, (
        f"expected the two payment-outage sentences ({payment_vs_payment:.3f}) to be more "
        f"similar than payment-vs-weather ({payment_vs_weather:.3f}) -- got the opposite, "
        "which would mean these aren't real semantic embeddings"
    )
