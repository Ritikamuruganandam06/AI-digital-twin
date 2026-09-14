"""
Tool call execution and privilege enforcement (docs/phases.md row 10:
"tool execution loop against backend tool API"; row 13:
"search_knowledge_base"; docs/architecture.md §10: "the grouping is
enforced, not just documented").

`execute_tool_call(name, arguments)` is the one function app/agent/loop.py
calls for every tool_call Groq returns. It never raises: a bad tool name,
bad arguments, a real backend failure, or a RAG (embedding/Qdrant) failure
all come back as a structured `{"error": "..."}` result instead, so one
failed tool call can be fed back to the LLM as an observation (the same
"handle failures cleanly, don't crash the process" rule Phase 8's
backend_client.py established) rather than crashing the whole agent loop.

Privilege enforcement lives here, not in schemas.py (which only
describes tools to the LLM) and not in backend_tools_client.py (which
only knows how to make HTTP calls): PRIVILEGED_MUTATING tools
(create_incident) are never actually executed by this dispatcher, no
matter how the LLM calls them -- see docs/architecture.md §10: "the agent
can *propose* one but cannot silently execute it." Read-only, simulation,
KNOWLEDGE_RETRIEVAL (search_knowledge_base), and PRIVILEGED_SAFE tools
(recommend_scaling, which only ever returns a recommendation) execute for
real.

search_knowledge_base is dispatched differently from every other tool
here: every other tool goes through backend_tools_client (an HTTP call to
the Node backend); search_knowledge_base calls app/rag/retriever.py
in-process instead, since RAG is the AI service's own responsibility
(docs/architecture.md §2, §15) and never crosses the backend boundary.
retrieve() is a synchronous, potentially CPU-bound (local embedding) call,
so it runs via asyncio.to_thread rather than blocking the event loop the
way every other (already-async, HTTP-bound) tool handler here does not
need to.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from app.clients.backend_client import BackendUnavailableError
from app.rag.embedding import EmbeddingError
from app.rag.qdrant_client import QdrantUnavailableError
from app.rag.retriever import retrieve as retrieve_knowledge
from app.tools import backend_tools_client as tools_client
from app.tools.schemas import TOOL_PRIVILEGE, PrivilegeTier

ToolFunction = Callable[[dict[str, Any]], Awaitable[Any]]


async def _get_services(_args: dict[str, Any]) -> Any:
    return await tools_client.get_services()


async def _get_service(args: dict[str, Any]) -> Any:
    return await tools_client.get_service(args["serviceName"])


async def _get_dependencies(args: dict[str, Any]) -> Any:
    return await tools_client.get_dependencies(args["serviceName"])


async def _get_dependents(args: dict[str, Any]) -> Any:
    return await tools_client.get_dependents(args["serviceName"])


async def _get_service_metrics(args: dict[str, Any]) -> Any:
    return await tools_client.get_service_metrics(args["serviceName"], args.get("limit", 20))


async def _get_recent_events(args: dict[str, Any]) -> Any:
    return await tools_client.get_recent_events(args.get("serviceName"), args.get("limit", 20))


async def _get_incident_history(args: dict[str, Any]) -> Any:
    return await tools_client.get_incident_history(args.get("status"), args.get("limit", 20))


async def _get_current_system_state(_args: dict[str, Any]) -> Any:
    return await tools_client.get_current_system_state()


async def _simulate_service_failure(args: dict[str, Any]) -> Any:
    return await tools_client.simulate_service_failure(args["serviceName"])


async def _simulate_traffic_increase(args: dict[str, Any]) -> Any:
    return await tools_client.simulate_traffic_increase(args["serviceName"], args["multiplier"])


async def _simulate_database_failure(_args: dict[str, Any]) -> Any:
    return await tools_client.simulate_database_failure()


async def _simulate_cache_failure(_args: dict[str, Any]) -> Any:
    return await tools_client.simulate_cache_failure()


async def _simulate_high_latency(args: dict[str, Any]) -> Any:
    return await tools_client.simulate_high_latency(args["serviceName"], args["latencyMultiplier"])


async def _simulate_high_error_rate(args: dict[str, Any]) -> Any:
    return await tools_client.simulate_high_error_rate(args["serviceName"], args["errorRateMultiplier"])


async def _calculate_blast_radius(args: dict[str, Any]) -> Any:
    return await tools_client.calculate_blast_radius(args["serviceName"])


async def _find_bottleneck(_args: dict[str, Any]) -> Any:
    return await tools_client.find_bottleneck()


async def _recommend_scaling(args: dict[str, Any]) -> Any:
    return await tools_client.recommend_scaling(args["serviceName"])


async def _search_knowledge_base(args: dict[str, Any]) -> Any:
    """
    The RAG side of the agent's tool set (docs/phases.md row 13). Never
    calls backend_tools_client -- goes straight to app/rag/retriever.py,
    the AI service's own Qdrant-backed knowledge store.
    """
    query = args["query"]
    top_k = args.get("topK", 5)
    chunks = await asyncio.to_thread(retrieve_knowledge, query, top_k)
    return {
        "query": query,
        "resultCount": len(chunks),
        "results": [
            {
                "documentId": chunk.document_id,
                "title": chunk.title,
                "documentType": chunk.document_type,
                "relatedService": chunk.related_service,
                "score": chunk.score,
                "text": chunk.text,
            }
            for chunk in chunks
        ],
    }


async def _propose_create_incident(args: dict[str, Any]) -> Any:
    """
    PRIVILEGED_MUTATING: deliberately never calls
    tools_client.create_incident(). Returns a structured proposal instead
    -- see the module docstring and docs/architecture.md §10.
    """
    return {
        "status": "PROPOSED_NOT_EXECUTED",
        "reason": (
            "create_incident is a privileged, mutating action. This platform does not yet have an "
            "approval flow (planned for Phase 15's RBAC), so the agent can only propose it -- it has "
            "not been created. An operator must create it manually via POST /api/incidents."
        ),
        "proposedIncident": {
            "title": args.get("title"),
            "description": args.get("description"),
            "serviceName": args.get("serviceName"),
            "severity": args.get("severity"),
            "affectedServiceNames": args.get("affectedServiceNames"),
        },
    }


_TOOL_FUNCTIONS: dict[str, ToolFunction] = {
    "get_services": _get_services,
    "get_service": _get_service,
    "get_dependencies": _get_dependencies,
    "get_dependents": _get_dependents,
    "get_service_metrics": _get_service_metrics,
    "get_recent_events": _get_recent_events,
    "get_incident_history": _get_incident_history,
    "get_current_system_state": _get_current_system_state,
    "simulate_service_failure": _simulate_service_failure,
    "simulate_traffic_increase": _simulate_traffic_increase,
    "simulate_database_failure": _simulate_database_failure,
    "simulate_cache_failure": _simulate_cache_failure,
    "simulate_high_latency": _simulate_high_latency,
    "simulate_high_error_rate": _simulate_high_error_rate,
    "calculate_blast_radius": _calculate_blast_radius,
    "find_bottleneck": _find_bottleneck,
    "recommend_scaling": _recommend_scaling,
    # create_incident is intentionally NOT wired to tools_client.create_incident here.
    "create_incident": _propose_create_incident,
    # search_knowledge_base is intentionally NOT wired to tools_client -- it never reaches the backend.
    "search_knowledge_base": _search_knowledge_base,
}


async def execute_tool_call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """
    Executes one tool call by name and returns a JSON-serializable result
    (always a dict, even for a list-shaped tool result, so the agent loop
    can uniformly `json.dumps()` it as a tool message). Never raises.
    """
    if name not in _TOOL_FUNCTIONS:
        return {"error": f"Unknown tool '{name}'"}

    handler = _TOOL_FUNCTIONS[name]

    try:
        result = await handler(arguments)
    except KeyError as exc:
        return {"error": f"Missing required argument {exc} for tool '{name}'"}
    except BackendUnavailableError as exc:
        return {"error": f"Backend tool call failed: {exc}"}
    except (EmbeddingError, QdrantUnavailableError) as exc:
        return {"error": f"Knowledge base search failed: {exc}"}
    except Exception as exc:  # noqa: BLE001 -- a tool failure must never crash the agent loop
        return {"error": f"Tool '{name}' raised an unexpected error: {exc}"}

    if isinstance(result, dict):
        return result
    return {"result": result}


def get_tool_privilege(name: str) -> PrivilegeTier | None:
    return TOOL_PRIVILEGE.get(name)
