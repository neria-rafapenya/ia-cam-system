import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Camera, CheckCircle2, CircleHelp, Clock3, Coins, FileImage, Gauge, MapPin, Play, RefreshCw, Route, Send, ShieldCheck, Square, Trash2, Truck, Video, XCircle } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const initialEvents = [{ id: 1, time: 'Ahora', type: 'Sistema', title: 'Cámara lista para monitorización', detail: 'La webcam local está disponible.', status: 'normal' }]
const USAGE_STORAGE_KEY = 'bg-logistics-ai-usage-v1'
const NOVA_2_LITE_REFERENCE_RATES = { inputUsdPerMillion: 0.30, outputUsdPerMillion: 2.50 }
const emptyUsage = { calls: 0, bedrockCalls: 0, mockCalls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, records: [] }

function readUsage() {
  try { return { ...emptyUsage, ...JSON.parse(window.localStorage.getItem(USAGE_STORAGE_KEY) || '{}') } }
  catch { return emptyUsage }
}

function App() {
  const videoRef = useRef(null), captureCanvasRef = useRef(null), motionCanvasRef = useRef(null), streamRef = useRef(null), previousFrameRef = useRef(null), motionStreakRef = useRef(0), lastMotionRef = useRef(0), analyzingRef = useRef(false)
  const [view, setView] = useState('cameras')
  const [lastAiProvider, setLastAiProvider] = useState(null)
  const [usage, setUsage] = useState(readUsage)
  const [cameraState, setCameraState] = useState('idle'), [snapshot, setSnapshot] = useState(null), [analysis, setAnalysis] = useState(null)
  const [events, setEvents] = useState(initialEvents), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [motionActive, setMotionActive] = useState(false), [motionDetected, setMotionDetected] = useState(false)
  const [logistics, setLogistics] = useState(null), [logisticsError, setLogisticsError] = useState(''), [logisticsLoading, setLogisticsLoading] = useState(false)

  useEffect(() => () => stopCamera(), [])
  useEffect(() => { if (cameraState !== 'live' || !motionActive) return undefined; const timer = window.setInterval(checkMotion, 900); return () => window.clearInterval(timer) }, [cameraState, motionActive])
  useEffect(() => {
    if (view !== 'vehicles') return undefined
    let alive = true
    const load = async (initial = false) => {
      if (initial) setLogisticsLoading(true)
      try {
        const response = await fetch(`${API_URL}/api/logistics/overview`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.detail || `El backend ha respondido con HTTP ${response.status}`)
        if (alive) { setLogistics(data); setLogisticsError('') }
      } catch (err) {
        if (alive) setLogisticsError(err?.message || 'No se pudo cargar la simulación logística.')
      } finally { if (alive && initial) setLogisticsLoading(false) }
    }
    load(true)
    return () => { alive = false }
  }, [view])

  function stopCamera() { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; if (videoRef.current) videoRef.current.srcObject = null; previousFrameRef.current = null; motionStreakRef.current = 0; setMotionActive(false); setMotionDetected(false); setCameraState('idle') }
  async function startCamera() { setError(''); try { const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); streamRef.current = stream; setCameraState('live'); requestAnimationFrame(async () => { if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() } }) } catch (err) { setError(`No se pudo acceder a la cámara (${err?.name || 'error desconocido'}). Comprueba los permisos del navegador.`); setCameraState('error') } }
  function captureSnapshot(reason = 'Captura manual') { if (!videoRef.current || !captureCanvasRef.current || cameraState !== 'live') return null; const video = videoRef.current, canvas = captureCanvasRef.current; canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720; canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); const image = canvas.toDataURL('image/jpeg', .82); setSnapshot(image); setAnalysis(null); setError(''); if (reason === 'Movimiento detectado') { setMotionDetected(true); setEvents(current => [{ id: Date.now(), time: 'Ahora', type: 'Movimiento', title: 'Movimiento detectado', detail: 'Se ha generado una captura automática para revisión.', status: 'alert' }, ...current]) } return image }
  function checkMotion() { const video = videoRef.current, canvas = motionCanvasRef.current; if (!video || !canvas || video.readyState < 2) return; const width = 160, height = 90; canvas.width = width; canvas.height = height; const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(video, 0, 0, width, height); const pixels = context.getImageData(0, 0, width, height).data; const previous = previousFrameRef.current; previousFrameRef.current = pixels; if (!previous) return; let difference = 0; for (let i = 0; i < pixels.length; i += 8) difference += Math.abs(pixels[i] - previous[i]) + Math.abs(pixels[i + 1] - previous[i + 1]) + Math.abs(pixels[i + 2] - previous[i + 2]); const averageDifference = difference / (pixels.length / 8) / 3; const movementThreshold = 6; motionStreakRef.current = averageDifference > movementThreshold ? motionStreakRef.current + 1 : Math.max(0, motionStreakRef.current - 1); if (motionStreakRef.current >= 2 && Date.now() - lastMotionRef.current > 10000 && !analyzingRef.current) { lastMotionRef.current = Date.now(); motionStreakRef.current = 0; const image = captureSnapshot('Movimiento detectado'); if (image) analyzeImage(image, true) } }
  function recordAiUsage(provider, tokens, action, modelId) {
    const inputTokens = Number(tokens?.input_tokens || 0), outputTokens = Number(tokens?.output_tokens || 0)
    const isBedrock = provider === 'bedrock'
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), provider: isBedrock ? 'bedrock' : 'mock', action, modelId: modelId || (isBedrock ? 'Amazon Nova 2 Lite' : null), inputTokens, outputTokens }
    const estimatedUsd = isBedrock ? (inputTokens * NOVA_2_LITE_REFERENCE_RATES.inputUsdPerMillion + outputTokens * NOVA_2_LITE_REFERENCE_RATES.outputUsdPerMillion) / 1_000_000 : 0
    setUsage(current => {
      const next = { calls: current.calls + 1, bedrockCalls: current.bedrockCalls + Number(isBedrock), mockCalls: current.mockCalls + Number(!isBedrock), inputTokens: current.inputTokens + inputTokens, outputTokens: current.outputTokens + outputTokens, estimatedUsd: current.estimatedUsd + estimatedUsd, records: [entry, ...current.records].slice(0, 100) }
      try { window.localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(next)) } catch { /* La sesión sigue visible aunque el almacenamiento local esté lleno o bloqueado. */ }
      return next
    })
  }
  async function analyzeImage(image, detected) { if (!image || analyzingRef.current) return; analyzingRef.current = true; setBusy(true); setError(''); try { const response = await fetch(`${API_URL}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, camera_id: 'webcam-local', source: window.location.origin, motion_detected: detected }) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.detail || `El backend ha respondido con HTTP ${response.status}`); setAnalysis(result); setLastAiProvider(result.provider || 'mock'); recordAiUsage(result.provider || 'mock', result.usage, 'Análisis de cámara', result.model_id); setEvents(current => [{ id: Date.now(), time: formatEventTime(result.analyzed_at), type: result.label, title: result.title, detail: result.detail, status: result.status }, ...current]) } catch (err) { setError(err?.message || 'No se pudo conectar con el backend.') } finally { analyzingRef.current = false; setBusy(false) } }
  async function analyzeSnapshot() { analyzeImage(snapshot, motionDetected) }

  const statusText = cameraState === 'live' ? 'En directo' : cameraState === 'error' ? 'Sin permisos' : 'Desconectada'
  const isVehicles = view === 'vehicles', isCosts = view === 'costs'
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">B</div><div><strong>BG Logistics</strong><span>Monitor operativo · demo</span></div></div><nav>
      <button className={view === 'cameras' ? 'active' : ''} onClick={() => setView('cameras')}><Camera size={17}/> Cámaras</button>
      <button className={view === 'vehicles' ? 'active' : ''} onClick={() => setView('vehicles')}><Truck size={17}/> Vehículos</button>
      <button className={isCosts ? 'active' : ''} onClick={() => setView('costs')}><Coins size={17}/> Coste IA</button>
      <button className="nav-static" disabled><AlertTriangle size={17}/> Incidencias <span className="nav-soon">demo</span></button>
      <button className="nav-static" disabled><FileImage size={17}/> Evidencias</button>
    </nav><div className="sidebar-footer"><div className="sidebar-prototype"><ShieldCheck size={15}/> Prototipo de demostración</div><div className={`provider-status ${lastAiProvider || 'unknown'}`}><span className="provider-light"/><div><strong>{lastAiProvider ? `Última respuesta: ${lastAiProvider.toUpperCase()}` : 'IA aún sin consultar'}</strong><small>{lastAiProvider ? 'Proveedor de la última consulta' : 'Se actualizará tras analizar o preguntar'}</small></div></div></div></aside>
    <main className="main-content"><header className="topbar"><div><p className="eyebrow">OPERACIONES · DEMO</p><h1>{isCosts ? 'Consumo estimado de IA' : isVehicles ? 'Seguimiento de vehículos' : 'Monitor de cámaras'}</h1><p className="subtitle">{isCosts ? 'Registro local de inferencias realizadas desde esta aplicación' : isVehicles ? 'Vista simulada de flota, rutas, paradas y señales operativas' : 'Prueba local de movimiento y análisis visual'}</p></div><div className="connection"><span className={`dot ${isCosts || isVehicles || cameraState === 'live' ? 'green' : ''}`}></span>{isCosts ? 'Estimación local' : isVehicles ? 'Datos simulados' : statusText}</div></header>
      {isCosts ? <UsageDashboard usage={usage} onClear={() => { setUsage(emptyUsage); try { window.localStorage.removeItem(USAGE_STORAGE_KEY) } catch { /* Sin almacenamiento persistente, el reinicio afecta a esta sesión. */ } }} /> : isVehicles ? <LogisticsDashboard data={logistics} error={logisticsError} loading={logisticsLoading} onProviderUsed={(provider, tokens, modelId) => { setLastAiProvider(provider); recordAiUsage(provider, tokens, 'Consulta de flota', modelId) }} onRefresh={() => { setLogisticsLoading(true); fetch(`${API_URL}/api/logistics/overview`).then(r => r.json().then(d => { if (!r.ok) throw new Error(d.detail || 'No se pudo actualizar'); return d })).then(d => { setLogistics(d); setLogisticsError('') }).catch(e => setLogisticsError(e.message)).finally(() => setLogisticsLoading(false)) }} /> : <CameraDashboard {...{ videoRef, captureCanvasRef, motionCanvasRef, cameraState, statusText, startCamera, stopCamera, captureSnapshot, snapshot, setSnapshot, setAnalysis, analysis, motionDetected, setMotionDetected, analyzeSnapshot, busy, events, setEvents, motionActive, setMotionActive, error, setError }} />}
    </main></div>
}

function CameraDashboard({ videoRef, captureCanvasRef, motionCanvasRef, cameraState, statusText, startCamera, stopCamera, captureSnapshot, snapshot, setSnapshot, setAnalysis, analysis, motionDetected, setMotionDetected, analyzeSnapshot, busy, events, setEvents, motionActive, setMotionActive, error, setError }) {
  return <><section className="content-grid"><div className="primary-column"><section className="panel camera-panel"><div className="panel-heading"><div><h2>Webcam local</h2><p>La cámara se utiliza solo mientras esta pantalla permanezca abierta.</p></div><span className="badge"><span className={`dot ${cameraState === 'live' ? 'green' : ''}`}></span>{statusText}</span></div><div className="video-frame"><video ref={videoRef} muted playsInline className={cameraState === 'live' ? 'video-active' : 'video-hidden'} />{cameraState !== 'live' && <div className="video-placeholder"><Video size={42}/><strong>La cámara aún no está activa</strong><span>Concede permiso al navegador para iniciar la monitorización.</span></div>}{cameraState === 'live' && <div className="live-label"><span className="record-dot"></span> EN DIRECTO</div>}</div><canvas ref={captureCanvasRef} className="hidden"/><canvas ref={motionCanvasRef} className="hidden"/><div className="camera-actions">{cameraState === 'live' ? <button className="button secondary" onClick={stopCamera}><Square size={16}/> Detener cámara</button> : <button className="button primary" onClick={startCamera}><Play size={16}/> Activar cámara</button>}<button className="button secondary" disabled={cameraState !== 'live'} onClick={() => captureSnapshot()}><Camera size={16}/> Capturar imagen</button><button className={`button ${motionActive ? 'motion-on' : 'secondary'}`} disabled={cameraState !== 'live'} onClick={() => setMotionActive(current => !current)}><RefreshCw size={16}/> {motionActive ? 'Detección activa' : 'Detectar movimiento'}</button></div></section>
      <section className="panel snapshot-panel"><div className="panel-heading"><div><h2>Última captura</h2><p>Imagen que se enviará al análisis inicial.</p></div>{snapshot && <button className="icon-button" onClick={() => { setSnapshot(null); setAnalysis(null); setMotionDetected(false) }} aria-label="Eliminar captura"><XCircle size={18}/></button>}</div>{snapshot ? <div className="snapshot-content"><img src={snapshot} alt="Última captura de la webcam"/><div className="analysis-box">{analysis ? <><div className="analysis-status"><StatusIcon status={analysis.status}/><div><span className="small-label">RESULTADO DEL ANÁLISIS</span><strong>{analysis.title}</strong></div></div><p>{analysis.detail}</p><span className="confidence">Confianza: {analysis.confidence}% · Proveedor: {analysis.provider || 'mock'}</span></> : <><CircleHelp size={20}/><p>{motionDetected ? 'Se ha detectado movimiento. Analiza la captura para clasificar el evento.' : 'La captura está lista. Ejecuta el análisis para generar una incidencia o confirmar un estado normal.'}</p><button className="button primary" onClick={analyzeSnapshot} disabled={busy}>{busy ? <RefreshCw className="spin" size={16}/> : <ShieldCheck size={16}/>} {busy ? 'Analizando…' : 'Analizar imagen'}</button></>}</div></div> : <div className="empty-state"><Camera size={28}/><p>Captura una imagen para comenzar.</p></div>}</section></div>
      <aside className="side-column"><section className="panel summary-panel"><div className="panel-heading"><div><h2>Estado de la demo</h2><p>Resumen de esta sesión</p></div></div><SummaryRow label="Fuente" value="Webcam local"/><SummaryRow label="Capturas" value={snapshot ? '1' : '0'}/><SummaryRow label="Movimiento" value={motionActive ? 'Activo' : 'Inactivo'} active={motionActive}/><SummaryRow label="Incidencias" value={events.filter(e => e.status === 'alert').length} alert={events.some(e => e.status === 'alert')}/></section><section className="panel events-panel"><div className="panel-heading"><div><h2>Actividad reciente</h2><p>Eventos generados en esta sesión</p></div><button className="icon-button" onClick={() => setEvents([])} aria-label="Limpiar actividad"><RefreshCw size={17}/></button></div>{events.length ? <div className="event-list">{events.map(event => <EventItem event={event} key={event.id}/>)}</div> : <div className="empty-activity">No hay actividad registrada.</div>}</section></aside></section>{error && <div className="error-banner"><AlertTriangle size={17}/>{error}</div>}</>
}

function LogisticsDashboard({ data, error, loading, onRefresh, onProviderUsed }) {
  const [clockNow, setClockNow] = useState(Date.now())
  const [question, setQuestion] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatMessages, setChatMessages] = useState([{ role: 'assistant', text: 'Puedo relacionar la situación actual con los viajes e incidencias simulados de los últimos 7 días para explicar recurrencias y prioridades.' }])
  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  if (!data && loading) return <section className="panel loading-panel"><RefreshCw className="spin" size={20}/> Cargando datos simulados de flota…</section>
  if (!data) return <section className="panel logistics-error"><AlertTriangle size={19}/><div><strong>No se pudo cargar la simulación</strong><p>{error || 'Comprueba que el backend está iniciado.'}</p><button className="button primary" onClick={onRefresh}>Reintentar</button></div></section>
  const { summary, events } = data
  const vehicles = data.vehicles.map(vehicle => getSimulatedVehicle(vehicle, data.generated_at, clockNow, data.simulation_rate || 1))
  async function sendQuestion(event) {
    event.preventDefault()
    const text = question.trim()
    if (!text || chatBusy) return
    setQuestion('')
    setChatMessages(current => [...current, { role: 'user', text }])
    setChatBusy(true)
    try {
      const response = await fetch(`${API_URL}/api/logistics/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, vehicles, analytics: data.analytics }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`)
      onProviderUsed(result.provider || 'mock', result.usage, result.model_id)
      setChatMessages(current => [...current, { role: 'assistant', text: result.answer, provider: result.provider, usage: result.usage }])
    } catch (err) {
      setChatMessages(current => [...current, { role: 'assistant', text: `No se pudo consultar la flota: ${err.message}` }])
    } finally { setChatBusy(false) }
  }
  return <div className="logistics-view"><div className="demo-notice"><CircleHelp size={16}/><span>{data.notice} La posición se anima en este navegador, sin peticiones periódicas.</span><button className="icon-button" onClick={onRefresh} aria-label="Actualizar datos" title="Actualizar"><RefreshCw size={16}/></button></div>
    <section className="metric-grid"><MetricCard icon={<Truck size={18}/>} label="Vehículos en seguimiento" value={summary.vehicles_total} note={`${summary.vehicles_moving} en ruta`} tone="blue"/><MetricCard icon={<AlertTriangle size={18}/>} label="Requieren atención" value={summary.attention_count} note="Retrasos o paradas a revisar" tone="orange"/><MetricCard icon={<Clock3 size={18}/>} label="Retraso medio" value={`${summary.average_delay_minutes} min`} note="Frente al horario simulado" tone="teal"/><MetricCard icon={<MapPin size={18}/>} label="Con parada registrada" value={summary.stopped_count} note="Tiempos de espera simulados" tone="slate"/></section>
    <section className="panel fleet-panel"><div className="panel-heading"><div><h2>Estado de la flota</h2><p>Posición, trayecto y lectura simulada de tacógrafo</p></div><span className="badge"><span className="dot green"/> Posición animada en pantalla</span></div><div className="table-wrap"><table className="fleet-table"><thead><tr><th>Vehículo / conductor</th><th>Trayecto</th><th>Posición simulada</th><th>Estado</th><th>Parada</th><th>Tacógrafo</th></tr></thead><tbody>{vehicles.map(vehicle => <tr key={vehicle.id}><td><strong>{vehicle.id}</strong><span>{vehicle.driver}</span></td><td><span className="route-cell"><Route size={14}/>{vehicle.route}</span><div className="progress-track"><span style={{ width: `${vehicle.progress}%` }}/></div><small>{vehicle.progress}% del trayecto</small></td><td><span>{vehicle.location}</span><small>{vehicle.position ? `${vehicle.position.latitude.toFixed(5)}, ${vehicle.position.longitude.toFixed(5)}` : 'Coordenada simulada'}</small></td><td><StatusPill status={vehicle.status_key} label={vehicle.status}/>{vehicle.delay_minutes > 0 && <small>+{vehicle.delay_minutes} min</small>}</td><td>{vehicle.stop_minutes ? <><strong>{vehicle.stop_minutes} min</strong><small>tiempo registrado</small></> : <span className="muted-value">En circulación</span>}</td><td><span className="tachograph-state"><Gauge size={14}/>{vehicle.tachograph.state}</span><small>Descanso en {vehicle.tachograph.break_due_minutes} min</small></td></tr>)}</tbody></table></div></section>
    <section className="panel historical-panel"><div className="panel-heading"><div><h2>Patrones en viajes recientes</h2><p>Resumen estadístico de {data.analytics.trips_analyzed} trayectos simulados en los últimos {data.analytics.window_days} días</p></div><span className="provider-chip">EVIDENCIA MOCK</span></div><div className="pattern-list">{data.analytics.findings.map((finding, index) => <article className="pattern-item" key={finding.title}><span className="pattern-rank">0{index + 1}</span><div><strong>{finding.title}</strong><p>{finding.detail}</p></div></article>)}</div><p className="chat-footnote">Las cifras se calculan con reglas reproducibles. El asistente IA las interpreta, relaciona con el estado actual y explica qué convendría comprobar.</p></section>
    <section className="logistics-lower"><div className="panel events-panel"><div className="panel-heading"><div><h2>Actividad logística</h2><p>Eventos de la operación simulada</p></div><span className="provider-chip">ORIGEN: MOCK</span></div><div className="event-list">{events.map(event => <EventItem event={{ id: event.id, time: formatEventTime(event.occurred_at), type: event.kind, title: event.title, detail: event.detail, status: event.severity === 'alert' ? 'alert' : event.severity === 'warning' ? 'warning' : 'normal' }} key={event.id}/>)}</div></div><section className="panel fleet-chat"><div className="panel-heading"><div><h2><Bot size={17}/> Asistente IA de operaciones</h2><p>Relaciona situación actual, rutas e incidencias</p></div><span className="provider-chip">{data.chat_provider === 'bedrock' ? 'BEDROCK' : 'MOCK'}</span></div><div className="chat-messages" aria-live="polite">{chatMessages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${index}-${message.role}`}><span>{message.role === 'assistant' ? 'Asistente' : 'Tú'}</span>{message.role === 'assistant' ? <MarkdownContent text={message.text}/> : <p>{message.text}</p>}{message.provider && <small>{message.provider === 'bedrock' ? `Bedrock${message.usage?.total_tokens ? ` · ${message.usage.total_tokens} tokens` : ''}` : 'Respuesta mock'}</small>}</div>)}{chatBusy && <div className="chat-thinking"><span className="spin-dot"/> Analizando contexto de flota…</div>}</div><div className="chat-suggestions"><button type="button" onClick={() => setQuestion('¿Qué vehículos requieren atención prioritaria y qué evidencias lo indican?')}>Prioridades y evidencias</button><button type="button" onClick={() => setQuestion('¿Qué patrones se repiten entre ruta, retrasos y paradas?')}>Relacionar patrones</button><button type="button" onClick={() => setQuestion('¿Qué debería comprobar primero el equipo de operaciones hoy?')}>Siguiente comprobación</button></div><form className="chat-form" onSubmit={sendQuestion}><input value={question} onChange={event => setQuestion(event.target.value)} placeholder="Pregunta sobre un vehículo, ruta o patrón…" maxLength={500} aria-label="Pregunta sobre la flota"/><button className="button primary" type="submit" disabled={!question.trim() || chatBusy} aria-label="Enviar pregunta">{chatBusy ? <RefreshCw className="spin" size={16}/> : <Send size={16}/>}</button></form><p className="chat-footnote">{data.chat_provider === 'bedrock' ? 'Bedrock se invoca solo al enviar una pregunta. No analiza la posición en segundo plano.' : 'Modo mock. Activa Bedrock para interpretar este contexto al enviar una pregunta.'}</p></section></section>
    {error && <div className="inline-error"><AlertTriangle size={16}/>{error}</div>}
  </div>
}

