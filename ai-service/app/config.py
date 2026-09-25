

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# ai-service/.env, resolved relative to this file rather than the process's
# current working directory -- so `.env` loads correctly whether the app
# is started from ai-service/ or from elsewhere. override=False (the
# python-dotenv default) so a real environment variable already set by the
# process manager / CI always wins over the .env file, never the reverse.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_ENV_FILE, override=False)


@dataclass(frozen=True)
class Settings:
    env: str
    port: int
    backend_base_url: str
    log_level: str
    llm_provider: str
    llm_model: str
    groq_api_key: str
    agent_max_iterations: int
    agent_tool_timeout_ms: int
    qdrant_url: str
    qdrant_collection: str
    embedding_model: str


@lru_cache
def get_settings() -> Settings:
    """
    Cached on purpose (env vars don't change during a process's life), but
    cache-able per-call for tests via `get_settings.cache_clear()`.
    """
    return Settings(
        env=os.getenv("ENV", "development"),
        port=int(os.getenv("PORT", "8000")),
        backend_base_url=os.getenv("BACKEND_BASE_URL", "http://localhost:4000").rstrip("/"),
        log_level=os.getenv("LOG_LEVEL", "info"),
        # docs/architecture.md §9: "The specific Groq-hosted Llama model is
        # configured via LLM_MODEL (not hardcoded)". llama-3.3-70b-versatile
        # is Groq's current production Llama model as of this phase
        # (console.groq.com/docs/models) -- a default, not a hardcoded
        # dependency: any value in LLM_MODEL overrides it.
        llm_provider=os.getenv("LLM_PROVIDER", "groq"),
        llm_model=os.getenv("LLM_MODEL", "llama-3.3-70b-versatile"),
        # No default for the key itself -- an empty string means "not
        # configured" and groq_client.py refuses to call out with it.
        groq_api_key=os.getenv("GROQ_API_KEY", ""),
        # docs/env-vars.md defaults, first read starting Phase 10.
        agent_max_iterations=int(os.getenv("AGENT_MAX_ITERATIONS", "6")),
        agent_tool_timeout_ms=int(os.getenv("AGENT_TOOL_TIMEOUT_MS", "10000")),
        # Phase 11 (docs/env-vars.md defaults).
        qdrant_url=os.getenv("QDRANT_URL", "http://localhost:6333").rstrip("/"),
        qdrant_collection=os.getenv("QDRANT_COLLECTION", "knowledge_base"),
        # BAAI/bge-small-en-v1.5: a small (~130MB), fast, CPU-only ONNX
        # embedding model (384 dims) -- chosen and justified in
        # app/rag/embedding.py's own module docstring. Configurable, not
        # hardcoded elsewhere, same pattern as LLM_MODEL.
        embedding_model=os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5"),
    )
