"""
Unit tests for app/utils/retry.py -- the Python-side mirror of
backend/tests/retry.unit.test.ts, same cases. `asyncio.sleep` is patched
to a fast no-op that just records the requested delay, so backoff timing
is asserted precisely without the test actually waiting.
"""

from __future__ import annotations

import pytest

from app.utils.retry import RetryOptions, with_retry


@pytest.fixture
def recorded_sleeps(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    delays: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        delays.append(seconds)

    monkeypatch.setattr("app.utils.retry.asyncio.sleep", fake_sleep)
    return delays


async def test_returns_result_on_first_try_without_sleeping(recorded_sleeps: list[float]) -> None:
    calls = 0

    async def fn() -> str:
        nonlocal calls
        calls += 1
        return "ok"

    result = await with_retry(fn, RetryOptions(retries=3, base_delay_seconds=0.1))

    assert result == "ok"
    assert calls == 1
    assert recorded_sleeps == []


async def test_retries_a_retryable_failure_and_eventually_succeeds(recorded_sleeps: list[float]) -> None:
    calls = 0

    async def fn() -> str:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("transient")
        return "ok"

    result = await with_retry(
        fn, RetryOptions(retries=2, base_delay_seconds=0.1, is_retryable=lambda _exc: True)
    )

    assert result == "ok"
    assert calls == 2


async def test_never_retries_when_is_retryable_is_the_default(recorded_sleeps: list[float]) -> None:
    calls = 0

    async def fn() -> str:
        nonlocal calls
        calls += 1
        raise ValueError("not transient")

    with pytest.raises(ValueError, match="not transient"):
        await with_retry(fn, RetryOptions(retries=5, base_delay_seconds=0.1))

    assert calls == 1


async def test_gives_up_after_exhausting_retries_and_raises_the_last_error(recorded_sleeps: list[float]) -> None:
    calls = 0

    async def fn() -> str:
        nonlocal calls
        calls += 1
        raise ValueError("always fails")

    with pytest.raises(ValueError, match="always fails"):
        await with_retry(fn, RetryOptions(retries=2, base_delay_seconds=0.01, is_retryable=lambda _exc: True))

    assert calls == 3  # 1 initial + 2 retries


async def test_only_retries_failures_is_retryable_actually_approves(recorded_sleeps: list[float]) -> None:
    class TransientError(Exception):
        pass

    calls = 0

    async def fn() -> str:
        nonlocal calls
        calls += 1
        raise ValueError("permanent, not a TransientError")

    with pytest.raises(ValueError, match="permanent"):
        await with_retry(
            fn,
            RetryOptions(retries=3, base_delay_seconds=0.01, is_retryable=lambda exc: isinstance(exc, TransientError)),
        )

    assert calls == 1  # never matched is_retryable, so no retry at all


async def test_backs_off_exponentially_capped_at_max_delay(recorded_sleeps: list[float]) -> None:
    calls = 0

    async def fn() -> str:
        nonlocal calls
        calls += 1
        if calls < 4:
            raise ValueError(str(calls))
        return "ok"

    result = await with_retry(
        fn,
        RetryOptions(retries=3, base_delay_seconds=0.1, max_delay_seconds=0.25, is_retryable=lambda _exc: True),
    )

    assert result == "ok"
    assert calls == 4
    # 0.1, 0.2, then min(0.1 * 2**2, 0.25) = 0.25, not 0.4
    assert recorded_sleeps == pytest.approx([0.1, 0.2, 0.25])
