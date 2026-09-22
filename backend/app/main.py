import base64
import json
import os
from datetime import datetime, timezone
from typing import Literal

import boto3
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from mangum import Mangum
from .logistics_api import router as logistics_router

app = FastAPI(title="BgTrans IA Camera API", version="0.2.0")
app.include_router(logistics_router)
allowed_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if os.getenv("FRONTEND_ORIGIN"):
    allowed_origins.extend(origin.strip() for origin in os.getenv("FRONTEND_ORIGIN", "").split(",") if origin.strip())
if not os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
    app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


class AnalyzeRequest(BaseModel):
    image: str = Field(min_length=20)
    camera_id: str = "webcam-local"
    source: str = "localhost"
    motion_detected: bool = False


class AnalyzeResponse(BaseModel):
    status: Literal["normal", "alert"]
    label: str
    title: str
    detail: str
    confidence: int
    camera_id: str
    analyzed_at: str
    provider: str
    usage: dict[str, int] | None = None
    model_id: str | None = None


def now():
    return datetime.now(timezone.utc).isoformat()


def decode_image(data_url: str) -> bytes:
    try:
        _, encoded = data_url.split(",", 1)
        return base64.b64decode(encoded)
    except (ValueError, base64.binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="La imagen no tiene un formato base64 válido") from exc


def mock_analysis(payload: AnalyzeRequest) -> AnalyzeResponse:
    if payload.motion_detected:
        return AnalyzeResponse(status="alert", label="Movimiento", title="Movimiento detectado", detail="La captura contiene actividad visual. Revisa la imagen y confirma si corresponde a una operación prevista.", confidence=90, camera_id=payload.camera_id, analyzed_at=now(), provider="mock")
    return AnalyzeResponse(status="normal", label="Revisión visual", title="Sin incidencia visible", detail="La captura ha sido recibida correctamente. El backend está funcionando en modo simulado.", confidence=92, camera_id=payload.camera_id, analyzed_at=now(), provider="mock")


def bedrock_analysis(payload: AnalyzeRequest) -> AnalyzeResponse:
    model_id = os.getenv("BEDROCK_MODEL_ID")
    if not model_id:
        raise HTTPException(status_code=503, detail="Falta configurar BEDROCK_MODEL_ID")
    image_bytes = decode_image(payload.image)
    client = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "eu-west-1"))
    active_language = os.getenv("APP_LANGUAGE", "es").lower()
    language_name = "español" if active_language.startswith("es") else active_language
    prompt = f"""Analiza esta imagen para un sistema de monitorización operativa. Puedes detectar y describir la presencia de un rostro visible, pero no identifiques a la persona, no intentes reconocerla y no infieras su identidad. Distingue claramente entre detectar un rostro y reconocer una identidad. Devuelve únicamente JSON válido con estas claves: status (normal o alert), label, title, detail y confidence (entero 0-100). Describe solo lo visible. Si hay una persona, un rostro visible o movimiento, indícalo explícitamente como presencia o actividad visual. Si el rostro es demasiado pequeño, está oculto o no se ve con claridad, indícalo también. Escribe siempre label, title y detail completamente en {language_name}; no uses inglés en esos campos."""
    try:
        response = client.converse(modelId=model_id, messages=[{"role": "user", "content": [{"text": prompt}, {"image": {"format": "jpeg", "source": {"bytes": image_bytes}}}]}], inferenceConfig={"maxTokens": 300, "temperature": 0})
        text = "".join(item.get("text", "") for item in response.get("output", {}).get("message", {}).get("content", []))
        result = json.loads(text[text.find("{"):text.rfind("}") + 1])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Error analizando la imagen con Bedrock: {exc}") from exc
    token_usage = response.get("usage", {})
    return AnalyzeResponse(status=result.get("status", "normal"), label=result.get("label", "Revisión visual"), title=result.get("title", "Resultado de análisis"), detail=result.get("detail", "Sin detalle disponible"), confidence=max(0, min(100, int(result.get("confidence", 0)))), camera_id=payload.camera_id, analyzed_at=now(), provider="bedrock", usage={"input_tokens": token_usage.get("inputTokens", 0), "output_tokens": token_usage.get("outputTokens", 0), "total_tokens": token_usage.get("totalTokens", 0)}, model_id=model_id)


@app.get("/health")
def health():
    return {"status": "ok", "service": "ia-cam-system", "provider": os.getenv("ANALYSIS_PROVIDER", "mock")}


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest):
    if os.getenv("ANALYSIS_PROVIDER", "mock").lower() == "bedrock":
        return bedrock_analysis(payload)
    return mock_analysis(payload)


handler = Mangum(app)
