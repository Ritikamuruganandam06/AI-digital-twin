"""
Generic retry-with-backoff helper (docs/phases.md row 16 / docs/architecture.md
§17: "retries with backoff") -- the Python-side mirror of
backend/src/utils/retry.ts. Deliberately narrow by default: retrying a
call that already returned a real answer (even an error response) is
usually wrong -- only a genuine transient failure (the callee never
responded at all) is worth paying for a second attempt. Callers pass
`is_retryable` to say exactly which failures qualify; the default treats
everything as non-retryable so a caller must opt in deliberately rather
than accidentally retrying something unsafe to retry.

No new dependency -- one small, generic coroutine, the same "hand-roll it,
don't reach for a library" choice this project has made throughout (the
agent loop, the Kafka DLQ path, the TypeScript twin of this module).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Awaitable, Callable, TypeVar

T = TypeVar("T")


def _never_retryable(_exc: BaseException) -> bool:
    return False


@dataclass(frozen=True)
class RetryOptions:
    # Number of ADDITIONAL attempts after the first (retries=1 means at
    # most 2 attempts total).
    retries: int
    # Delay before the first retry. Doubles on each subsequent attempt.
    base_delay_seconds: float
    # Backoff never grows past this, so a large `retries` can't lead to an
    # unreasonably long wait.
    max_delay_seconds: float = float("inf")
    # Only failures this returns True for are retried; anything else is
    # re-raised immediately.
    is_retryable: Callable[[BaseException], bool] = field(default=_never_retryable)


async def with_retry(fn: Callable[[], Awaitable[T]], options: RetryOptions) -> T:
    attempt = 0
    while True:
        try:
            return await fn()
        except Exception as exc:
            can_retry = attempt < options.retries and options.is_retryable(exc)
            if not can_retry:
                raise
            wait_seconds = min(options.base_delay_seconds * (2**attempt), options.max_delay_seconds)
            attempt += 1
            await asyncio.sleep(wait_seconds)
