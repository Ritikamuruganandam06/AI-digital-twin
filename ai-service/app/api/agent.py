"""
POST /agent/invoke -- the endpoint docs/architecture.md §3's sequence
diagram shows the Node backend calling ("BE->>AI: POST /agent/invoke
(question, context)"). Phase 10 exposes it directly for the AI service's
own verification (curl/tests); wiring the Node backend to actually call
it is a later-phase integration (the backend has no code that calls out
to the AI service yet -- AI_SERVICE_URL has sat unused in backend/.env
since Phase 1). Phase 13 adds `is_rag_query` to each step in the response
so a caller can see, per step, whether the agent used a live/simulation
tool or a knowledge-base search -- without this needing a persisted
execution trace, which is still Phase 14's job.
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
                tool_name=s.tool_name, arguments=s.arguments, result=s.result, is_rag_query=s.is_rag_query
            )
            for s in result.steps
        ],
        iterations=result.iterations,
        stopped_reason=result.stopped_reason,
    )
