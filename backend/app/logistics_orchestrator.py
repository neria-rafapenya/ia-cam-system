"""Orquestación de la demo de flota usando exclusivamente datos ficticios."""

from datetime import datetime, timedelta, timezone
from collections import Counter, defaultdict


ROUTE_POINTS = {
    "VH-204": [("Barcelona", 41.3874, 2.1686), ("Granollers", 41.6075, 2.2874), ("Hostalric", 41.7383, 2.6742), ("Girona", 41.9794, 2.8214)],
    "VH-118": [("Barcelona", 41.3874, 2.1686), ("Lleida", 41.6176, 0.6200), ("Fraga", 41.5220, 0.3480), ("Zaragoza", 41.6488, -0.8891)],
    "VH-307": [("Tarragona", 41.1189, 1.2445), ("Valls", 41.2861, 1.2499), ("Montblanc", 41.3764, 1.1616), ("Lleida", 41.6176, 0.6200)],
    "VH-092": [("Girona", 41.9794, 2.8214), ("Hostalric", 41.7383, 2.6742), ("Granollers", 41.6075, 2.2874), ("Barcelona", 41.3874, 2.1686)],
    "VH-411": [("Barcelona", 41.3874, 2.1686), ("Vilafranca", 41.3462, 1.6970), ("El Vendrell", 41.2170, 1.5350), ("Tarragona", 41.1189, 1.2445)],
}

MOCK_TRIPS = [
    ("VH-204", "Barcelona - Girona", 0, 8, 0, "sin incidencia"),
    ("VH-204", "Barcelona - Girona", 1, 31, 45, "cola de muelle"),
    ("VH-204", "Barcelona - Girona", 3, 25, 39, "cola de muelle"),
    ("VH-204", "Barcelona - Girona", 6, 4, 12, "sin incidencia"),
    ("VH-118", "Barcelona - Zaragoza", 0, 19, 31, "espera de carga"),
    ("VH-118", "Barcelona - Zaragoza", 2, 26, 43, "espera de muelle"),
    ("VH-118", "Barcelona - Zaragoza", 5, 12, 18, "sin incidencia"),
    ("VH-307", "Tarragona - Lleida", 0, 27, 46, "revisión operativa"),
    ("VH-307", "Tarragona - Lleida", 2, 10, 13, "sin incidencia"),
    ("VH-307", "Tarragona - Lleida", 4, 42, 51, "revisión operativa"),
    ("VH-092", "Girona - Barcelona", 0, 0, 0, "sin incidencia"),
    ("VH-092", "Girona - Barcelona", 4, 7, 9, "sin incidencia"),
    ("VH-411", "Barcelona - Tarragona", 0, 34, 22, "congestión en acceso"),
    ("VH-411", "Barcelona - Tarragona", 2, 37, 41, "congestión en acceso"),
    ("VH-411", "Barcelona - Tarragona", 5, 11, 16, "sin incidencia"),
]


