

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
        llm_provider=os.getenv("LLM_PROVIDER", "groq"),
        llm_model=os.getenv("LLM_MODEL", "openai/gpt-oss-120b"),
        groq_api_key=os.getenv("GROQ_API_KEY", ""),
        agent_max_iterations=int(os.getenv("AGENT_MAX_ITERATIONS", "6")),
        agent_tool_timeout_ms=int(os.getenv("AGENT_TOOL_TIMEOUT_MS", "10000")),
        qdrant_url=os.getenv("QDRANT_URL", "http://localhost:6333").rstrip("/"),
        qdrant_collection=os.getenv("QDRANT_COLLECTION", "knowledge_base"),
        embedding_model=os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5"),
    )
