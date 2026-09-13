"""
The agent orchestration loop (docs/phases.md row 10: "tool execution loop
against backend tool API"; docs/architecture.md §8 steps 1-3, 5-6).

RAG (§8 step 4) is not part of this phase (Phases 11-12), and persisting
a full execution trace to MongoDB (§8 step 7, §16) is Phase 14's job --
this loop returns its trace as a plain in-memory list in the HTTP
response instead, which is enough to satisfy this phase's own
verification ("LLM calls a tool, tool hits real backend data, result
returned") without a persistence layer that isn't built yet.

The loop never lets the LLM's own text stand in for real data (§1: "The
LLM never invents numbers... every quantitative claim traces back to a
tool call") -- it only ever sends the LLM tool results that actually came
back from app/tools/executor.py, which only ever calls the real backend.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings
from app.llm.groq_client import GroqClientError, GroqConfigError, create_chat_completion
from app.tools.executor import execute_tool_call
from app.tools.schemas import TOOL_SCHEMAS

SYSTEM_PROMPT = (
    "You are an SRE assistant investigating a digital twin of a small e-commerce system "
    "(user, order, payment, inventory, and notification services). Answer only using "
    "information returned by your tools -- never invent service names, metrics, or "
    "simulation results. Call whichever tools you need, including more than one in "
    "sequence, before giving a final answer. If a tool call returns an error, say so "
    "rather than guessing what it would have returned. For a hypothetical / what-if "
    "question, use a simulate_* or calculate_blast_radius/find_bottleneck tool rather "
    "than reasoning about it yourself."
)


@dataclass
class ToolCallStep:
    tool_name: str
    arguments: dict[str, Any]
    result: dict[str, Any]


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

            steps.append(ToolCallStep(tool_name=name, arguments=arguments, result=result))
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
