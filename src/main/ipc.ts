import { BrowserWindow, dialog, ipcMain, shell, webContents } from 'electron'
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
import { getBranchHead, listBranches, listRepos } from './github'
import { syncRepo } from './gitops'
import {
  detectPackageManager,
  ensureSingleWebOutput,
  findAppDir,
  getFreePort,
  installDeps,
  killTree,
  lockfileHash,
  readPackageJson,
  startExpo,
  waitForServer,
  type PackageManager
} from './runner'
import {
  addRecentLocal,
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
  watcher?: NodeJS.Timeout
}

let runCounter = 0
let current: Run | null = null

export function stopCurrentProject(): void {
  if (!current) return
  const run = current
  current = null
  run.ac.abort()
  if (run.watcher) clearInterval(run.watcher)
  if (run.child) killTree(run.child)
  broadcast('project:event', { phase: 'stopped' } satisfies ProjectEvent)
}

const AUTO_REFRESH_INTERVAL_MS = 20_000

type Emit = (e: ProjectEvent) => void
type Log = (text: string, source?: LogLine['source']) => void

function newRun(): { run: Run; emit: Emit; log: Log; checkAborted: () => void } {
  stopCurrentProject()
  const run: Run = { id: ++runCounter, ac: new AbortController() }
  current = run
  const emit: Emit = (e) => {
    if (current === run) broadcast('project:event', e)
  }
  const log: Log = (text, source = 'server') => {
    if (current === run) broadcast('project:log', { source, text } satisfies LogLine)
  }
  const checkAborted = (): void => {
    if (run.ac.signal.aborted) throw new Error('Cancelled')
  }
  return { run, emit, log, checkAborted }
}

interface LaunchResult {
  appDir: string
  appRel: string
  pm: PackageManager
  url: string
}

/**
 * Shared back half of the pipeline: locate the Expo app inside `rootDir`,
 * install dependencies if needed, start the dev server, and wait for it.
 * With `lenientInstall`, a pre-existing node_modules is trusted even when
 * no lockfile hash is recorded (used for local working copies, which the
 * user manages themselves).
 */
interface LaunchOptions {
  hashKeyBase: string
  /** Trust a pre-existing node_modules even without a recorded lockfile hash. */
  lenientInstall: boolean
  /** Whether Projector owns this checkout and may patch it for preview. */
  ownedCheckout: boolean
}

async function launchApp(
  run: Run,
  rootDir: string,
  { hashKeyBase, lenientInstall, ownedCheckout }: LaunchOptions,
  emit: Emit,
  log: Log
): Promise<LaunchResult> {
  const checkAborted = (): void => {
    if (run.ac.signal.aborted) throw new Error('Cancelled')
  }

  const found = findAppDir(rootDir)
  let appDir: string
  let appRel: string
  if (found) {
    appDir = found.dir
    appRel = found.rel
    if (appRel !== '.') log(`Detected Expo app in ${appRel}/`, 'system')
  } else if (readPackageJson(rootDir)) {
    appDir = rootDir
    appRel = '.'
    log(
      "Warning: no 'expo' dependency found anywhere in this project — attempting to run from the root anyway. Bare React Native apps need web support (react-native-web) to run in Projector.",
      'system'
    )
  } else {
    throw new Error(
      "Couldn't find an Expo app here — no directory (root or up to three levels deep) has a package.json with an 'expo' dependency."
    )
  }

  for (const example of ['.env.example', '.env.sample', '.env.local.example']) {
    if (fs.existsSync(path.join(appDir, example)) && !fs.existsSync(path.join(appDir, '.env'))) {
      log(
        `Note: ${appRel === '.' ? '' : `${appRel}/`}${example} exists but .env does not — the app may need environment variables (API URLs, keys) to fully work.`,
        'system'
      )
      break
    }
  }

  ensureSingleWebOutput(appDir, (t) => log(t, 'system'), ownedCheckout)

  const pm = detectPackageManager(appDir)
  const hash = lockfileHash(appDir, pm)
  const key = `${hashKeyBase}#${appRel}`
  const hasModules = fs.existsSync(path.join(appDir, 'node_modules'))
  const storedHash = settings().lockHashes[key]
  let needsInstall = !hasModules || storedHash !== hash
  if (needsInstall && lenientInstall && hasModules && storedHash === undefined) {
    log('node_modules already present — trusting the existing install', 'system')
    settings().lockHashes[key] = hash
    persistSettings()
    needsInstall = false
  }

  if (needsInstall) {
    emit({ phase: 'installing', message: `Installing dependencies with ${pm}…` })
    await installDeps(appDir, pm, log, run.ac.signal)
    checkAborted()
    settings().lockHashes[key] = hash
    persistSettings()
  } else {
    log('Dependencies unchanged — skipping install', 'system')
  }

  const port = await getFreePort()
  emit({ phase: 'starting', message: `Starting Expo dev server on port ${port}…` })
  const child = startExpo(appDir, port, log)
  run.child = child
  child.on('exit', (code) => {
    if (current === run && code !== null && code !== 0) {
      emit({ phase: 'error', message: `Dev server exited with code ${code} — check the logs` })
    }
  })

  await waitForServer(port, run.ac.signal, 240_000)
  checkAborted()

  return { appDir, appRel, pm, url: `http://localhost:${port}` }
}

