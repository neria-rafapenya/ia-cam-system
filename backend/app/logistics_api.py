from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .logistics_ai import answer_logistics_question, logistics_chat_provider
from .logistics_orchestrator import build_logistics_snapshot

router = APIRouter(prefix="/api/logistics", tags=["logística"])


class LogisticsChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    vehicles: list[dict[str, Any]] = Field(default_factory=list)
    analytics: dict[str, Any] = Field(default_factory=dict)


@router.get("/overview")
def logistics_overview():
    """Resumen de flota y señales operativas generado desde mock data."""
    snapshot = build_logistics_snapshot()
    snapshot["chat_provider"] = logistics_chat_provider()
    return snapshot


@router.post("/chat")
def logistics_chat(payload: LogisticsChatRequest):
    """Responde una consulta explícita usando contexto de flota e histórico."""
    return answer_logistics_question(payload.question, payload.vehicles, payload.analytics)
