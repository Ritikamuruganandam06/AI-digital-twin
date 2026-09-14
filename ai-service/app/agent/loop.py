"""
The agent orchestration loop (docs/phases.md row 10: "tool execution loop
against backend tool API"; row 13: "Full decision logic (tools/RAG/both/
neither)"; docs/architecture.md §8, §14).

RAG (§8 step 4) is now wired in as of Phase 13 -- not as a second,
separately-invoked code path, but as one more entry in TOOL_SCHEMAS
(search_knowledge_base, app/tools/schemas.py). Per §14, "This decision is
made by the LLM itself via the tool-calling interface ... rather than a
separate hardcoded classifier": there is no if/else here routing
questions to "tools" vs "RAG" -- the same tool-calling loop that has
handled backend tools since Phase 10 now also offers search_knowledge_base,
and SYSTEM_PROMPT below is what teaches Groq when each kind is warranted.
Persisting a full execution trace to MongoDB (§8 step 7, §16) is still
Phase 14's job -- this loop returns its trace as a plain in-memory list in
the HTTP response, which is enough to satisfy this phase's own
verification ("Test matrix of question types produces correct tool/RAG
usage") without a persistence layer that isn't built yet.

The loop never lets the LLM's own text stand in for real data (§1: "The
LLM never invents numbers... every quantitative claim traces back to a
tool call") -- it only ever sends the LLM tool/RAG results that actually
came back from app/tools/executor.py, which only ever calls the real
backend or the real (Phase 11/12) embedding+Qdrant pipeline.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings
from app.llm.groq_client import GroqClientError, GroqConfigError, create_chat_completion
from app.tools.executor import execute_tool_call, get_tool_privilege
from app.tools.schemas import TOOL_SCHEMAS, PrivilegeTier

SYSTEM_PROMPT = (
    "You are an SRE assistant investigating a digital twin of a small e-commerce system "
    "(user, order, payment, inventory, and notification services). Answer only using "
    "information returned by your tools -- never invent service names, metrics, simulation "
    "results, or procedural guidance. You have two kinds of tools, and you decide per "
    "question which (if any) you actually need:\n\n"
    "1. Live-state and simulation tools (get_services, get_service, get_dependencies, "
    "get_dependents, get_service_metrics, get_recent_events, get_incident_history, "
    "get_current_system_state, simulate_service_failure, simulate_traffic_increase, "
    "simulate_database_failure, simulate_cache_failure, simulate_high_latency, "
    "simulate_high_error_rate, calculate_blast_radius, find_bottleneck, recommend_scaling, "
    "create_incident) -- use these for questions about current status, metrics, topology, or "
    "hypothetical 'what happens if X fails / traffic spikes' scenarios. Simulation results are "
    "always computed deterministically by the tool -- never estimate one yourself.\n\n"
    "2. search_knowledge_base -- searches runbooks, architecture docs, and incident reports "
    "for documented operational guidance. Use this for questions about recovery procedures, "
    "troubleshooting steps, or how something works operationally -- not for live data.\n\n"
    "Some questions need both kinds together: e.g. 'Payment service is down, what should I "
    "do?' benefits from a live-state tool call to confirm current status AND "
    "search_knowledge_base for the recovery procedure. Call as many tools of either kind as "
    "the question actually needs, including more than one in sequence -- but call none at all "
    "for a question your own general knowledge already answers (e.g. 'what is a circuit "
    "breaker'), and don't call search_knowledge_base just to pad out an answer that live tools "
    "alone already fully answered. If a tool call returns an error, say so rather than "
    "guessing what it would have returned. If search_knowledge_base returns no results, say "
    "plainly that the knowledge base doesn't cover it rather than inventing a procedure."
)


@dataclass
class ToolCallStep:
    tool_name: str
    arguments: dict[str, Any]
    result: dict[str, Any]
    is_rag_query: bool = False


@dataclass
class AgentResult:
    answer: str
    steps: list[ToolCallStep] = field(default_factory=list)
    iterations: int = 0
    stopped_reason: str = "final_answer"  # or "iteration_limit"


def _extract_reply_text(message: dict[str, Any]) -> str:
    """Same content-or-reasoning fallback get_chat_reply() uses (groq_client.py) -- reasoning models
    (openai/gpt-oss-*) can leave `content` empty in favor of a separate `reasoning` field."""
    content = (message.get("content") or "").strip()
    if content:
        return content
    reasoning = (message.get("reasoning") or message.get("reasoning_content") or "").strip()
    return reasoning


async def run_agent(question: str) -> AgentResult:
    settings = get_settings()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    steps: list[ToolCallStep] = []

    for iteration in range(1, settings.agent_max_iterations + 1):
        try:
            completion = await create_chat_completion(messages, tools=TOOL_SCHEMAS, tool_choice="auto")
        except GroqConfigError as exc:
            return AgentResult(
                answer=f"The AI service is not configured to call Groq: {exc}",
                steps=steps,
                iterations=iteration,
                stopped_reason="groq_error",
            )
        except GroqClientError as exc:
            return AgentResult(
                answer=f"The AI service could not reach Groq: {exc}",
                steps=steps,
                iterations=iteration,
                stopped_reason="groq_error",
            )

        choice = completion["choices"][0]
        message = choice["message"]
        tool_calls = message.get("tool_calls") or []

        if not tool_calls:
            return AgentResult(
                answer=_extract_reply_text(message),
                steps=steps,
                iterations=iteration,
                stopped_reason="final_answer",
            )

        # Echo the assistant's tool-call request back into the conversation
        # verbatim (OpenAI/Groq's protocol requires this before any "tool"
        # role messages responding to it can be sent).
        messages.append({"role": "assistant", "content": message.get("content"), "tool_calls": tool_calls})

        for tool_call in tool_calls:
            function = tool_call.get("function", {})
            name = function.get("name", "")
            raw_arguments = function.get("arguments") or "{}"
            try:
                arguments = json.loads(raw_arguments)
            except json.JSONDecodeError:
                arguments = {}
                result = {"error": f"Could not parse arguments for tool '{name}': {raw_arguments!r}"}
            else:
                try:
                    result = await asyncio.wait_for(
                        execute_tool_call(name, arguments),
                        timeout=settings.agent_tool_timeout_ms / 1000,
                    )
                except asyncio.TimeoutError:
                    result = {"error": f"Tool '{name}' timed out after {settings.agent_tool_timeout_ms}ms"}

            steps.append(
                ToolCallStep(
                    tool_name=name,
                    arguments=arguments,
                    result=result,
                    is_rag_query=get_tool_privilege(name) == PrivilegeTier.KNOWLEDGE_RETRIEVAL,
                )
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.get("id", ""),
                    "name": name,
                    "content": json.dumps(result),
                }
            )

    return AgentResult(
        answer=(
            f"Reached the {settings.agent_max_iterations}-iteration limit before producing a final answer. "
            f"{len(steps)} tool call(s) were made -- see steps for what was learned so far."
        ),
        steps=steps,
        iterations=settings.agent_max_iterations,
        stopped_reason="iteration_limit",
    )
