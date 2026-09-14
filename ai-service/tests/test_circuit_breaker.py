"""
Unit tests for app/utils/circuit_breaker.py -- the Python-side mirror of
backend/tests/circuitBreaker.unit.test.ts, same cases. `time.monotonic` is
patched to a controllable fake clock so OPEN -> HALF_OPEN timing is
asserted precisely without the test actually waiting.
"""

from __future__ import annotations

import pytest

from app.utils.circuit_breaker import CircuitBreaker, CircuitOpenError


@pytest.fixture
def fake_clock(monkeypatch: pytest.MonkeyPatch):
    now = {"t": 0.0}

    def monotonic() -> float:
        return now["t"]

    monkeypatch.setattr("app.utils.circuit_breaker.time.monotonic", monotonic)

    def set_time(t: float) -> None:
        now["t"] = t

    return set_time


async def test_starts_closed_and_stays_closed_while_calls_succeed(fake_clock) -> None:
    breaker = CircuitBreaker(failure_threshold=2, reset_timeout_seconds=1.0)

    await breaker.execute(lambda: _ok())
    await breaker.execute(lambda: _ok())

    assert breaker.get_state() == "CLOSED"


async def test_trips_open_after_failure_threshold_consecutive_failures_not_before(fake_clock) -> None:
    breaker = CircuitBreaker(failure_threshold=3, reset_timeout_seconds=1.0)

    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())
    assert breaker.get_state() == "CLOSED"  # 1 failure, threshold is 3

    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())
    assert breaker.get_state() == "CLOSED"  # 2 failures

    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())
    assert breaker.get_state() == "OPEN"  # 3rd failure trips it


async def test_a_single_success_resets_the_consecutive_failure_count(fake_clock) -> None:
    breaker = CircuitBreaker(failure_threshold=2, reset_timeout_seconds=1.0)

    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())
    await breaker.execute(lambda: _ok())  # resets the streak
    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())

    assert breaker.get_state() == "CLOSED"  # only 1 consecutive failure again, threshold is 2


async def test_while_open_rejects_immediately_without_calling_the_wrapped_function(fake_clock) -> None:
    breaker = CircuitBreaker(failure_threshold=1, reset_timeout_seconds=1.0)

    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())
    assert breaker.get_state() == "OPEN"

    calls = 0

    async def fn() -> str:
        nonlocal calls
        calls += 1
        return "should not run"

    with pytest.raises(CircuitOpenError):
        await breaker.execute(fn)
    assert calls == 0  # fails fast, no attempt at all


async def test_moves_to_half_open_once_reset_timeout_elapsed(fake_clock) -> None:
    breaker = CircuitBreaker(failure_threshold=1, reset_timeout_seconds=1.0)

    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())
    assert breaker.get_state() == "OPEN"

    fake_clock(0.999)
    assert breaker.get_state() == "OPEN"  # not yet

    fake_clock(1.0)
    assert breaker.get_state() == "HALF_OPEN"


async def test_a_successful_half_open_probe_closes_the_breaker(fake_clock) -> None:
    breaker = CircuitBreaker(failure_threshold=1, reset_timeout_seconds=1.0)

    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())
    fake_clock(1.0)
    assert breaker.get_state() == "HALF_OPEN"

    await breaker.execute(lambda: _ok())

    assert breaker.get_state() == "CLOSED"


async def test_a_failed_half_open_probe_reopens_immediately(fake_clock) -> None:
    breaker = CircuitBreaker(failure_threshold=5, reset_timeout_seconds=1.0)

    with pytest.raises(ValueError):
        await breaker.execute(lambda: _fail())
    assert breaker.get_state() == "CLOSED"  # only 1 failure, threshold is 5

    for _ in range(4):
        with pytest.raises(ValueError):
            await breaker.execute(lambda: _fail())
    assert breaker.get_state() == "OPEN"

    fake_clock(1.0)
    assert breaker.get_state() == "HALF_OPEN"

    with pytest.raises(ValueError, match="still down"):
        await breaker.execute(lambda: _fail("still down"))
    assert breaker.get_state() == "OPEN"  # one failed probe is enough to reopen, not 5 more


async def _ok() -> str:
    return "ok"


async def _fail(message: str = "down") -> str:
    raise ValueError(message)
