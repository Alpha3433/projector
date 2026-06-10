import { app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AuthState, DeviceFlowEvent } from '../shared/types'
import { getUser } from './github'
import { persistSettings, settings } from './settings'

function tokenFile(): string {
  return path.join(app.getPath('userData'), 'github-token.bin')
}

export function loadToken(): string | null {
  try {
    const buf = fs.readFileSync(tokenFile())
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
    return buf.toString('utf8')
  } catch {
    return null
  }
}

export function storeToken(token: string): void {
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf8')
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true })
  fs.writeFileSync(tokenFile(), data)
}

export function clearToken(): void {
  try {
    fs.rmSync(tokenFile())
  } catch {
    // already gone
  }
  settings().user = undefined
  persistSettings()
}

export async function getAuthState(): Promise<AuthState> {
  const base = {
    clientId: settings().githubClientId,
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
  const token = loadToken()
  if (!token) return { signedIn: false, ...base }
  let user = settings().user
  if (!user) {
    try {
      user = await getUser(token)
      settings().user = user
      persistSettings()
    } catch {
      clearToken()
      return { signedIn: false, ...base }
    }
  }
  return { signedIn: true, login: user.login, avatarUrl: user.avatarUrl, ...base }
}

export async function signInWithToken(token: string): Promise<AuthState> {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('Token is empty')
  const user = await getUser(trimmed) // validates before storing
  storeToken(trimmed)
  settings().user = user
  persistSettings()
  return getAuthState()
}

let deviceFlowAbort: AbortController | null = null

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Error('Device flow cancelled'))
      },
      { once: true }
    )
  })
}

export function cancelDeviceFlow(): void {
  deviceFlowAbort?.abort()
  deviceFlowAbort = null
}

export async function startDeviceFlow(
  clientId: string,
  emit: (e: DeviceFlowEvent) => void
): Promise<void> {
  cancelDeviceFlow()
  const ac = new AbortController()
  deviceFlowAbort = ac
  try {
    settings().githubClientId = clientId
    persistSettings()
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: 'repo read:org' }),
      signal: ac.signal
    })
    const data = (await res.json()) as {
      device_code?: string
      user_code?: string
      verification_uri?: string
      interval?: number
      error?: string
      error_description?: string
    }
    if (!data.device_code || !data.user_code) {
      throw new Error(data.error_description || data.error || 'Could not start device flow')
    }
    emit({ type: 'code', userCode: data.user_code, verificationUri: data.verification_uri ?? 'https://github.com/login/device' })

    let interval = (data.interval ?? 5) * 1000
    while (!ac.signal.aborted) {
      await sleep(interval, ac.signal)
      const poll = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          device_code: data.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }),
        signal: ac.signal
      })
      const tok = (await poll.json()) as {
        access_token?: string
        error?: string
        error_description?: string
      }
      if (tok.access_token) {
        const user = await getUser(tok.access_token)
        storeToken(tok.access_token)
        settings().user = user
        persistSettings()
        emit({ type: 'success' })
        return
      }
      if (tok.error === 'authorization_pending') continue
      if (tok.error === 'slow_down') {
        interval += 5000
        continue
      }
      throw new Error(tok.error_description || tok.error || 'Device flow failed')
    }
  } catch (err) {
    if (!ac.signal.aborted) emit({ type: 'error', message: (err as Error).message })
  } finally {
    if (deviceFlowAbort === ac) deviceFlowAbort = null
  }
}
