

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
