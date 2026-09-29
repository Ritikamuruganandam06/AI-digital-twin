
from __future__ import annotations

from typing import Any

import httpx

from app.clients.backend_client import BackendUnavailableError
from app.config import get_settings
from app.utils.circuit_breaker import CircuitBreaker, CircuitOpenError
from app.utils.retry import RetryOptions, with_retry

_REQUEST_TIMEOUT_SECONDS = 10.0

# One retry, a short fixed backoff -- a second consecutive connection
# failure this close together means the backend process is actually down,
# not mid-restart, so a third attempt wouldn't help and would only eat
# into this tool call's share of the agent's own iteration/timeout budget.
_RETRY_OPTIONS = RetryOptions(retries=1, base_delay_seconds=0.3, is_retryable=lambda exc: isinstance(exc, httpx.ConnectError))

# 3 consecutive failures (across retries -- see _RETRY_OPTIONS) trips the
# breaker; 30s cooldown before the next probe. Plain constants, not env
# vars, matching every other timeout/threshold constant already in this
# module (_REQUEST_TIMEOUT_SECONDS above) and its TypeScript twin
# (backend/src/clients/aiServiceClient.ts's RETRY_OPTIONS/aiServiceBreaker).
_backend_breaker = CircuitBreaker(failure_threshold=3, reset_timeout_seconds=30.0)


async def _do_request(method: str, url: str, *, params: dict[str, Any] | None, json_body: dict[str, Any] | None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
        return await client.request(method, url, params=params, json=json_body)


async def _request(method: str, path: str, *, params: dict[str, Any] | None = None, json_body: dict[str, Any] | None = None) -> Any:
    settings = get_settings()
    url = f"{settings.backend_base_url}{path}"

    try:
        response = await _backend_breaker.execute(
            lambda: with_retry(lambda: _do_request(method, url, params=params, json_body=json_body), _RETRY_OPTIONS)
        )
    except CircuitOpenError as exc:
        raise BackendUnavailableError(
            f"Backend circuit breaker is open for {url} (too many recent failures) -- not attempting a network call"
        ) from exc
    except httpx.RequestError as exc:
        raise BackendUnavailableError(f"Could not reach backend at {url}: {exc}") from exc

    if response.status_code >= 400:
        # A non-2xx response is a real answer from a live process, not a
        # connectivity problem -- this check runs *after*
        # _backend_breaker.execute has already recorded the call a
        # success (the request completed), so it never trips the breaker
        # or gets retried.
        raise BackendUnavailableError(
            f"Backend returned HTTP {response.status_code} for {method} {url}: {response.text[:300]}"
        )

    body = response.json()
    # Every backend tool/API endpoint wraps its payload as {"data": ...}
    # (services.controller.ts, tools.controller.ts, ...) -- unwrap it here
    # so every function below returns the tool's actual result, not the
    # envelope.
    return body.get("data", body)


# ---- Read-only tools ---------------------------------------------------


async def get_services() -> Any:
    return await _request("GET", "/internal/tools/services")


async def get_service(service_name: str) -> Any:
    return await _request("GET", f"/internal/tools/services/{service_name}")


async def get_dependencies(service_name: str) -> Any:
    return await _request("GET", f"/internal/tools/services/{service_name}/dependencies")


async def get_dependents(service_name: str) -> Any:
    return await _request("GET", f"/internal/tools/services/{service_name}/dependents")


async def get_service_metrics(service_name: str, limit: int = 20) -> Any:
    return await _request("GET", f"/internal/tools/services/{service_name}/metrics", params={"limit": limit})


async def get_recent_events(service_name: str | None = None, limit: int = 20) -> Any:
    params: dict[str, Any] = {"limit": limit}
    if service_name:
        params["service"] = service_name
    return await _request("GET", "/internal/tools/events", params=params)


async def get_incident_history(status: str | None = None, limit: int = 20) -> Any:
    params: dict[str, Any] = {"limit": limit}
    if status:
        params["status"] = status
    return await _request("GET", "/internal/tools/incidents", params=params)


async def get_current_system_state() -> Any:
    return await _request("GET", "/internal/tools/system-state")


# ---- Simulation tools ----------------------------------------------------


async def simulate_service_failure(service_name: str) -> Any:
    return await _request("POST", "/internal/tools/simulate/service-failure", json_body={"serviceName": service_name})


async def simulate_traffic_increase(service_name: str, multiplier: float) -> Any:
    return await _request(
        "POST",
        "/internal/tools/simulate/traffic-increase",
        json_body={"serviceName": service_name, "multiplier": multiplier},
    )


async def simulate_database_failure() -> Any:
    return await _request("POST", "/internal/tools/simulate/database-failure", json_body={})


async def simulate_cache_failure() -> Any:
    return await _request("POST", "/internal/tools/simulate/cache-failure", json_body={})


async def simulate_high_latency(service_name: str, latency_multiplier: float) -> Any:
    return await _request(
        "POST",
        "/internal/tools/simulate/high-latency",
        json_body={"serviceName": service_name, "latencyMultiplier": latency_multiplier},
    )


async def simulate_high_error_rate(service_name: str, error_rate_multiplier: float) -> Any:
    return await _request(
        "POST",
        "/internal/tools/simulate/high-error-rate",
        json_body={"serviceName": service_name, "errorRateMultiplier": error_rate_multiplier},
    )


async def calculate_blast_radius(service_name: str) -> Any:
    return await _request("GET", f"/internal/tools/blast-radius/{service_name}")


async def find_bottleneck() -> Any:
    return await _request("GET", "/internal/tools/bottleneck")


# ---- Privileged tools ------------------------------------------------------


async def recommend_scaling(service_name: str) -> Any:
    """Non-mutating -- safe to call for real every time (see executor.py)."""
    return await _request("GET", f"/internal/tools/recommend-scaling/{service_name}")


async def create_incident(
    title: str,
    description: str,
    service_name: str,
    severity: str,
    affected_service_names: list[str] | None = None,
) -> Any:
    """
    Mutating. Not called by app/tools/executor.py's normal dispatch path --
    kept here only so a future, explicitly-authorized approval flow
    (Phase 15+) has a real function to call. See executor.py's
    PRIVILEGED_MUTATING handling for why the agent loop itself never
    reaches this function on its own.
    """
    body: dict[str, Any] = {
        "title": title,
        "description": description,
        "serviceName": service_name,
        "severity": severity,
    }
    if affected_service_names is not None:
        body["affectedServiceNames"] = affected_service_names
    return await _request("POST", "/internal/tools/create-incident", json_body=body)
