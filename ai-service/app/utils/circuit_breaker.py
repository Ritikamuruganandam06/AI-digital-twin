"""
A small, generic circuit breaker (docs/phases.md row 16 / docs/architecture.md
§17: "circuit breaker") -- the Python-side mirror of
backend/src/utils/circuitBreaker.ts. Classic 3-state design (CLOSED ->
OPEN -> HALF_OPEN -> CLOSED), hand-implemented rather than a new
dependency -- the state machine is small and this project has
consistently hand-implemented its other core mechanisms (the agent loop,
app/tools/executor.py's dispatch, the Kafka dead-letter path) rather than
reaching for a framework for them.

The concrete failure mode this solves: without a breaker, every call to a
genuinely-down dependency pays its full timeout before failing --
repeatedly, for as long as the dependency stays down. A breaker that has
seen enough consecutive failures starts failing fast instead (no network
attempt at all) until a cooldown elapses, then lets exactly one call
through as a probe. One instance is meant to be created per logical
downstream dependency (see app/tools/backend_tools_client.py and
app/llm/groq_client.py) and reused across calls, not created fresh per
call -- its whole value is in remembering state between calls.
"""

from __future__ import annotations

import time
from typing import Awaitable, Callable, Literal, TypeVar

T = TypeVar("T")

CircuitState = Literal["CLOSED", "OPEN", "HALF_OPEN"]


class CircuitOpenError(Exception):
    def __init__(self, message: str = "circuit breaker is open") -> None:
        super().__init__(message)


class CircuitBreaker:
    def __init__(self, *, failure_threshold: int, reset_timeout_seconds: float) -> None:
        self.failure_threshold = failure_threshold
        self.reset_timeout_seconds = reset_timeout_seconds
        self._state: CircuitState = "CLOSED"
        self._consecutive_failures = 0
        self._opened_at = 0.0

    def get_state(self) -> CircuitState:
        # Deriving OPEN -> HALF_OPEN lazily (on read/execute) rather than
        # with a timer/task means there's nothing to clean up and nothing
        # to leak if a breaker instance is discarded.
        if self._state == "OPEN" and (time.monotonic() - self._opened_at) >= self.reset_timeout_seconds:
            return "HALF_OPEN"
        return self._state

    async def execute(self, fn: Callable[[], Awaitable[T]]) -> T:
        """
        Runs `fn()` through the breaker. Raises CircuitOpenError without
        calling `fn()` at all when the breaker is open and still cooling
        down -- that's the entire point: fail fast, don't even attempt the
        call. When HALF_OPEN, exactly one call is allowed through as a
        probe; its outcome decides whether the breaker closes again or
        reopens.
        """
        current_state = self.get_state()
        if current_state == "OPEN":
            raise CircuitOpenError()

        try:
            result = await fn()
        except Exception:
            self._on_failure()
            raise
        else:
            self._on_success()
            return result

    def _on_success(self) -> None:
        self._consecutive_failures = 0
        self._state = "CLOSED"

    def _on_failure(self) -> None:
        self._consecutive_failures += 1
        was_half_open_probe = self.get_state() == "HALF_OPEN"
        if was_half_open_probe or self._consecutive_failures >= self.failure_threshold:
            self._state = "OPEN"
            self._opened_at = time.monotonic()
