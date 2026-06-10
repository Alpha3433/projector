import { spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import net from 'net'
import path from 'path'

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

export function detectPackageManager(dir: string): PackageManager {
  if (fs.existsSync(path.join(dir, 'bun.lock')) || fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun'
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

const LOCKFILES: Record<PackageManager, string[]> = {
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
  yarn: ['yarn.lock'],
  pnpm: ['pnpm-lock.yaml'],
  bun: ['bun.lock', 'bun.lockb']
}

export function lockfileHash(dir: string, pm: PackageManager): string {
  const hash = crypto.createHash('sha1')
  for (const name of [...LOCKFILES[pm], 'package.json']) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) hash.update(fs.readFileSync(p))
  }
  return hash.digest('hex')
}

export function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

// CSI sequences (colors, cursor movement) and OSC sequences (titles, links)
const ANSI_RE = /\u001b\[[0-9;?]*[a-zA-Z]|\u001b\][^\u0007]*\u0007/g

function wireLines(child: ChildProcess, log: (text: string) => void): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue
    let buf = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      buf += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(ANSI_RE, '').trimEnd()
        buf = buf.slice(idx + 1)
        if (line.trim()) log(line)
      }
    })
    stream.on('end', () => {
      const line = buf.replace(ANSI_RE, '').trim()
      if (line) log(line)
    })
  }
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  } else {
    try {
      // Children are spawned detached on POSIX, so the negative pid kills
      // the whole process group (npx → expo → metro).
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  log: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    log(`$ ${cmd} ${args.join(' ')}`)
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32'
    })
    const onAbort = (): void => killTree(child)
    signal.addEventListener('abort', onAbort, { once: true })
    wireLines(child, log)
    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('exit', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args[0]} exited with code ${code}`))
    })
  })
}

export function installDeps(
  dir: string,
  pm: PackageManager,
  log: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  const args: Record<PackageManager, string[]> = {
    npm: ['install', '--no-audit', '--no-fund'],
    yarn: ['install'],
    pnpm: ['install'],
    bun: ['install']
  }
  return runCommand(pm, args[pm], dir, log, signal)
}

export function startExpo(dir: string, port: number, log: (text: string) => void): ChildProcess {
  log(`$ npx expo start --web --port ${port}`)
  const child = spawn('npx', ['expo', 'start', '--web', '--port', String(port)], {
    cwd: dir,
    env: { ...process.env, BROWSER: 'none', EXPO_NO_TELEMETRY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32'
  })
  wireLines(child, log)
  return child
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

export async function waitForServer(port: number, signal: AbortSignal, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Cancelled')
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume()
        resolve(true)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Timed out waiting for the dev server to become ready')
}
