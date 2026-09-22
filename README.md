# ia-cam-system

Prototipo local para probar la monitorización de una cámara mediante webcam, con frontend React y backend Python/FastAPI.

## Puesta en marcha

El acceso de desarrollo y producción se gestiona con Cognito. La app cliente pública no contiene secretos. Antes de iniciar sesión, usa una cuenta ya creada en el User Pool `ia-serverless-app-dev-users` de `eu-west-1`.

Backend:

```bash
cd backend
/Library/Frameworks/Python.framework/Versions/3.13/bin/python3 -m venv .venv313
source .venv313/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend, en otra terminal:

```bash
cd frontend
npm install
npm run dev
```

Abrir `http://localhost:5173` y conceder permiso para usar la webcam.

El frontend inicia sesión directamente contra Cognito por HTTPS con el flujo de usuario y contraseña; no necesita URL de callback ni un secreto de cliente. El backend valida firma RS256, emisor, caducidad, uso del token y cliente Cognito en todos los endpoints `/api/*`; `/health` permanece público. Para ejecutar el backend en local, define el mismo User Pool y cliente:

```bash
export COGNITO_USER_POOL_ID=eu-west-1_iFcHB8J7W
export COGNITO_APP_CLIENT_ID=1016qiheeqcsef2m4n9jek2c9s
```

El frontend incluye estos identificadores públicos como valores por defecto. Si se sustituyen por otro User Pool, define `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID` y `VITE_COGNITO_CLIENT_ID` antes de compilar.

Al cerrar sesión se detiene la webcam y el detector de movimiento, se abortan las peticiones abiertas desde el navegador y se revoca el refresh token. Si Bedrock ya había comenzado una inferencia, el cierre no puede garantizar que AWS la interrumpa ni evitar su cargo.

Al publicar este cambio, actualiza también la CORS de la Lambda Function URL para permitir la cabecera `Authorization` junto a `content-type`; de lo contrario el navegador bloqueará las llamadas autenticadas desde CloudFront. La URL de la Function queda pública, pero los endpoints `/api/*` rechazan solicitudes sin JWT válido.

## Estado actual

- Captura de webcam desde el navegador.
- Captura de una imagen fija.
- Detección local de movimiento comparando capturas de baja resolución.
- Envío de la imagen al backend.
- Proveedor de análisis configurable: `mock` o `bedrock`.
- Registro local de actividad e incidencias.
- Panel de flota con telemetría, paradas y tacógrafo simulados.

## Demo de vehículos y logística

La sección **Vehículos** consulta `GET /api/logistics/overview` al abrirla y puede hacerlo manualmente al actualizar. El endpoint usa `backend/app/logistics_orchestrator.py` y genera datos ficticios; no consulta GPS real, servicios externos ni Amazon Bedrock. Las alertas de parada, retraso y descanso se generan con reglas sencillas sobre esa muestra.

Las posiciones se animan cada segundo en el navegador usando las rutas mock; no se consulta periódicamente el backend para moverlas. El panel de patrones resume 15 viajes ficticios de los últimos 7 días. El asistente relaciona esos antecedentes con el estado actual, explica evidencias y sugiere qué comprobar.

El chatbot llama a `POST /api/logistics/chat` solo al enviar una pregunta. Para activar Bedrock en este flujo, configura `LOGISTICS_CHAT_PROVIDER=bedrock`, `BEDROCK_MODEL_ID` y las credenciales AWS. Si `LOGISTICS_CHAT_PROVIDER` no está definido, se usa `ANALYSIS_PROVIDER` y, si tampoco existe, se mantiene el modo mock. No se invoca Bedrock al abrir la pantalla ni mientras se animan las posiciones. La respuesta incluye el uso de tokens informado por el modelo.

```bash
export AWS_PROFILE=ia-serverless-dev
export AWS_REGION=eu-west-1
export LOGISTICS_CHAT_PROVIDER=bedrock
export BEDROCK_MODEL_ID=eu.amazon.nova-2-lite-v1:0
```

Para desactivar las llamadas del asistente y volver al mock: `export LOGISTICS_CHAT_PROVIDER=mock`.

Los nombres de conductores, matrículas, trayectos, posiciones, telemetría, viajes históricos y lecturas de tacógrafo son datos de demostración y no deben interpretarse como información operativa o legal.

## Activar Amazon Bedrock

El frontend nunca contiene credenciales AWS. El backend usa el perfil configurado por la AWS CLI.

```bash
export AWS_PROFILE=bgtrans-dev
export AWS_REGION=eu-west-1
export ANALYSIS_PROVIDER=bedrock
export BEDROCK_MODEL_ID="<modelo-de-vision-habilitado-en-tu-cuenta>"
uvicorn app.main:app --reload --port 8000
```

Para volver a las pruebas sin AWS:

```bash
export ANALYSIS_PROVIDER=mock
```

El prototipo detecta movimiento y presencia visual; no identifica personas por reconocimiento facial. Esa fase requeriría una revisión específica de privacidad, permisos y RGPD.
