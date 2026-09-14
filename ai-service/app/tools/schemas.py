"""
Tool schemas offered to Groq's chat-completions API (docs/phases.md row
10: "Tool schemas + tool execution loop against backend tool API"; row 13
adds search_knowledge_base, the RAG side of "Agent + Tools + RAG
orchestration").

Each entry is Groq/OpenAI's function-calling shape:
`{"type": "function", "function": {"name", "description", "parameters"}}`.
The `name` here is the contract the LLM actually sees and is what
app/tools/executor.py dispatches on -- it is deliberately decoupled from
backend_tools_client.py's Python function names and tools.route.ts's URL
paths (both of which use different naming conventions); only the tool
`name` string has to match across all three.

Grouped into privilege tiers, each tagged with a PrivilegeTier so
executor.py can enforce rules structurally rather than by convention.
docs/architecture.md §10 defines three tiers for tools that reach the
backend's tool API (read-only, simulation, privileged); KNOWLEDGE_RETRIEVAL
is a fourth tier added in Phase 13 for search_knowledge_base, which is
deliberately NOT a backend tool at all -- it never crosses the AI
service/backend boundary (§15: "the AI service has no MongoDB/Redis/Kafka
client"). It calls app/rag/retriever.py directly, the AI service's own
Qdrant-backed knowledge store (§2, §13). Per docs/architecture.md §14,
"This decision is made by the LLM itself via the tool-calling interface
... rather than a separate hardcoded classifier" -- search_knowledge_base
being just another tool in this same list, with its use governed by
app/agent/loop.py's system prompt, IS that decision logic. This is the
fixed tool set the agent is offered -- "the grouping is enforced, not
just documented" (§10).
"""

from __future__ import annotations

from enum import Enum


class PrivilegeTier(str, Enum):
    READ_ONLY = "read_only"
    SIMULATION = "simulation"
    KNOWLEDGE_RETRIEVAL = "knowledge_retrieval"  # RAG search -- safe, read-only, never touches the backend
    PRIVILEGED_SAFE = "privileged_safe"  # returns a recommendation, never mutates
    PRIVILEGED_MUTATING = "privileged_mutating"  # mutates real state -- requires approval


_SERVICE_NAME_PARAM = {
    "serviceName": {
        "type": "string",
        "description": "The service's name, e.g. 'payment-service'.",
    }
}

