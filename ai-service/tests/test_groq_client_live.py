"""
The actual "real completion returned from Groq" proof required by
docs/phases.md row 9's verification column.

This test makes a REAL network call to the real Groq API -- no mocking.
It is automatically skipped when no GROQ_API_KEY is configured (e.g. in
CI, or in this repo's build sandbox, which has no Groq credentials), so
`pytest` stays hermetic by default. Set a real key in ai-service/.env
(copied from .env.example) and re-run `pytest -v
tests/test_groq_client_live.py` to get a genuine pass/fail against the
live Groq API -- the project's ground rule that infrastructure claims
need a runnable proof, not just configuration, applies here exactly as it
did to Phase 5's Kafka broker.

The skip condition reads app.config.get_settings().groq_api_key rather
than os.getenv("GROQ_API_KEY") directly. get_settings() is what actually
loads ai-service/.env (app/config.py's load_dotenv() call) -- reading
os.environ here directly, before anything had loaded that file, is what
previously made this test skip even when GROQ_API_KEY was genuinely set
in .env. Reusing get_settings() -- the same function groq_client.py
itself uses -- means this check can never drift out of sync with what
the client actually sees.
"""

from __future__ import annotations

import pytest

from app.config import get_settings
from app.llm.groq_client import get_chat_reply

pytestmark = pytest.mark.skipif(
    not get_settings().groq_api_key,
    reason="GROQ_API_KEY not set -- set a real key in ai-service/.env to run this live test",
)


@pytest.mark.asyncio
async def test_real_groq_chat_completion_returns_a_reply() -> None:
    reply = await get_chat_reply(
        [
            {
                "role": "user",
                "content": "Reply with exactly the single word: pong",
            }
        ],
        temperature=0,
        max_tokens=10,
    )

    assert isinstance(reply, str)
    assert len(reply.strip()) > 0
