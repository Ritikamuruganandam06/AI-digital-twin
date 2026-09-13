"""
HTTP client for the Node backend's tool API (`/internal/tools/*` —
backend/src/tools/tools.route.ts, docs/architecture.md §4/§10).

This is the ONLY code in the AI service that calls `/internal/tools/*`.
Distinct from app/clients/backend_client.py (Phase 8), which calls the
public `/api/services` boundary-proof endpoint -- that module stays as
it was; this one is Phase 10's tool-calling surface. Both ultimately
enforce the same rule (docs/architecture.md §15): the AI service has no
Mongo/Redis/Kafka client at all, only HTTP calls to the backend.

Every function here maps 1:1 to one backend_tools_client function per
route in tools.route.ts, and in turn 1:1 to one tool schema in
schemas.py. Each raises BackendUnavailableError (reused from
backend_client.py rather than a second, near-identical exception type)
on any network failure or non-2xx response -- app/tools/executor.py is
what turns that into a result the agent loop can feed back to the LLM
instead of crashing.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.clients.backend_client import BackendUnavailableError
from app.config import get_settings

_REQUEST_TIMEOUT_SECONDS = 10.0


async def _request(method: str, path: str, *, params: dict[str, Any] | None = None, json_body: dict[str, Any] | None = None) -> Any:
    settings = get_settings()
    url = f"{settings.backend_base_url}{path}"

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.request(method, url, params=params, json=json_body)
    except httpx.RequestError as exc:
        raise BackendUnavailableError(f"Could not reach backend at {url}: {exc}") from exc

    if response.status_code >= 400:
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
