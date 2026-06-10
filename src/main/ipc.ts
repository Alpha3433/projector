import { BrowserWindow, ipcMain, shell, webContents } from 'electron'
import type { ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import type {
  DeviceMetrics,
  LogLine,
  ProjectEvent,
  ProjectSelection
} from '../shared/types'
import {
  cancelDeviceFlow,
  clearToken,
  getAuthState,
  loadToken,
  signInWithToken,
  startDeviceFlow
} from './auth'
import { listBranches, listRepos } from './github'
import { syncRepo } from './gitops'
import {
  detectPackageManager,
  getFreePort,
  installDeps,
  killTree,
  lockfileHash,
  readPackageJson,
  startExpo,
  waitForServer
} from './runner'
import {
  addRecentProject,
  persistSettings,
  projectDir,
  projectKey,
  settings
} from './settings'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

interface Run {
  id: number
  ac: AbortController
  child?: ChildProcess
}

let runCounter = 0
let current: Run | null = null

export function stopCurrentProject(): void {
  if (!current) return
  const run = current
  current = null
  run.ac.abort()
  if (run.child) killTree(run.child)
  broadcast('project:event', { phase: 'stopped' } satisfies ProjectEvent)
}

async function openProject(sel: ProjectSelection): Promise<void> {
  stopCurrentProject()
  const run: Run = { id: ++runCounter, ac: new AbortController() }
  current = run

  const emit = (e: ProjectEvent): void => {
    if (current === run) broadcast('project:event', e)
  }
  const log = (text: string, source: LogLine['source'] = 'server'): void => {
    if (current === run) broadcast('project:log', { source, text } satisfies LogLine)
  }
  const checkAborted = (): void => {
    if (run.ac.signal.aborted) throw new Error('Cancelled')
  }

  try {
    const token = loadToken() ?? undefined
    const dir = projectDir(sel)

    emit({ phase: 'syncing', message: `Syncing ${sel.owner}/${sel.repo} @ ${sel.branch}` })
    log(`Project cache: ${dir}`, 'system')
    await syncRepo({ dir, ...sel, token, onLine: (t) => log(t, 'system') })
    checkAborted()

    const pkg = readPackageJson(dir)
    if (!pkg) {
      throw new Error('No package.json found at the repository root — is this a JavaScript project?')
    }
    const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) }
    if (!('expo' in deps)) {
      log(
        "Warning: this project doesn't declare an 'expo' dependency — `npx expo` may fail. Bare React Native apps need web support (react-native-web) to run in Projector.",
        'system'
      )
    }

    const pm = detectPackageManager(dir)
    const hash = lockfileHash(dir, pm)
    const key = projectKey(sel)
    const needsInstall =
      !fs.existsSync(path.join(dir, 'node_modules')) || settings().lockHashes[key] !== hash

    if (needsInstall) {
      emit({ phase: 'installing', message: `Installing dependencies with ${pm}…` })
      await installDeps(dir, pm, log, run.ac.signal)
      checkAborted()
      settings().lockHashes[key] = hash
      persistSettings()
    } else {
      log('Dependencies unchanged — skipping install', 'system')
    }

    const port = await getFreePort()
    emit({ phase: 'starting', message: `Starting Expo dev server on port ${port}…` })
    const child = startExpo(dir, port, log)
    run.child = child
    child.on('exit', (code) => {
      if (current === run && code !== null && code !== 0) {
        emit({ phase: 'error', message: `Dev server exited with code ${code} — check the logs` })
      }
    })

    await waitForServer(port, run.ac.signal, 240_000)
    checkAborted()

    emit({ phase: 'ready', url: `http://localhost:${port}`, message: 'Dev server ready' })
    addRecentProject(sel)
  } catch (err) {
    if (!run.ac.signal.aborted) {
      if (run.child) killTree(run.child)
      emit({ phase: 'error', message: (err as Error).message })
    }
  }
}

export function registerIpc(): void {
  // --- auth ---
  ipcMain.handle('auth:state', () => getAuthState())
  ipcMain.handle('auth:signin-token', (_e, token: string) => signInWithToken(token))
  ipcMain.handle('auth:signout', () => {
    clearToken()
  })
  ipcMain.handle('auth:save-client-id', (_e, clientId: string) => {
    settings().githubClientId = clientId.trim() || undefined
    persistSettings()
  })
  ipcMain.handle('auth:deviceflow-start', (_e, clientId: string) => {
    // Fire and forget — progress is reported via auth:deviceflow events.
    void startDeviceFlow(clientId.trim(), (event) => broadcast('auth:deviceflow', event))
  })
  ipcMain.handle('auth:deviceflow-cancel', () => {
    cancelDeviceFlow()
  })

  // --- github ---
  ipcMain.handle('github:repos', () => {
    const token = loadToken()
    if (!token) throw new Error('Not signed in')
    return listRepos(token)
  })
  ipcMain.handle('github:branches', (_e, owner: string, repo: string) => {
    const token = loadToken()
    if (!token) throw new Error('Not signed in')
    return listBranches(token, owner, repo)
  })

  // --- project lifecycle ---
  ipcMain.handle('project:open', (_e, sel: ProjectSelection) => openProject(sel))
  ipcMain.handle('project:stop', () => {
    stopCurrentProject()
  })
  ipcMain.handle('project:recent', () => settings().recentProjects)

  // --- device emulation ---
  ipcMain.handle('emulation:enable', async (_e, id: number, metrics: DeviceMetrics) => {
    const wc = webContents.fromId(id)
    if (!wc) return
    const dbg = wc.debugger
    if (!dbg.isAttached()) {
      try {
        dbg.attach('1.3')
      } catch {
        return
      }
    }
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: metrics.width,
      height: metrics.height,
      deviceScaleFactor: metrics.dpr,
      mobile: true
    })
    await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', {
      enabled: true,
      configuration: 'mobile'
    })
  })

  // --- misc ---
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}