def _build_history_and_analytics(now):
    history = [
        {
            "trip_id": f"TR-{index:03d}", "vehicle_id": vehicle_id, "route": route,
            "days_ago": days_ago, "delay_minutes": delay, "stop_minutes": stop,
            "event": event,
        }
        for index, (vehicle_id, route, days_ago, delay, stop, event) in enumerate(MOCK_TRIPS, start=1)
    ]
    by_vehicle = defaultdict(list)
    by_route = defaultdict(list)
    for trip in history:
        by_vehicle[trip["vehicle_id"]].append(trip)
        by_route[trip["route"]].append(trip)

    vehicles = []
    for vehicle_id, trips in by_vehicle.items():
        repeated_events = Counter(trip["event"] for trip in trips if trip["event"] != "sin incidencia")
        vehicles.append({
            "vehicle_id": vehicle_id,
            "trips": len(trips),
            "average_delay_minutes": round(sum(t["delay_minutes"] for t in trips) / len(trips), 1),
            "delays_over_20_minutes": sum(t["delay_minutes"] >= 20 for t in trips),
            "long_stops_over_40_minutes": sum(t["stop_minutes"] >= 40 for t in trips),
            "repeated_events": [{"event": event, "count": count} for event, count in repeated_events.most_common()],
        })

    routes = []
    for route, trips in by_route.items():
        routes.append({
            "route": route,
            "trips": len(trips),
            "average_delay_minutes": round(sum(t["delay_minutes"] for t in trips) / len(trips), 1),
            "stops_over_40_minutes": sum(t["stop_minutes"] >= 40 for t in trips),
        })
    routes.sort(key=lambda item: item["average_delay_minutes"], reverse=True)

    findings = []
    for item in sorted(vehicles, key=lambda value: value["average_delay_minutes"], reverse=True):
        if item["delays_over_20_minutes"] >= 2 or item["long_stops_over_40_minutes"] >= 2 or item["repeated_events"]:
            events = ", ".join(f"{entry['event']} ({entry['count']} veces)" for entry in item["repeated_events"])
            findings.append({
                "title": f"Patrón recurrente en {item['vehicle_id']}",
                "detail": f"{item['delays_over_20_minutes']} de {item['trips']} viajes superaron 20 min de retraso; "
                          f"{item['long_stops_over_40_minutes']} paradas superaron 40 min. "
                          f"Incidencias repetidas: {events or 'ninguna registrada'}.",
                "evidence": item,
            })

    return {
        "window_days": 7,
        "trips_analyzed": len(history),
        "vehicles": vehicles,
        "routes": routes,
        "findings": findings[:4],
        "records": history,
        "generated_at": now.isoformat(),
    }


def _position_on_route(points, progress):
    segment_position = min(progress, 99.99) / 100 * (len(points) - 1)
    index = min(int(segment_position), len(points) - 2)
    fraction = segment_position - index
    start, end = points[index], points[index + 1]
    return {
        "name": f"Entre {start[0]} y {end[0]}",
        "latitude": round(start[1] + (end[1] - start[1]) * fraction, 5),
        "longitude": round(start[2] + (end[2] - start[2]) * fraction, 5),
    }


