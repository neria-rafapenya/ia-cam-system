import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, BookOpen, Camera, CheckCircle2, CircleHelp, Clock3, Coins, FileImage, Gauge, LockKeyhole, LogOut, MapPin, Play, RefreshCw, Route, Send, ShieldCheck, Square, Trash2, Truck, Video, XCircle } from 'lucide-react'
import { clearSession, completeNewPassword, refreshCognitoSession, restoreCognitoSession, revokeCognitoSession, saveSession, signInCognito } from './auth'

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
  const activeRequestsRef = useRef(new Set())
  const logoutInProgressRef = useRef(false)
  const [authSession, setAuthSession] = useState(null), [authLoading, setAuthLoading] = useState(true), [loggingOut, setLoggingOut] = useState(false)
  const [view, setView] = useState('cameras')
  const [procedureScenario, setProcedureScenario] = useState('temperature')
  const [incidents, setIncidents] = useState([])
  const [evidenceFlags, setEvidenceFlags] = useState({})
  const [lastAiProvider, setLastAiProvider] = useState(null)
  const [usage, setUsage] = useState(readUsage)
  const [cameraState, setCameraState] = useState('idle'), [snapshot, setSnapshot] = useState(null), [snapshotAt, setSnapshotAt] = useState(null), [analysis, setAnalysis] = useState(null)
  const [events, setEvents] = useState(initialEvents), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [motionActive, setMotionActive] = useState(false), [motionDetected, setMotionDetected] = useState(false)
  const [logistics, setLogistics] = useState(null), [logisticsError, setLogisticsError] = useState(''), [logisticsLoading, setLogisticsLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    restoreCognitoSession().then(session => { if (mounted) { setAuthSession(session); setAuthLoading(false) } })
    return () => { mounted = false }
  }, [])
  useEffect(() => () => stopCamera(), [])
  useEffect(() => { if (cameraState !== 'live' || !motionActive) return undefined; const timer = window.setInterval(checkMotion, 900); return () => window.clearInterval(timer) }, [cameraState, motionActive])
  useEffect(() => {
    if (view !== 'vehicles') return undefined
    let alive = true
    const load = async (initial = false) => {
      if (initial) setLogisticsLoading(true)
      try {
        const response = await authenticatedFetch(`${API_URL}/api/logistics/overview`)
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

  async function authenticatedFetch(url, options = {}) {
    if (!authSession || logoutInProgressRef.current) throw new Error('Inicia sesión para continuar.')
    let session = authSession
    if (session.expiresAt <= Date.now() + 30_000 && session.refreshToken) {
      try { session = await refreshCognitoSession(session.refreshToken) }
      catch { void logout(); throw new Error('La sesión ha caducado. Inicia sesión de nuevo.') }
      setAuthSession(session)
    }
    const controller = new AbortController()
    activeRequestsRef.current.add(controller)
    try {
      const headers = new Headers(options.headers || {})
      headers.set('Authorization', `Bearer ${session.accessToken}`)
      const response = await fetch(url, { ...options, headers, signal: controller.signal })
      if (response.status === 401 && session.refreshToken) {
        let renewed
        try { renewed = await refreshCognitoSession(session.refreshToken) }
        catch { void logout(); throw new Error('La sesión ha caducado. Inicia sesión de nuevo.') }
        setAuthSession(renewed)
        headers.set('Authorization', `Bearer ${renewed.accessToken}`)
        const retry = await fetch(url, { ...options, headers, signal: controller.signal })
        if (retry.status === 401) { void logout(); throw new Error('La sesión ya no es válida. Inicia sesión de nuevo.') }
        return retry
      }
      return response
    } finally { activeRequestsRef.current.delete(controller) }
  }

  function stopCamera() { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; if (videoRef.current) videoRef.current.srcObject = null; previousFrameRef.current = null; motionStreakRef.current = 0; setMotionActive(false); setMotionDetected(false); setCameraState('idle') }
  async function startCamera() { setError(''); try { const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); streamRef.current = stream; setCameraState('live'); requestAnimationFrame(async () => { if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() } }) } catch (err) { setError(`No se pudo acceder a la cámara (${err?.name || 'error desconocido'}). Comprueba los permisos del navegador.`); setCameraState('error') } }
  function captureSnapshot(reason = 'Captura manual') { if (!videoRef.current || !captureCanvasRef.current || cameraState !== 'live') return null; const video = videoRef.current, canvas = captureCanvasRef.current; canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720; canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); const image = canvas.toDataURL('image/jpeg', .82); setSnapshot(image); setSnapshotAt(new Date().toISOString()); setAnalysis(null); setError(''); if (reason === 'Movimiento detectado') { setMotionDetected(true); setEvents(current => [{ id: Date.now(), time: 'Ahora', type: 'Movimiento', title: 'Movimiento detectado', detail: 'Se ha generado una captura automática para revisión.', status: 'alert' }, ...current]) } return image }
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
  async function analyzeImage(image, detected) { if (!image || analyzingRef.current || !authSession || logoutInProgressRef.current) return; analyzingRef.current = true; setBusy(true); setError(''); try { const response = await authenticatedFetch(`${API_URL}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, camera_id: 'webcam-local', source: window.location.origin, motion_detected: detected }) }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.detail || `El backend ha respondido con HTTP ${response.status}`); setAnalysis(result); setLastAiProvider(result.provider || 'mock'); recordAiUsage(result.provider || 'mock', result.usage, 'Análisis de cámara', result.model_id); setEvents(current => [{ id: Date.now(), time: formatEventTime(result.analyzed_at), type: result.label, title: result.title, detail: result.detail, status: result.status }, ...current]) } catch (err) { if (err?.name !== 'AbortError') setError(err?.message || 'No se pudo conectar con el backend.') } finally { analyzingRef.current = false; setBusy(false) } }
  async function analyzeSnapshot() { analyzeImage(snapshot, motionDetected) }

  async function logout() {
    const session = authSession
    logoutInProgressRef.current = true
    setLoggingOut(true)
    stopCamera()
    activeRequestsRef.current.forEach(controller => controller.abort())
    activeRequestsRef.current.clear()
    analyzingRef.current = false
    clearSession()
    setLoggingOut(false)
    setAuthSession(null)
    setView('cameras')
    setSnapshot(null)
    setSnapshotAt(null)
    setAnalysis(null)
    setMotionActive(false)
    setEvents(initialEvents)
    setIncidents([])
    setEvidenceFlags({})
    setLogistics(null)
    setUsage(readUsage())
    try { await revokeCognitoSession(session) } catch { /* El cierre local y la detención de procesos no dependen de la revocación remota. */ }
    setLoggingOut(false)
  }

  const statusText = cameraState === 'live' ? 'En directo' : cameraState === 'error' ? 'Sin permisos' : 'Desconectada'
  const isVehicles = view === 'vehicles', isCosts = view === 'costs'
  if (authLoading) return <div className="auth-loading"><RefreshCw className="spin" size={20}/> Comprobando sesión segura…</div>
  if (!authSession) return <LoginScreen onAuthenticated={session => { logoutInProgressRef.current = false; saveSession(session); setAuthSession(session) }} />
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">B</div><div><strong>BG Logistics</strong><span>Monitor operativo · demo</span></div></div><nav>
      <button className={view === 'cameras' ? 'active' : ''} onClick={() => setView('cameras')}><Camera size={17}/> Cámaras</button>
      <button className={view === 'vehicles' ? 'active' : ''} onClick={() => setView('vehicles')}><Truck size={17}/> Vehículos</button>
      <button className={view === 'procedures' ? 'active' : ''} onClick={() => setView('procedures')}><BookOpen size={17}/> Procedimientos <span className="nav-soon">mock</span></button>
      <button className={isCosts ? 'active' : ''} onClick={() => setView('costs')}><Coins size={17}/> Coste IA</button>
      <button className={view === 'incidents' ? 'active' : ''} onClick={() => setView('incidents')}><AlertTriangle size={17}/> Incidencias {incidents.filter(item => item.status === 'open').length > 0 && <span className="nav-soon">{incidents.filter(item => item.status === 'open').length}</span>}</button>
      <button className={view === 'evidence' ? 'active' : ''} onClick={() => setView('evidence')}><FileImage size={17}/> Evidencias</button>
    </nav><div className="sidebar-footer"><div className="sidebar-prototype"><ShieldCheck size={15}/> Prototipo de demostración</div><div className={`provider-status ${lastAiProvider || 'unknown'}`}><span className="provider-light"/><div><strong>{lastAiProvider ? `Última respuesta: ${lastAiProvider.toUpperCase()}` : 'IA aún sin consultar'}</strong><small>{lastAiProvider ? 'Proveedor de la última consulta' : 'Se actualizará tras analizar o preguntar'}</small></div></div><button className="logout-button" onClick={logout} disabled={loggingOut}><LogOut size={15}/>{loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}</button></div></aside>
    <main className="main-content"><header className="topbar"><div><p className="eyebrow">OPERACIONES · DEMO</p><h1>{isCosts ? 'Consumo estimado de IA' : isVehicles ? 'Seguimiento de vehículos' : view === 'procedures' ? 'Copiloto de procedimientos' : view === 'incidents' ? 'Incidencias' : view === 'evidence' ? 'Evidencias' : 'Monitor de cámaras'}</h1><p className="subtitle">{isCosts ? 'Registro local de inferencias realizadas desde esta aplicación' : isVehicles ? 'Vista simulada de flota, rutas, paradas y señales operativas' : view === 'procedures' ? 'Consulta guiada de documentación operativa y evidencias' : view === 'incidents' ? 'Casos escalados para revisión humana en esta sesión' : view === 'evidence' ? 'Capturas y registros asociados a eventos, con decisión de conservación' : 'Prueba local de movimiento y análisis visual'}</p></div><div className="connection"><span className={`dot ${isCosts || isVehicles || view === 'procedures' || view === 'incidents' || view === 'evidence' || cameraState === 'live' ? 'green' : ''}`}></span>{isCosts ? 'Estimación local' : isVehicles ? 'Datos simulados' : view === 'procedures' || view === 'incidents' || view === 'evidence' ? 'Datos mock locales' : statusText}</div></header>
      {isCosts ? <UsageDashboard usage={usage} onClear={() => { setUsage(emptyUsage); try { window.localStorage.removeItem(USAGE_STORAGE_KEY) } catch { /* Sin almacenamiento persistente, el reinicio afecta a esta sesión. */ } }} /> : isVehicles ? <LogisticsDashboard data={logistics} error={logisticsError} loading={logisticsLoading} authFetch={authenticatedFetch} onProviderUsed={(provider, tokens, modelId) => { setLastAiProvider(provider); recordAiUsage(provider, tokens, 'Consulta de flota', modelId) }} onRefresh={() => { setLogisticsLoading(true); authenticatedFetch(`${API_URL}/api/logistics/overview`).then(r => r.json().then(d => { if (!r.ok) throw new Error(d.detail || 'No se pudo actualizar'); return d })).then(d => { setLogistics(d); setLogisticsError('') }).catch(e => { if (e.name !== 'AbortError') setLogisticsError(e.message) }).finally(() => setLogisticsLoading(false)) }} /> : view === 'procedures' ? <ProcedureCopilot scenario={procedureScenario} onScenarioChange={setProcedureScenario} onMockConsult={() => { setLastAiProvider('mock'); recordAiUsage('mock', null, 'Consulta de procedimiento') }} onEscalate={incident => { setIncidents(current => [{ ...incident, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: 'open', createdAt: new Date().toISOString() }, ...current]); setView('incidents') }} /> : view === 'incidents' ? <IncidentsDashboard incidents={incidents} onResolve={id => setIncidents(current => current.map(item => item.id === id ? { ...item, status: 'resolved', resolvedAt: new Date().toISOString() } : item))} onGoToProcedures={() => setView('procedures')} /> : view === 'evidence' ? <EvidenceDashboard snapshot={snapshot} snapshotAt={snapshotAt} analysis={analysis} incidents={incidents} flags={evidenceFlags} onToggle={id => setEvidenceFlags(current => ({ ...current, [id]: !current[id] }))} /> : <CameraDashboard {...{ videoRef, captureCanvasRef, motionCanvasRef, cameraState, statusText, startCamera, stopCamera, captureSnapshot, snapshot, setSnapshot, snapshotAt, setSnapshotAt, setAnalysis, analysis, motionDetected, setMotionDetected, analyzeSnapshot, busy, events, setEvents, motionActive, setMotionActive, error, setError }} />}
    </main></div>
}

function CameraDashboard({ videoRef, captureCanvasRef, motionCanvasRef, cameraState, statusText, startCamera, stopCamera, captureSnapshot, snapshot, setSnapshot, snapshotAt, setSnapshotAt, setAnalysis, analysis, motionDetected, setMotionDetected, analyzeSnapshot, busy, events, setEvents, motionActive, setMotionActive, error, setError }) {
  return <><section className="content-grid"><div className="primary-column"><section className="panel camera-panel"><div className="panel-heading"><div><h2>Webcam local</h2><p>La cámara se utiliza solo mientras esta pantalla permanezca abierta.</p></div><span className="badge"><span className={`dot ${cameraState === 'live' ? 'green' : ''}`}></span>{statusText}</span></div><div className="video-frame"><video ref={videoRef} muted playsInline className={cameraState === 'live' ? 'video-active' : 'video-hidden'} />{cameraState !== 'live' && <div className="video-placeholder"><Video size={42}/><strong>La cámara aún no está activa</strong><span>Concede permiso al navegador para iniciar la monitorización.</span></div>}{cameraState === 'live' && <div className="live-label"><span className="record-dot"></span> EN DIRECTO</div>}</div><canvas ref={captureCanvasRef} className="hidden"/><canvas ref={motionCanvasRef} className="hidden"/><div className="camera-actions">{cameraState === 'live' ? <button className="button secondary" onClick={stopCamera}><Square size={16}/> Detener cámara</button> : <button className="button primary" onClick={startCamera}><Play size={16}/> Activar cámara</button>}<button className="button secondary" disabled={cameraState !== 'live'} onClick={() => captureSnapshot()}><Camera size={16}/> Capturar imagen</button><button className={`button ${motionActive ? 'motion-on' : 'secondary'}`} disabled={cameraState !== 'live'} onClick={() => setMotionActive(current => !current)}><RefreshCw size={16}/> {motionActive ? 'Detección activa' : 'Detectar movimiento'}</button></div></section>
      <section className="panel snapshot-panel"><div className="panel-heading"><div><h2>Última captura</h2><p>Imagen que se enviará al análisis inicial.</p></div>{snapshot && <button className="icon-button" onClick={() => { setSnapshot(null); setSnapshotAt(null); setAnalysis(null); setMotionDetected(false) }} aria-label="Eliminar captura"><XCircle size={18}/></button>}</div>{snapshot ? <div className="snapshot-content"><img src={snapshot} alt="Última captura de la webcam"/><div className="analysis-box">{analysis ? <><div className="analysis-status"><StatusIcon status={analysis.status}/><div><span className="small-label">RESULTADO DEL ANÁLISIS</span><strong>{analysis.title}</strong></div></div><p>{analysis.detail}</p><span className="confidence">Confianza: {analysis.confidence}% · Proveedor: {analysis.provider || 'mock'}</span></> : <><CircleHelp size={20}/><p>{motionDetected ? 'Se ha detectado movimiento. Analiza la captura para clasificar el evento.' : 'La captura está lista. Ejecuta el análisis para generar una incidencia o confirmar un estado normal.'}</p><button className="button primary" onClick={analyzeSnapshot} disabled={busy}>{busy ? <RefreshCw className="spin" size={16}/> : <ShieldCheck size={16}/>} {busy ? 'Analizando…' : 'Analizar imagen'}</button></>}</div></div> : <div className="empty-state"><Camera size={28}/><p>Captura una imagen para comenzar.</p></div>}</section></div>
      <aside className="side-column"><section className="panel summary-panel"><div className="panel-heading"><div><h2>Estado de la demo</h2><p>Resumen de esta sesión</p></div></div><SummaryRow label="Fuente" value="Webcam local"/><SummaryRow label="Capturas" value={snapshot ? '1' : '0'}/><SummaryRow label="Movimiento" value={motionActive ? 'Activo' : 'Inactivo'} active={motionActive}/><SummaryRow label="Incidencias" value={events.filter(e => e.status === 'alert').length} alert={events.some(e => e.status === 'alert')}/></section><section className="panel events-panel"><div className="panel-heading"><div><h2>Actividad reciente</h2><p>Eventos generados en esta sesión</p></div><button className="icon-button" onClick={() => setEvents([])} aria-label="Limpiar actividad"><RefreshCw size={17}/></button></div>{events.length ? <div className="event-list">{events.map(event => <EventItem event={event} key={event.id}/>)}</div> : <div className="empty-activity">No hay actividad registrada.</div>}</section></aside></section>{error && <div className="error-banner"><AlertTriangle size={17}/>{error}</div>}</>
}

function LogisticsDashboard({ data, error, loading, authFetch, onRefresh, onProviderUsed }) {
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
      const response = await authFetch(`${API_URL}/api/logistics/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, vehicles, analytics: data.analytics }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.detail || `HTTP ${response.status}`)
      onProviderUsed(result.provider || 'mock', result.usage, result.model_id)
      setChatMessages(current => [...current, { role: 'assistant', text: result.answer, provider: result.provider, usage: result.usage }])
    } catch (err) {
      if (err.name !== 'AbortError') setChatMessages(current => [...current, { role: 'assistant', text: `No se pudo consultar la flota: ${err.message}` }])
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

const procedureScenarios = {
  temperature: {
    title: 'Anomalía térmica en zona refrigerada',
    camera: 'Cámara C-04 · alerta simulada: actividad inusual junto a una puerta de cámara.',
    vehicle: 'Vehículo FR-204 · detenido 18 min en muelle refrigerado; ruta con 12 min de retraso.',
    interpretation: 'La coincidencia temporal entre la alerta de cámara y la parada del vehículo podría indicar una espera operativa en el muelle. No confirma una avería ni una excursión de temperatura.',
    missing: ['Lectura actual y evolución de temperatura', 'Estado real de la puerta y del equipo frigorífico', 'Motivo de la parada confirmado por el conductor'],
    doc: 'frio',
  },
  parada: {
    title: 'Vehículo detenido fuera del punto previsto',
    camera: 'Cámara P-02 · movimiento detectado en el pasillo de acceso; clasificación pendiente de validación.',
    vehicle: 'Vehículo TR-118 · posición simulada fuera del punto de parada planificado; sin actualización durante 14 min.',
    interpretation: 'La posición y la falta de actualización merecen una comprobación, pero por sí solas no determinan la causa ni permiten afirmar que exista una incidencia de seguridad.',
    missing: ['Confirmar cobertura y hora de la última señal GPS', 'Contactar con el conductor o responsable de ruta', 'Verificar si se autorizó una parada alternativa'],
    doc: 'parada',
  },
}

const procedureDocuments = {
  frio: { name: 'Guía demo · Anomalía en zona refrigerada', section: 'Sección 2 · Comprobaciones iniciales', excerpt: 'Ante una anomalía, confirmar primero la lectura del sensor y su evolución. Revisar el cierre de la puerta y el estado visible del equipo. Registrar hora, ubicación y responsable de la comprobación. Si la lectura supera el umbral operativo definido, avisar al responsable de turno y seguir el procedimiento de calidad aplicable.' },
  parada: { name: 'Guía demo · Parada no prevista de vehículo', section: 'Sección 1 · Validación de la señal', excerpt: 'Antes de escalar una parada, comprobar la hora de la última posición, la cobertura disponible y el punto planificado. Contactar con el conductor o responsable de tráfico para confirmar el motivo. No inferir una avería únicamente a partir de una posición sin actualizar.' },
  escalado: { name: 'Guía demo · Escalado y registro de incidencias', section: 'Sección 3 · Registro mínimo', excerpt: 'Documentar hechos observados, hora, fuente y comprobaciones realizadas. Separar datos confirmados de hipótesis. Si falta información crítica o existe riesgo para producto o personas, escalar al responsable de turno y no cerrar la incidencia hasta su validación.' },
}

function ProcedureCopilot({ scenario, onScenarioChange, onMockConsult, onEscalate }) {
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState(null)
  const [escalated, setEscalated] = useState(false)
  const current = procedureScenarios[scenario]
  const source = procedureDocuments[current.doc]

  function consult(event) {
    event?.preventDefault()
    onMockConsult()
    const q = question.trim().toLocaleLowerCase('es')
    const hasRelevantTerms = !q || /temperatur|fr[ií]o|puerta|sensor|parad|veh[ií]cul|gps|ruta|proced|paso|actu|incidencia|escal|c[aá]mara|muelle/.test(q)
    if (!hasRelevantTerms) {
      setResult({ unsupported: true })
      return
    }
    setResult({ unsupported: false, at: new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) })
    setEscalated(false)
  }

  return <div className="procedure-view">
    <div className="procedure-demo-banner"><div><span className="provider-chip mock">SIMULACIÓN · SIN BEDROCK</span><strong>Copiloto de procedimientos</strong><p>Relaciona contexto operativo y documentación demo. Las guías y umbrales son ficticios y no deben usarse como instrucciones reales.</p></div><BookOpen size={24}/></div>
    <div className="procedure-card-group"><div className="alert alert-success" role="status"><strong>Contexto del caso:</strong> aquí se combinan señales simuladas de cámara y vehículo para plantear una situación operativa.</div><section className="panel scenario-panel"><div className="panel-heading"><div><h2>Escenario integrado</h2><p>Selecciona una situación para construir el contexto de la consulta.</p></div><span className="badge"><span className="dot green"/>Datos de demostración</span></div><div className="scenario-tabs"><button className={scenario === 'temperature' ? 'selected' : ''} onClick={() => { onScenarioChange('temperature'); setResult(null); setEscalated(false) }}>Anomalía térmica + parada</button><button className={scenario === 'parada' ? 'selected' : ''} onClick={() => { onScenarioChange('parada'); setResult(null); setEscalated(false) }}>Parada fuera de ruta</button></div>
      <div className="context-grid"><article className="context-card"><span className="context-kicker"><Camera size={14}/> DATO OBSERVADO · CÁMARA</span><p>{current.camera}</p></article><article className="context-card"><span className="context-kicker"><Truck size={14}/> DATO OBSERVADO · FLOTA</span><p>{current.vehicle}</p></article></div>
      <div className="interpretation-note"><CircleHelp size={16}/><p><strong>Interpretación, no hecho confirmado</strong>{current.interpretation}</p></div>
    </section></div>
    <section className="procedure-grid"><div className="procedure-card-group"><div className="alert alert-success" role="status"><strong>Consulta y evidencia:</strong> el copiloto muestra la guía mock utilizada y propone comprobaciones vinculadas a su contenido.</div><div className="panel procedure-query"><div className="panel-heading"><div><h2>Consultar procedimiento</h2><p>La respuesta se genera localmente a partir del caso y las guías demo.</p></div><span className="provider-chip mock">MOCK</span></div><div className="demo-source-card"><div><BookOpen size={17}/><span><strong>{source.name}</strong><small>{source.section}</small></span></div><p>“{source.excerpt}”</p><span className="source-label">Fuente simulada · fragmento visible</span></div><form className="chat-form" onSubmit={consult}><input value={question} onChange={e => setQuestion(e.target.value)} placeholder="p. ej., ¿qué debería comprobar primero?" maxLength={300} aria-label="Consulta de procedimiento"/><button className="button primary" type="submit"><Send size={15}/> Consultar</button></form>
      {result && (result.unsupported ? <div className="grounding-warning"><AlertTriangle size={17}/><p><strong>No encuentro respaldo suficiente en las guías demo.</strong> No voy a inventar una respuesta. Reformula la consulta o escala el caso a una persona responsable.</p></div> : <div className="procedure-answer"><div className="answer-heading"><CheckCircle2 size={18}/><div><strong>Respuesta apoyada en la guía demo</strong><small>Consulta manual · {result.at}</small></div></div><p className="answer-lead">{current.title}</p><ol>{(scenario === 'temperature' ? ['Verificar la lectura y tendencia del sensor, anotando valor y hora.', 'Comprobar el cierre de la puerta y el estado visible del equipo frigorífico.', 'Confirmar con tráfico o el conductor el motivo y duración prevista de la parada.', 'Si el sensor supera el umbral operativo validado, avisar al responsable de turno y aplicar el procedimiento real de calidad.'] : ['Confirmar hora y calidad de la última señal GPS, además de la cobertura.', 'Contactar con el conductor o responsable de tráfico para validar el motivo.', 'Comprobar si existe una parada alternativa autorizada.', 'Registrar hechos y escalar si no se logra confirmar la situación.']).map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol><div className="missing-info"><strong>Falta confirmar</strong><ul>{current.missing.map(item => <li key={item}>{item}</li>)}</ul></div><div className="citation"><BookOpen size={15}/><div><strong>{source.name} · {source.section}</strong><span>Fragmento utilizado: “{source.excerpt}”</span></div></div><div className="human-review"><ShieldCheck size={15}/> Propuesta para revisión humana. No ejecuta acciones ni sustituye los procedimientos vigentes.</div></div>)}
      <p className="chat-footnote">En esta versión, la respuesta usa reglas y textos mock. Aún no es razonamiento generativo ni búsqueda real con un modelo.</p>
      </div></div><div className="procedure-card-group"><div className="alert alert-success" role="status"><strong>Supervisión humana:</strong> revisa los datos pendientes y escala el caso si la guía no basta; la demo no ejecuta acciones ni envía avisos.</div><aside className="panel procedure-side"><div className="panel-heading"><div><h2>Revisión y escalado</h2><p>Control operativo de la demo</p></div><ShieldCheck size={18}/></div><div className="review-steps"><div><span>1</span><p><strong>Contrastar datos</strong>Separar lo observado de la interpretación.</p></div><div><span>2</span><p><strong>Consultar la fuente</strong>Revisar título, sección y fragmento.</p></div><div><span>3</span><p><strong>Validar antes de actuar</strong>Confirmar datos pendientes con el equipo.</p></div></div><div className="escalation-box"><strong>¿La guía no resuelve el caso?</strong><p>Escala para revisión humana; la demo no determina una acción automáticamente.</p><button className="button secondary" onClick={() => { onEscalate({ title: current.title, camera: current.camera, vehicle: current.vehicle, interpretation: current.interpretation, sourceName: source.name, sourceSection: source.section, missing: current.missing }); setEscalated(true) }} disabled={escalated}>{escalated ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>} {escalated ? 'Enviado a Incidencias' : 'Escalar caso'}</button>{escalated && <small>Incidencia mock creada para revisión en esta sesión.</small>}</div><div className="mock-doc-note"><strong>Material ficticio de demostración</strong><span>La guía no representa políticas, umbrales ni procedimientos de BgTrans.</span></div></aside></div></section>
  </div>
}

function IncidentsDashboard({ incidents, onResolve, onGoToProcedures }) {
  const openCount = incidents.filter(item => item.status === 'open').length
  return <div className="incidents-view">
    <div className="alert alert-success" role="status"><strong>Bandeja local de demostración:</strong> aquí aparecen los casos que se escalan desde Procedimientos. No se envían a un servidor y desaparecen al recargar la página.</div>
    <div className="incident-summary"><div className="panel incident-counter"><span className="metric-label">Pendientes de revisión</span><strong>{openCount}</strong></div><div className="panel incident-counter"><span className="metric-label">Resueltas en esta sesión</span><strong>{incidents.length - openCount}</strong></div><button className="button primary" onClick={onGoToProcedures}><BookOpen size={15}/> Volver a Procedimientos</button></div>
    {!incidents.length ? <section className="panel incidents-empty"><AlertTriangle size={28}/><strong>Aún no hay incidencias</strong><p>Abre Procedimientos, revisa un escenario y pulsa «Escalar caso» para crear una aquí.</p><button className="button primary" onClick={onGoToProcedures}>Ir a Procedimientos</button></section> : <div className="incident-list">{incidents.map(item => <article className={`panel incident-card ${item.status}`} key={item.id}><div className="incident-card-head"><div><span className={`incident-status ${item.status}`}>{item.status === 'open' ? 'PENDIENTE DE REVISIÓN' : 'RESUELTA'}</span><h2>{item.title}</h2><small>Creada {formatEventTime(item.createdAt)} · origen: Copiloto de procedimientos (mock)</small></div>{item.status === 'open' && <button className="button secondary" onClick={() => onResolve(item.id)}><CheckCircle2 size={15}/> Marcar como resuelta</button>}</div><div className="incident-evidence"><div><strong><Camera size={14}/> Cámara · dato observado</strong><p>{item.camera}</p></div><div><strong><Truck size={14}/> Flota · dato observado</strong><p>{item.vehicle}</p></div></div><div className="incident-interpretation"><strong>Interpretación por validar</strong><p>{item.interpretation}</p></div><div className="incident-source"><BookOpen size={15}/><span><strong>Guía consultada:</strong> {item.sourceName} · {item.sourceSection}</span></div>{item.status === 'resolved' && <small className="resolved-time">Marcada como resuelta {formatEventTime(item.resolvedAt)}. Esta acción solo actualiza el estado mock.</small>}</article>)}</div>}
  </div>
}

function EvidenceDashboard({ snapshot, snapshotAt, analysis, incidents, flags, onToggle }) {
  const evidenceCount = incidents.length + Number(Boolean(snapshot))
  return <div className="evidence-view">
    <section className="panel evidence-purpose"><span className="evidence-purpose-icon"><FileImage size={21}/></span><div><h2>¿Para qué sirve Evidencias?</h2><p>Reúne las capturas y registros que ayudan a revisar una incidencia: qué ocurrió, cuándo, en qué cámara o vehículo y qué información lo respalda. Aquí se podría decidir si una imagen debe conservarse para una revisión posterior o si puede caducar según la política acordada.</p><small>En esta demo, la clasificación es solo visual y temporal: no sube archivos, no configura una caducidad real ni sustituye una política de conservación.</small></div></section>
    <div className="evidence-toolbar"><div><strong>{evidenceCount}</strong><span>{evidenceCount === 1 ? ' elemento disponible en esta sesión' : ' elementos disponibles en esta sesión'}</span></div><span className="provider-chip mock">MOCK LOCAL · NO PERSISTENTE</span></div>
    {!evidenceCount ? <section className="panel evidence-empty"><FileImage size={29}/><strong>No hay evidencias en esta sesión</strong><p>Haz una captura desde Cámaras o escala un caso desde Procedimientos. Aparecerán aquí mientras la demo siga abierta.</p></section> : <div className="evidence-list">
      {snapshot && <article className="panel evidence-item"><div className="evidence-preview"><img src={snapshot} alt="Captura actual de webcam"/></div><div className="evidence-details"><div className="evidence-item-heading"><div><span className="evidence-kind"><Camera size={13}/> CAPTURA DE CÁMARA</span><h2>{analysis?.title || 'Captura pendiente de revisión'}</h2><small>{formatEventTime(snapshotAt)} · Webcam local</small></div><span className={`retention-badge ${flags['camera-latest'] ? 'keep' : ''}`}>{flags['camera-latest'] ? 'Conservar (demo)' : 'Caducable (demo)'}</span></div>{analysis && <p>{analysis.detail}</p>}<div className="evidence-actions"><button className={`button ${flags['camera-latest'] ? 'motion-on' : 'secondary'}`} onClick={() => onToggle('camera-latest')}>{flags['camera-latest'] ? <CheckCircle2 size={15}/> : <ShieldCheck size={15}/>} {flags['camera-latest'] ? 'Marcada para conservar' : 'Marcar almacenable'}</button><small>La etiqueta no guarda la imagen de forma permanente.</small></div></div></article>}
      {incidents.map(item => <article className="panel evidence-item" key={`evidence-${item.id}`}><div className="evidence-placeholder"><AlertTriangle size={25}/><span>Registro de incidencia</span><small>Sin imagen adjunta</small></div><div className="evidence-details"><div className="evidence-item-heading"><div><span className="evidence-kind"><BookOpen size={13}/> REGISTRO VINCULADO</span><h2>{item.title}</h2><small>{formatEventTime(item.createdAt)} · Copiloto de procedimientos · {item.status === 'open' ? 'pendiente' : 'resuelta'}</small></div><span className={`retention-badge ${flags[`incident-${item.id}`] ? 'keep' : ''}`}>{flags[`incident-${item.id}`] ? 'Conservar (demo)' : 'Caducable (demo)'}</span></div><p>{item.interpretation}</p><div className="evidence-origin"><strong>Origen:</strong> {item.camera} · {item.vehicle}</div><div className="evidence-actions"><button className={`button ${flags[`incident-${item.id}`] ? 'motion-on' : 'secondary'}`} onClick={() => onToggle(`incident-${item.id}`)}>{flags[`incident-${item.id}`] ? <CheckCircle2 size={15}/> : <ShieldCheck size={15}/>} {flags[`incident-${item.id}`] ? 'Marcado para conservar' : 'Marcar almacenable'}</button><small>Este registro y su etiqueta solo existen en esta sesión.</small></div></div></article>)}
    </div>}
  </div>
}

function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (challenge) {
        onAuthenticated(await completeNewPassword(challenge, newPassword))
      } else {
        const result = await signInCognito(email, password)
        if (result.session) onAuthenticated(result.session)
        else setChallenge(result)
      }
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión. Revisa el correo y la contraseña.')
    } finally { setBusy(false) }
  }
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><div className="brand-mark">B</div><div><strong>BG Logistics</strong><span>Monitor operativo</span></div></div><div className="auth-heading"><span className="auth-icon"><LockKeyhole size={20}/></span><div><h1>Acceso seguro</h1><p>Inicia sesión para acceder a la demo.</p></div></div><form className="auth-form" onSubmit={submit}>{!challenge ? <><label>Correo electrónico<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required autoFocus/></label><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required/></label></> : <><div className="auth-challenge">Tu cuenta necesita una contraseña nueva antes de continuar.</div><label>Nueva contraseña<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} required autoFocus/></label></>}{error && <div className="auth-error" role="alert"><AlertTriangle size={15}/>{error}</div>}<button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? <RefreshCw className="spin" size={16}/> : <LockKeyhole size={16}/>} {busy ? 'Validando…' : challenge ? 'Guardar contraseña y entrar' : 'Iniciar sesión'}</button></form><div className="auth-footnote"><ShieldCheck size={14}/> Autenticación gestionada por Amazon Cognito.</div></section></main>
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
