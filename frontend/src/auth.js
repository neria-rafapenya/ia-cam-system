const REGION = import.meta.env.VITE_COGNITO_REGION || 'eu-west-1'
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || 'eu-west-1_iFcHB8J7W'
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || '1016qiheeqcsef2m4n9jek2c9s'
const STORAGE_KEY = 'bg-logistics-cognito-session-v1'
const ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com/`

async function cognitoCall(target, payload) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || data.Message || 'Cognito no pudo completar la operación.')
  return data
}

function buildSession(result, previous = {}) {
  const tokens = result.AuthenticationResult
  if (!tokens?.AccessToken) throw new Error('Cognito no devolvió un token de acceso.')
  return {
    accessToken: tokens.AccessToken,
    idToken: tokens.IdToken,
    refreshToken: tokens.RefreshToken || previous.refreshToken,
    expiresAt: Date.now() + Number(tokens.ExpiresIn || 3600) * 1000,
  }
}

export async function signInCognito(username, password) {
  const result = await cognitoCall('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: username.trim(), PASSWORD: password },
  })
  if (result.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    return { challenge: result.ChallengeName, challengeSession: result.Session, username: username.trim() }
  }
  const session = buildSession(result)
  saveSession(session)
  return { session }
}

export async function completeNewPassword(challenge, newPassword) {
  const result = await cognitoCall('RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: CLIENT_ID,
    Session: challenge.challengeSession,
    ChallengeResponses: { USERNAME: challenge.username, NEW_PASSWORD: newPassword },
  })
  const session = buildSession(result)
  saveSession(session)
  return session
}

export function saveSession(session) {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)) } catch { /* La sesión permanece en memoria durante esta pestaña. */ }
}

export function clearSession() {
  try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* No hay almacenamiento que limpiar. */ }
}

export async function refreshCognitoSession(refreshToken) {
  const result = await cognitoCall('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  })
  const session = buildSession(result, { refreshToken })
  saveSession(session)
  return session
}

export async function restoreCognitoSession() {
  let stored
  try { stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
  if (!stored) return null
  if (stored.expiresAt > Date.now() + 60_000) return stored
  if (!stored.refreshToken) { clearSession(); return null }
  try { return await refreshCognitoSession(stored.refreshToken) }
  catch { clearSession(); return null }
}

export async function revokeCognitoSession(session) {
  if (!session?.refreshToken) return
  await cognitoCall('RevokeToken', { ClientId: CLIENT_ID, Token: session.refreshToken })
}