def build_logistics_snapshot():
    """Devuelve una lectura logística simulada sin consultar AWS ni Bedrock."""
    now = datetime.now(timezone.utc)
    vehicles = [
        {
            "id": "VH-204", "plate": "0000 DEM", "driver": "Conductor 01",
            "route": "Barcelona - Girona", "destination": "Girona",
            "status": "En ruta", "status_key": "moving", "progress": 68,
            "location": "AP-7 · tramo norte", "speed_kmh": 72, "route_duration_minutes": 150,
            "delay_minutes": 8, "stop_minutes": 0,
            "tachograph": {"driving_hours": 4.2, "break_due_minutes": 48, "state": "Conducción"},
            "updated_at": (now - timedelta(minutes=2)).isoformat(),
        },
        {
            "id": "VH-118", "plate": "0000 DEM", "driver": "Conductor 02",
            "route": "Barcelona - Zaragoza", "destination": "Zaragoza",
            "status": "En espera", "status_key": "waiting", "progress": 42,
            "location": "Centro logístico · muelle 4", "speed_kmh": 0, "route_duration_minutes": 340,
            "delay_minutes": 19, "stop_minutes": 31,
            "tachograph": {"driving_hours": 3.6, "break_due_minutes": 84, "state": "Otros trabajos"},
            "updated_at": (now - timedelta(minutes=4)).isoformat(),
        },
        {
            "id": "VH-307", "plate": "0000 DEM", "driver": "Conductor 03",
            "route": "Tarragona - Lleida", "destination": "Lleida",
            "status": "Revisar parada", "status_key": "alert", "progress": 55,
            "location": "Área de servicio · ruta simulada", "speed_kmh": 0, "route_duration_minutes": 120,
            "delay_minutes": 27, "stop_minutes": 46,
            "tachograph": {"driving_hours": 5.1, "break_due_minutes": 16, "state": "Parada"},
            "updated_at": (now - timedelta(minutes=7)).isoformat(),
        },
        {
            "id": "VH-092", "plate": "0000 DEM", "driver": "Conductor 04",
            "route": "Girona - Barcelona", "destination": "Barcelona",
            "status": "En ruta", "status_key": "moving", "progress": 81,
            "location": "C-32 · tramo sur", "speed_kmh": 64, "route_duration_minutes": 150,
            "delay_minutes": 0, "stop_minutes": 0,
            "tachograph": {"driving_hours": 2.8, "break_due_minutes": 132, "state": "Conducción"},
            "updated_at": (now - timedelta(minutes=1)).isoformat(),
        },
        {
            "id": "VH-411", "plate": "0000 DEM", "driver": "Conductor 05",
            "route": "Barcelona - Tarragona", "destination": "Tarragona",
            "status": "Retraso", "status_key": "delayed", "progress": 36,
            "location": "Zona logística · acceso B", "speed_kmh": 24, "route_duration_minutes": 100,
            "delay_minutes": 34, "stop_minutes": 22,
            "tachograph": {"driving_hours": 4.7, "break_due_minutes": 29, "state": "Parada"},
            "updated_at": (now - timedelta(minutes=6)).isoformat(),
        },
    ]

    for vehicle in vehicles:
        vehicle["route_points"] = ROUTE_POINTS[vehicle["id"]]
        vehicle["position"] = _position_on_route(vehicle["route_points"], vehicle["progress"])
        if vehicle["speed_kmh"] == 0:
            fixed_positions = {
                "VH-118": {"name": "Centro logístico · muelle 4", "latitude": 41.39420, "longitude": 2.17410},
                "VH-307": {"name": "Área de servicio · zona simulada", "latitude": 41.28610, "longitude": 1.24990},
            }
            vehicle["position"] = fixed_positions[vehicle["id"]]

    events = []
    for vehicle in vehicles:
        if vehicle["stop_minutes"] >= 40:
            events.append({
                "id": f"evt-stop-{vehicle['id']}", "severity": "alert", "kind": "Parada prolongada",
                "title": f"{vehicle['id']} supera el tiempo de parada de referencia",
                "detail": f"{vehicle['stop_minutes']} min detenido; revisar el contexto y la planificación.",
                "vehicle_id": vehicle["id"], "occurred_at": (now - timedelta(minutes=3)).isoformat(),
            })
        if vehicle["delay_minutes"] >= 25:
            events.append({
                "id": f"evt-delay-{vehicle['id']}", "severity": "warning", "kind": "Desviación de ruta",
                "title": f"{vehicle['id']} acumula {vehicle['delay_minutes']} min de retraso",
                "detail": "Comparación simulada con el horario previsto.",
                "vehicle_id": vehicle["id"], "occurred_at": (now - timedelta(minutes=8)).isoformat(),
            })
        if vehicle["tachograph"]["break_due_minutes"] <= 20:
            events.append({
                "id": f"evt-break-{vehicle['id']}", "severity": "info", "kind": "Tacógrafo",
                "title": f"Descanso próximo para {vehicle['id']}",
                "detail": f"El dato simulado indica {vehicle['tachograph']['break_due_minutes']} min hasta el descanso previsto.",
                "vehicle_id": vehicle["id"], "occurred_at": (now - timedelta(minutes=12)).isoformat(),
            })

    analytics = _build_history_and_analytics(now)
    history = analytics["records"]
    return {
        "provider": "mock",
        "generated_at": now.isoformat(),
        "simulation_rate": 20,
        "notice": "Datos ficticios para demostración; no representan vehículos ni operaciones reales.",
        "summary": {
            "vehicles_total": len(vehicles),
            "vehicles_moving": sum(v["status_key"] == "moving" for v in vehicles),
            "attention_count": sum(v["status_key"] in {"alert", "delayed"} for v in vehicles),
            "average_delay_minutes": round(sum(v["delay_minutes"] for v in vehicles) / len(vehicles)),
            "stopped_count": sum(v["stop_minutes"] > 0 for v in vehicles),
        },
        "vehicles": vehicles,
        "events": events,
        "history": history,
        "analytics": analytics,
    }


