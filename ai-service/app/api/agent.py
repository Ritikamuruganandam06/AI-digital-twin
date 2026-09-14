"""
POST /agent/invoke -- the endpoint docs/architecture.md §3's sequence
diagram shows the Node backend calling ("BE->>AI: POST /agent/invoke
(question, context)"). Phase 10 exposed it directly for the AI service's
own verification (curl/tests); Phase 14 is the phase that finally wires
the Node backend to actually call it, from
backend/src/services/assistant.service.ts, and persist exactly what
comes back as an agent execution trace (AI_SERVICE_URL had sat unused in
backend/.env since Phase 1 until then). Phase 13 added `is_rag_query` to
each step; Phase 14 adds `timestamp` -- both exist specifically so the
backend's persisted trace doesn't have to invent or re-derive either
value itself.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.agent.loop import run_agent

router = APIRouter(prefix="/agent", tags=["agent"])


class AgentInvokeRequest(BaseModel):
    question: str = Field(..., min_length=1, description="The operational question to investigate.")


class ToolCallStepResponse(BaseModel):
    tool_name: str
    arguments: dict
    result: dict
    is_rag_query: bool = False
    timestamp: str


class AgentInvokeResponse(BaseModel):
    answer: str
    steps: list[ToolCallStepResponse]
    iterations: int
    stopped_reason: str


@router.post("/invoke", response_model=AgentInvokeResponse)
async def invoke_agent(payload: AgentInvokeRequest) -> AgentInvokeResponse:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question must not be empty")

    result = await run_agent(question)

    return AgentInvokeResponse(
        answer=result.answer,
        steps=[
            ToolCallStepResponse(
                tool_name=s.tool_name,
                arguments=s.arguments,
                result=s.result,
                is_rag_query=s.is_rag_query,
                timestamp=s.timestamp,
            )
            for s in result.steps
        ],
        iterations=result.iterations,
        stopped_reason=result.stopped_reason,
    )
