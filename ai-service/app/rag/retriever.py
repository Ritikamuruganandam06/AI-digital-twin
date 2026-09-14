"""
docs/phases.md row 12's "retriever" deliverable, and the phase's actual
verification target: "Question -> relevant chunks retrieved". Embeds a
question, searches Qdrant (ingested by app/rag/ingest.py), and applies a
relevance-score filter -- docs/architecture.md §12's "Relevance
filtering" step in the retrieval flow diagram -- before returning
results, so a low-scoring, barely-related match isn't dressed up as
grounding: docs/architecture.md §1 is explicit that "the LLM never
invents... every quantitative claim traces back to a tool call", and
handing the LLM an irrelevant chunk as if it answered the question would
undermine that same spirit for the RAG side of things.

Not wired into the agent loop here -- deciding *when* to call this at all
(versus tools, versus both, versus neither) is Phase 13's job ("Agent +
Tools + RAG orchestration").
"""

from __future__ import annotations

from dataclasses import dataclass

from app.rag.embedding import embed_text
from app.rag.qdrant_client import search

# A starting cosine-similarity cutoff for BAAI/bge-small-en-v1.5 (this
# project's configured EMBEDDING_MODEL) -- normalized sentence embeddings
# from this model family typically put genuinely-relevant matches above
# ~0.5-0.6 and near-duplicates above ~0.8, per the model's own published
# benchmarks. This sandbox cannot reach huggingface.co (see
# ai-service/README.md's Phase 12 "What could and couldn't be verified
# here"), so this value has NOT been empirically tuned against this
# knowledge base's actual embeddings -- treat it as a reasonable starting
# point to validate and adjust once real retrieval results are observable
# on a machine with model access, not as a finally-tuned constant.
DEFAULT_SCORE_THRESHOLD = 0.5


@dataclass(frozen=True)
class RetrievedChunk:
    text: str
    score: float
    document_id: str
    source_path: str
    document_type: str
    related_service: str
    title: str
    chunk_id: str


def retrieve(
    question: str,
    top_k: int = 5,
    score_threshold: float = DEFAULT_SCORE_THRESHOLD,
) -> list[RetrievedChunk]:
    """
    Embeds `question`, searches the ingested knowledge base, and returns
    up to `top_k` chunks scoring at or above `score_threshold`, highest
    similarity first. Returns an empty list (not an error) when nothing
    clears the threshold -- "no relevant knowledge found" is a normal,
    expected outcome for a question this knowledge base doesn't cover.
    """
    query_vector = embed_text(question)
    results = search(query_vector, top_k=top_k)
    return [
        RetrievedChunk(
            text=r["payload"]["text"],
            score=r["score"],
            document_id=r["payload"]["document_id"],
            source_path=r["payload"]["source_path"],
            document_type=r["payload"]["document_type"],
            related_service=r["payload"]["related_service"],
            title=r["payload"]["title"],
            chunk_id=r["payload"]["chunk_id"],
        )
        for r in results
        if r["score"] >= score_threshold
    ]