# Each entry: (privilege tier, OpenAI/Groq tool-calling schema dict).
TOOL_DEFINITIONS: list[tuple[PrivilegeTier, dict]] = [
    # ---- Read-only --------------------------------------------------
    (
        PrivilegeTier.READ_ONLY,
        {
            "type": "function",
            "function": {
                "name": "get_services",
                "description": "List every service in the digital twin, with its current health.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ),
    (
        PrivilegeTier.READ_ONLY,
        {
            "type": "function",
            "function": {
                "name": "get_service",
                "description": "Get one service's full details, including its resolved dependencies and dependents.",
                "parameters": {
                    "type": "object",
                    "properties": _SERVICE_NAME_PARAM,
                    "required": ["serviceName"],
                },
            },
        },
    ),
    (
        PrivilegeTier.READ_ONLY,
        {
            "type": "function",
            "function": {
                "name": "get_dependencies",
                "description": "List the services one service directly depends on.",
                "parameters": {
                    "type": "object",
                    "properties": _SERVICE_NAME_PARAM,
                    "required": ["serviceName"],
                },
            },
        },
    ),
    (
        PrivilegeTier.READ_ONLY,
        {
            "type": "function",
            "function": {
                "name": "get_dependents",
                "description": "List the services that directly depend on one service.",
                "parameters": {
                    "type": "object",
                    "properties": _SERVICE_NAME_PARAM,
                    "required": ["serviceName"],
                },
            },
        },
    ),
    (
        PrivilegeTier.READ_ONLY,
        {
            "type": "function",
            "function": {
                "name": "get_service_metrics",
                "description": "Get recent metrics samples (latency, error rate, traffic) for one service, newest first.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        **_SERVICE_NAME_PARAM,
                        "limit": {"type": "integer", "description": "Max samples to return (default 20).", "default": 20},
                    },
                    "required": ["serviceName"],
                },
            },
        },
    ),
    (
        PrivilegeTier.READ_ONLY,
        {
            "type": "function",
            "function": {
                "name": "get_recent_events",
                "description": "List recent operational events (status changes, deployments, scaling), optionally filtered to one service.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "serviceName": {"type": "string", "description": "Optional: limit to this service's events."},
                        "limit": {"type": "integer", "description": "Max events to return (default 20).", "default": 20},
                    },
                },
            },
        },
    ),
    (
        PrivilegeTier.READ_ONLY,
        {
            "type": "function",
            "function": {
                "name": "get_incident_history",
                "description": "List past and current incidents, optionally filtered by status.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "enum": ["open", "investigating", "resolved"],
                            "description": "Optional: only incidents in this status.",
                        },
                        "limit": {"type": "integer", "description": "Max incidents to return (default 20).", "default": 20},
                    },
                },
            },
        },
    ),
    (
        PrivilegeTier.READ_ONLY,
        {
            "type": "function",
            "function": {
                "name": "get_current_system_state",
                "description": "Get a summary of the whole system right now: every service plus a count of services by health status.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ),
    # ---- Simulation (deterministic, read-only w.r.t. real state) -------
    (
        PrivilegeTier.SIMULATION,
        {
            "type": "function",
            "function": {
                "name": "simulate_service_failure",
                "description": "Deterministically compute what happens if one service fails completely (cascades to every transitive dependent).",
                "parameters": {
                    "type": "object",
                    "properties": _SERVICE_NAME_PARAM,
                    "required": ["serviceName"],
                },
            },
        },
    ),
    (
        PrivilegeTier.SIMULATION,
        {
            "type": "function",
            "function": {
                "name": "simulate_traffic_increase",
                "description": "Deterministically compute the impact of a traffic multiplier on one service and everything it depends on.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        **_SERVICE_NAME_PARAM,
                        "multiplier": {"type": "number", "description": "Traffic multiplier, e.g. 3 for 3x current traffic."},
                    },
                    "required": ["serviceName", "multiplier"],
                },
            },
        },
    ),
    (
        PrivilegeTier.SIMULATION,
        {
            "type": "function",
            "function": {
                "name": "simulate_database_failure",
                "description": "Deterministically compute the system-wide impact of the shared database failing.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ),
    (
        PrivilegeTier.SIMULATION,
        {
            "type": "function",
            "function": {
                "name": "simulate_cache_failure",
                "description": "Deterministically compute the system-wide impact of the shared cache failing.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ),
    (
        PrivilegeTier.SIMULATION,
        {
            "type": "function",
            "function": {
                "name": "simulate_high_latency",
                "description": "Deterministically compute the impact of one service becoming slow, propagated to its callers.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        **_SERVICE_NAME_PARAM,
                        "latencyMultiplier": {"type": "number", "description": "Latency multiplier, e.g. 5 for 5x current p99 latency."},
                    },
                    "required": ["serviceName", "latencyMultiplier"],
                },
            },
        },
    ),
    (
        PrivilegeTier.SIMULATION,
        {
            "type": "function",
            "function": {
                "name": "simulate_high_error_rate",
                "description": "Deterministically compute the impact of one service returning more errors, propagated to its callers.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        **_SERVICE_NAME_PARAM,
                        "errorRateMultiplier": {"type": "number", "description": "Error-rate multiplier, e.g. 10 for 10x current error rate."},
                    },
                    "required": ["serviceName", "errorRateMultiplier"],
                },
            },
        },
    ),
    (
        PrivilegeTier.SIMULATION,
        {
            "type": "function",
            "function": {
                "name": "calculate_blast_radius",
                "description": "List every service that transitively depends on one service (what would be affected if it went down).",
                "parameters": {
                    "type": "object",
                    "properties": _SERVICE_NAME_PARAM,
                    "required": ["serviceName"],
                },
            },
        },
    ),
    (
        PrivilegeTier.SIMULATION,
        {
            "type": "function",
            "function": {
                "name": "find_bottleneck",
                "description": "Rank every service by how many other services would be affected if it failed right now, given current real health.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ),
    # ---- Knowledge retrieval (RAG, Phase 13) --------------------------
    (
        PrivilegeTier.KNOWLEDGE_RETRIEVAL,
        {
            "type": "function",
            "function": {
                "name": "search_knowledge_base",
                "description": (
                    "Search runbooks, architecture docs, and incident reports for documented "
                    "operational guidance -- recovery procedures, troubleshooting steps, and "
                    "past-incident writeups. Use this for questions like 'what is the recovery "
                    "procedure for...', 'what should I check if...', or 'how do I troubleshoot...' "
                    "that need documented guidance rather than live system data. This never "
                    "returns live metrics, health, or topology -- use a get_*/simulate_* tool for "
                    "that instead. Returns an empty result list (not an error) when nothing in the "
                    "knowledge base is relevant enough to the query."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The question or topic to search the knowledge base for.",
                        },
                        "topK": {
                            "type": "integer",
                            "description": "Max chunks to return (default 5).",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            },
        },
    ),
    # ---- Privileged --------------------------------------------------
    (
        PrivilegeTier.PRIVILEGED_SAFE,
        {
            "type": "function",
            "function": {
                "name": "recommend_scaling",
                "description": "Get a scaling recommendation for one service based on its current real health. Returns a recommendation only -- never scales anything.",
                "parameters": {
                    "type": "object",
                    "properties": _SERVICE_NAME_PARAM,
                    "required": ["serviceName"],
                },
            },
        },
    ),
    (
        PrivilegeTier.PRIVILEGED_MUTATING,
        {
            "type": "function",
            "function": {
                "name": "create_incident",
                "description": (
                    "Propose creating a new incident record. This is a MUTATING, PRIVILEGED action: calling "
                    "it does not actually create the incident -- it requires explicit operator approval, which "
                    "this platform does not yet automate. Use it to formally propose an incident when you "
                    "believe one is warranted; the proposal is returned to the caller, not executed."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "serviceName": {"type": "string"},
                        "severity": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                        "affectedServiceNames": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["title", "description", "serviceName", "severity"],
                },
            },
        },
    ),
]

TOOL_SCHEMAS: list[dict] = [schema for _tier, schema in TOOL_DEFINITIONS]
TOOL_PRIVILEGE: dict[str, PrivilegeTier] = {schema["function"]["name"]: tier for tier, schema in TOOL_DEFINITIONS}