async function openProject(sel: ProjectSelection): Promise<void> {
  const { run, emit, log, checkAborted } = newRun()
  try {
    const token = loadToken() ?? undefined
    const dir = projectDir(sel)

    emit({ phase: 'syncing', message: `Syncing ${sel.owner}/${sel.repo} @ ${sel.branch}` })
    log(`Project cache: ${dir}`, 'system')
    const headSha = await syncRepo({ dir, ...sel, token, onLine: (t) => log(t, 'system') })
    checkAborted()

    const { appDir, pm, url } = await launchApp(
      run,
      dir,
      { hashKeyBase: projectKey(sel), lenientInstall: false, ownedCheckout: true },
      emit,
      log
    )

    emit({ phase: 'ready', url, message: 'Dev server ready' })
    addRecentProject(sel)

    if (token) {
      startCommitWatcher(run, sel, token, { dir, appDir, pm, headSha, url, emit, log })
    }
  } catch (err) {
    if (!run.ac.signal.aborted) {
      if (run.child) killTree(run.child)
      emit({ phase: 'error', message: (err as Error).message })
    }
  }
}

async function openLocalProject(localPath: string): Promise<void> {
  const { run, emit, log } = newRun()
  try {
    if (!fs.existsSync(localPath) || !fs.statSync(localPath).isDirectory()) {
      throw new Error(`Folder not found: ${localPath}`)
    }

    emit({ phase: 'syncing', message: `Opening local folder ${localPath}` })
    log(`Local working copy: ${localPath}`, 'system')
    log(
      'Live mode: Metro watches this folder directly, so file changes (including commits made by tools like Claude) appear instantly — no push needed.',
      'system'
    )

    const { url } = await launchApp(
      run,
      localPath,
      { hashKeyBase: `local:${localPath}`, lenientInstall: true, ownedCheckout: false },
      emit,
      log
    )

    emit({ phase: 'ready', url, message: 'Dev server ready — watching local files' })
    addRecentLocal(localPath)
  } catch (err) {
    if (!run.ac.signal.aborted) {
      if (run.child) killTree(run.child)
      emit({ phase: 'error', message: (err as Error).message })
    }
  }
}

interface WatchContext {
  dir: string
  appDir: string
  pm: PackageManager
  headSha: string
  url: string
  emit: (e: ProjectEvent) => void
  log: (text: string, source?: LogLine['source']) => void
}

/**
 * Polls the branch tip on GitHub while a project is running. On a new
 * commit, the working tree is re-synced in place so Metro's Fast Refresh
 * picks the changes up live; if the dependency manifest changed, the whole
 * pipeline restarts instead.
 */
function startCommitWatcher(run: Run, sel: ProjectSelection, token: string, ctx: WatchContext): void {
  let head = ctx.headSha
  let checking = false
  run.watcher = setInterval(() => {
    if (checking || current !== run || settings().autoRefresh === false) return
    checking = true
    void (async () => {
      try {
        const remote = await getBranchHead(token, sel.owner, sel.repo, sel.branch)
        if (!remote || remote === head || current !== run) return
        ctx.log(`New commit ${remote.slice(0, 7)} on ${sel.branch} — auto-refreshing…`, 'system')
        const hashBefore = lockfileHash(ctx.appDir, ctx.pm)
        head = await syncRepo({ dir: ctx.dir, ...sel, token, onLine: (t) => ctx.log(t, 'system') })
        if (current !== run) return
        // the forced checkout reverts preview tweaks in the cached copy
        ensureSingleWebOutput(ctx.appDir, (t) => ctx.log(t, 'system'), true)
        if (lockfileHash(ctx.appDir, ctx.pm) !== hashBefore) {
          ctx.log('Dependency manifest changed — restarting the pipeline…', 'system')
          void openProject(sel)
        } else {
          ctx.emit({ phase: 'ready', url: ctx.url, message: `Auto-refreshed to ${remote.slice(0, 7)}` })
          ctx.log('Working tree updated — Metro Fast Refresh reloads the app automatically', 'system')
        }
      } catch (err) {
        ctx.log(`Auto-refresh check failed: ${(err as Error).message}`, 'system')
      } finally {
        checking = false
      }
    })()
  }, AUTO_REFRESH_INTERVAL_MS)
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
  ipcMain.handle('project:open-local', (_e, localPath: string) => openLocalProject(localPath))
  ipcMain.handle('project:pick-local', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose your app folder (repo root or the Expo app directory)',
      properties: ['openDirectory']
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  ipcMain.handle('project:stop', () => {
    stopCurrentProject()
  })
  ipcMain.handle('project:recent', () => settings().recentProjects)

  // --- auto-refresh preference ---
  ipcMain.handle('settings:get-autorefresh', () => settings().autoRefresh !== false)
  ipcMain.handle('settings:set-autorefresh', (_e, value: boolean) => {
    settings().autoRefresh = value
    persistSettings()
  })

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