function UsageDashboard({ usage, onClear }) {
  const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', minimumFractionDigits: 6, maximumFractionDigits: 8 })
  return <div className="usage-dashboard"><section className="usage-metrics"><MetricCard icon={<Coins size={18}/>} label="Coste Bedrock estimado" value={money.format(usage.estimatedUsd)} note="Solo inferencias registradas aquí" tone="blue"/><MetricCard icon={<Bot size={18}/>} label="Llamadas Bedrock" value={usage.bedrockCalls} note={`${usage.inputTokens.toLocaleString('es-ES')} entrada · ${usage.outputTokens.toLocaleString('es-ES')} salida`} tone="teal"/><MetricCard icon={<CircleHelp size={18}/>} label="Respuestas mock" value={usage.mockCalls} note="Coste de inferencia Bedrock: 0 €" tone="slate"/></section>
    <section className="panel usage-panel"><div className="panel-heading"><div><h2>Actividad registrada</h2><p>Hasta 100 últimas respuestas; acumulados conservados en este navegador.</p></div><button className="button secondary usage-clear" onClick={onClear} disabled={!usage.calls}><Trash2 size={15}/> Borrar historial</button></div>
      <div className="usage-disclaimer"><strong>Estimación orientativa, no factura de AWS.</strong><span>Se calcula al recibir cada respuesta, con los tokens informados por el modelo. No incluye otros servicios, impuestos, ajustes de región o tarifa, ni uso fuera de esta aplicación.</span><small>Tarifa de referencia Nova 2 Lite: entrada ${NOVA_2_LITE_REFERENCE_RATES.inputUsdPerMillion}/M tokens · salida ${NOVA_2_LITE_REFERENCE_RATES.outputUsdPerMillion}/M tokens. Verifica la tarifa aplicable a tu región y modalidad en <a href="https://aws.amazon.com/bedrock/pricing/" target="_blank" rel="noreferrer">precios de Amazon Bedrock</a>.</small></div>
      {usage.records.length ? <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>Momento</th><th>Acción</th><th>Proveedor</th><th>Tokens entrada / salida</th><th>Coste estimado</th></tr></thead><tbody>{usage.records.map(record => <tr key={record.id}><td>{new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(record.at))}</td><td>{record.action}</td><td><span className={`provider-chip ${record.provider}`}>{record.provider === 'bedrock' ? 'BEDROCK' : 'MOCK'}</span>{record.modelId && <small>{record.modelId}</small>}</td><td>{record.inputTokens.toLocaleString('es-ES')} / {record.outputTokens.toLocaleString('es-ES')}</td><td>{money.format(record.provider === 'bedrock' ? (record.inputTokens * NOVA_2_LITE_REFERENCE_RATES.inputUsdPerMillion + record.outputTokens * NOVA_2_LITE_REFERENCE_RATES.outputUsdPerMillion) / 1_000_000 : 0)}</td></tr>)}</tbody></table></div> : <div className="usage-empty"><Coins size={23}/><strong>Aún no hay llamadas registradas</strong><span>Las consultas mock y las inferencias Bedrock aparecerán aquí cuando se completen.</span></div>}
    </section></div>
}
function MarkdownContent({ text }) {
  const lines = String(text || '').split(/\r?\n/), blocks = []
  const listMarker = line => line.match(/^\s*([-*+]\s+|\d+[.)]\s+)(.*)$/)
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim()
    if (!line) { i++; continue }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) { blocks.push({ type: `h${heading[1].length + 2}`, text: heading[2] }); i++; continue }
    const marker = listMarker(lines[i])
    if (marker) {
      const ordered = /^\d/.test(marker[1].trim()), items = []
      while (i < lines.length) {
        const item = listMarker(lines[i])
        if (!item || /^\d/.test(item[1].trim()) !== ordered) break
        items.push(item[2]); i++
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items }); continue
    }
    const paragraph = [line]; i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s+/.test(lines[i].trim()) && !listMarker(lines[i])) paragraph.push(lines[i++].trim())
    blocks.push({ type: 'p', text: paragraph.join(' ') })
  }
  return <div className="markdown-content">{blocks.map((block, index) => {
    if (block.type === 'ul' || block.type === 'ol') {
      const List = block.type
      return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</List>
    }
    const Tag = block.type
    return <Tag key={index}>{renderInlineMarkdown(block.text)}</Tag>
  })}</div>
}
function renderInlineMarkdown(text) {
  const token = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g
  return String(text).split(token).filter(Boolean).map((part, index) => {
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    return part
  })
}
function MetricCard({ icon, label, value, note, tone }) { return <div className="panel metric-card"><span className={`metric-icon ${tone}`}>{icon}</span><div><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small></div></div> }
function SummaryRow({ label, value, active, alert }) { return <div className="summary-row"><span>{label}</span><strong className={active ? 'active-text' : alert ? 'alert-text' : ''}>{value}</strong></div> }
function EventItem({ event }) { return <div className="event"><StatusIcon status={event.status}/><div><strong>{event.title}</strong><span>{event.detail}</span><small>{event.time} · {event.type}</small></div></div> }
function StatusPill({ status, label }) { return <span className={`status-pill ${status}`}>{label}</span> }
function getSimulatedVehicle(vehicle, generatedAt, now, simulationRate) {
  const started = new Date(generatedAt).getTime()
  const elapsedSeconds = Math.max(0, (now - started) / 1000) * simulationRate
  const routeSeconds = Math.max(1, vehicle.route_duration_minutes * 60)
  const isMoving = vehicle.speed_kmh > 0
  const progress = isMoving ? Math.min(99.5, vehicle.progress + elapsedSeconds / routeSeconds * 100) : vehicle.progress
  const points = vehicle.route_points || []
  let position = vehicle.position
  if (isMoving && points.length > 1) {
    const routePosition = progress / 100 * (points.length - 1)
    const index = Math.min(Math.floor(routePosition), points.length - 2)
    const fraction = routePosition - index
    const start = points[index], end = points[index + 1]
    position = { name: `Entre ${start[0]} y ${end[0]}`, latitude: start[1] + (end[1] - start[1]) * fraction, longitude: start[2] + (end[2] - start[2]) * fraction }
  }
  return { ...vehicle, progress: isMoving ? progress.toFixed(1) : vehicle.progress, position, location: position?.name || vehicle.location, updated_at: isMoving ? new Date(now).toISOString() : vehicle.updated_at }
}
function formatEventTime(value) { return value ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'Ahora' }
function relativeTime(value) { const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000)); return `hace ${minutes} min` }
function StatusIcon({ status }) { return status === 'alert' || status === 'warning' ? <span className={`status-icon ${status === 'alert' ? 'alert' : 'warning'}`}><AlertTriangle size={17}/></span> : <span className="status-icon"><CheckCircle2 size={17}/></span> }
export default App
