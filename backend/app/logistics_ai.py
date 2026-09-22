"""Proveedor del asistente logístico: mock local o Amazon Bedrock bajo demanda."""

import json
import os

import boto3
from fastapi import HTTPException

from .logistics_orchestrator import answer_mock_question


def logistics_chat_provider():
    return os.getenv("LOGISTICS_CHAT_PROVIDER", os.getenv("ANALYSIS_PROVIDER", "mock")).lower()


def answer_logistics_question(question, vehicles, analytics):
    provider = logistics_chat_provider()
    if provider != "bedrock":
        return {**answer_mock_question(question, vehicles, analytics), "usage": None}

    model_id = os.getenv("BEDROCK_MODEL_ID")
    if not model_id:
        raise HTTPException(status_code=503, detail="Falta configurar BEDROCK_MODEL_ID para el asistente logístico")

    compact_vehicles = [
        {
            "id": item.get("id"), "route": item.get("route"), "destination": item.get("destination"),
            "status": item.get("status"), "position": item.get("position"), "speed_kmh": item.get("speed_kmh"),
            "delay_minutes": item.get("delay_minutes"), "stop_minutes": item.get("stop_minutes"),
            "tachograph": item.get("tachograph"),
        }
        for item in vehicles
    ]
    evidence = {key: analytics.get(key) for key in ("window_days", "trips_analyzed", "vehicles", "routes", "findings", "records")}
    context = json.dumps({"fleet_now": compact_vehicles, "historical_evidence": evidence}, ensure_ascii=False, separators=(",", ":"))
    system_prompt = (
        "Eres un asistente de análisis operativo para logística. Responde siempre en español y únicamente con los datos del contexto. "
        "Relaciona el estado actual de los vehículos con viajes e incidencias de los últimos días. Señala patrones repetidos, "
        "comparaciones entre ruta planificada y operación observada, paradas y retrasos; prioriza por evidencia y explica por qué. "
        "No inventes causas, localizaciones, predicciones ni datos ausentes. Distingue un hecho observado de una hipótesis. "
        "Para una pregunta de posición, responde primero con la ubicación simulada y el estado actual. "
        "Para una pregunta analítica, usa este formato breve: Hallazgo, Evidencia (vehículos/rutas/registros y cifras del contexto), "
        "Qué conviene comprobar. No des instrucciones legales sobre tacógrafos ni presentes estos datos ficticios como reales. "
        "Las reglas y estadísticas del contexto ya están calculadas; no cambies sus cifras."
    )
    user_prompt = f"Pregunta: {question}\n\nContexto operativo (ficticio): {context}"

    try:
        client = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION", "eu-west-1"))
        response = client.converse(
            modelId=model_id,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": user_prompt}]}],
            inferenceConfig={"maxTokens": 320, "temperature": 0.1},
        )
        answer = "".join(part.get("text", "") for part in response.get("output", {}).get("message", {}).get("content", [])).strip()
        if not answer:
            raise ValueError("Bedrock devolvió una respuesta vacía")
        usage = response.get("usage", {})
        return {
            "answer": answer,
            "provider": "bedrock",
            "model_id": model_id,
            "usage": {
                "input_tokens": usage.get("inputTokens", 0),
                "output_tokens": usage.get("outputTokens", 0),
                "total_tokens": usage.get("totalTokens", 0),
            },
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo completar el análisis logístico con Bedrock: {exc}") from exc