def answer_mock_question(question, vehicles, analytics=None):
    """Responde a consultas de demo usando solo el contexto enviado por la UI."""
    import re
    import unicodedata

    normalized = unicodedata.normalize("NFKD", question.lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    match = re.search(r"\b(?:vh\s*-?\s*)?(\d{2,4})\b", normalized)
    vehicle = next((item for item in vehicles if match and item.get("id", "").replace("VH-", "") == match.group(1)), None)
    if vehicle and any(word in normalized for word in ("donde", "posicion", "ubicacion", "hall", "localiz")):
        position = vehicle.get("position", {})
        answer = (
            f"{vehicle['id']} figura {position.get('name', vehicle.get('location', 'en una ubicación simulada'))}, "
            f"en la ruta {vehicle.get('route', 'sin ruta indicada')} hacia {vehicle.get('destination', 'destino no indicado')}. "
            f"Coordenadas simuladas: {position.get('latitude', '—')}, {position.get('longitude', '—')}. "
            f"Estado: {vehicle.get('status', 'sin estado')}; velocidad simulada: {vehicle.get('speed_kmh', 0)} km/h."
        )
    elif vehicle and any(word in normalized for word in ("parada", "espera", "detenido")):
        answer = f"{vehicle['id']} acumula {vehicle.get('stop_minutes', 0)} min de parada simulada. El dato debe contrastarse con la operación real y el umbral acordado."
    elif vehicle and any(word in normalized for word in ("tacografo", "descanso", "conduccion")):
        tachograph = vehicle.get("tachograph", {})
        answer = f"Lectura simulada de {vehicle['id']}: {tachograph.get('state', 'sin estado')}, {tachograph.get('driving_hours', 0)} h de conducción y descanso previsto en {tachograph.get('break_due_minutes', '—')} min."
    elif vehicle:
        answer = f"{vehicle['id']} va hacia {vehicle.get('destination', 'un destino no indicado')} por la ruta {vehicle.get('route', 'no disponible')}. Estado: {vehicle.get('status', 'sin estado')}; retraso simulado: {vehicle.get('delay_minutes', 0)} min."
    elif analytics and any(word in normalized for word in ("patron", "recurr", "prioridad", "prioritari", "repet", "semana", "analiz", "analiza", "recomiend", "revisar")):
        findings = analytics.get("findings", [])
        answer = "Hallazgos simulados de los últimos 7 días: " + " ".join(
            f"{item['title']}: {item['detail']}" for item in findings[:3]
        ) if findings else "No aparecen recurrencias en la muestra simulada de los últimos 7 días."
        answer += " Estos son indicadores calculados con reglas y datos ficticios, no una conclusión operativa real."
    elif any(word in normalized for word in ("retras", "demora")):
        delayed = sorted((item for item in vehicles if item.get("delay_minutes", 0) > 0), key=lambda item: item["delay_minutes"], reverse=True)
        answer = "Retrasos simulados: " + "; ".join(f"{item['id']}: {item['delay_minutes']} min" for item in delayed[:5]) + "."
    elif any(word in normalized for word in ("parada", "espera")):
        stopped = sorted((item for item in vehicles if item.get("stop_minutes", 0) > 0), key=lambda item: item["stop_minutes"], reverse=True)
        answer = "Paradas simuladas: " + "; ".join(f"{item['id']}: {item['stop_minutes']} min" for item in stopped[:5]) + "."
    else:
        answer = "Puedo consultar posición, ruta, retraso, parada y lectura de tacógrafo de la flota simulada. Indica un vehículo, por ejemplo VH-204."

    return {"answer": answer, "provider": "mock", "generated_at": datetime.now(timezone.utc).isoformat()}
