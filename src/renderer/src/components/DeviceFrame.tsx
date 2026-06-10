import { useEffect, useRef, useState } from 'react'
import type { ProjectPhase } from '../../../shared/types'
import { api } from '../api'
import type { LogEntry } from './LogsPanel'

const DEVICE = {
  name: 'iPhone 15 Pro',
  width: 393,
  height: 852,
  dpr: 3,
  bezel: 13,
  outerRadius: 56,
  innerRadius: 44
}

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

interface WebviewTag extends HTMLElement {
  reload(): void
  getWebContentsId(): number
}

interface Props {
  url: string | null
  phase: ProjectPhase
  statusMsg: string
  reloadKey: number
  onAppLog: (level: LogEntry['level'], text: string) => void
}

function formatClock(): string {
  const d = new Date()
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function normalizeLevel(level: unknown): LogEntry['level'] {
  const map: Record<string, LogEntry['level']> = {
    '0': 'log',
    '1': 'log',
    '2': 'warn',
    '3': 'error',
    verbose: 'log',
    debug: 'log',
    info: 'log',
    log: 'log',
    warning: 'warn',
    warn: 'warn',
    error: 'error'
  }
  return map[String(level)] ?? 'log'
}

export default function DeviceFrame({ url, phase, statusMsg, reloadKey, onAppLog }: Props): JSX.Element {
  const areaRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewTag | null>(null)
  const [scale, setScale] = useState(0.8)
  const [clock, setClock] = useState(formatClock())

  const totalW = DEVICE.width + DEVICE.bezel * 2
  const totalH = DEVICE.height + DEVICE.bezel * 2

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const s = Math.min((el.clientWidth - 48) / totalW, (el.clientHeight - 48) / totalH, 1.1)
      setScale(Math.max(0.3, s))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [totalW, totalH])

  useEffect(() => {
    const t = setInterval(() => setClock(formatClock()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const wv = webviewRef.current
    if (!wv || !url) return

    const onReady = (): void => {
      void api.enableTouchEmulation(wv.getWebContentsId(), {
        width: DEVICE.width,
        height: DEVICE.height,
        dpr: DEVICE.dpr
      })
    }
    const onConsole = (e: Event): void => {
      const ev = e as Event & { level?: unknown; message?: unknown }
      onAppLog(normalizeLevel(ev.level), String(ev.message ?? ''))
    }
    const onFail = (e: Event): void => {
      const ev = e as Event & { errorCode?: number; errorDescription?: string }
      // -3 is ERR_ABORTED, fired on normal in-page navigations — ignore it.
      if (ev.errorCode !== -3) {
        onAppLog('error', `Failed to load app: ${ev.errorDescription || ev.errorCode}`)
      }
    }

    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('did-fail-load', onFail)
    }
  }, [url, reloadKey, onAppLog])

  return (
    <div className="device-area" ref={areaRef}>
      <div style={{ width: totalW * scale, height: totalH * scale }}>
        <div
          className="device-frame"
          style={{
            width: totalW,
            height: totalH,
            borderRadius: DEVICE.outerRadius,
            padding: DEVICE.bezel,
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }}
        >
          <div
            className="device-screen"
            style={{ width: DEVICE.width, height: DEVICE.height, borderRadius: DEVICE.innerRadius }}
          >
            {url ? (
              <webview
                key={`${url}::${reloadKey}`}
                ref={(node) => {
                  webviewRef.current = node as WebviewTag | null
                }}
                className="device-webview"
                src={url}
                useragent={IOS_USER_AGENT}
              />
            ) : (
              <BootScreen phase={phase} statusMsg={statusMsg} />
            )}

            <div
              className="screen-corner-mask"
              style={{ borderRadius: DEVICE.innerRadius, boxShadow: `0 0 0 ${DEVICE.bezel + 4}px #15171c` }}
            />
            <div className="status-bar">
              <span className="status-time">{clock}</span>
              <span className="status-icons">
                <SignalIcon />
                <WifiIcon />
                <BatteryIcon />
              </span>
            </div>
            <div className="dynamic-island" />
            <div className="home-indicator" />
          </div>
        </div>
      </div>
    </div>
  )
}

const PIPELINE_STEPS: Array<{ phase: ProjectPhase; label: string }> = [
  { phase: 'syncing', label: 'Sync repository' },
  { phase: 'installing', label: 'Install dependencies' },
  { phase: 'starting', label: 'Start Expo dev server' }
]

const PHASE_ORDER: ProjectPhase[] = ['syncing', 'installing', 'starting', 'ready']

function BootScreen({ phase, statusMsg }: { phase: ProjectPhase; statusMsg: string }): JSX.Element {
  const idx = PHASE_ORDER.indexOf(phase)

  if (phase === 'error') {
    return (
      <div className="boot-screen">
        <div className="boot-error-icon">!</div>
        <div className="boot-error-title">Something went wrong</div>
        <div className="boot-message">{statusMsg}</div>
        <div className="boot-hint">Check the logs panel for details →</div>
      </div>
    )
  }

  return (
    <div className="boot-screen">
      <div className="spinner" />
      <ul className="boot-steps">
        {PIPELINE_STEPS.map((step, i) => {
          const state = idx > i || phase === 'ready' ? 'done' : idx === i ? 'active' : 'pending'
          return (
            <li key={step.phase} className={`boot-step boot-step-${state}`}>
              <span className="boot-step-dot">{state === 'done' ? '✓' : ''}</span>
              {step.label}
            </li>
          )
        })}
      </ul>
      <div className="boot-message">{statusMsg || 'Waiting…'}</div>
    </div>
  )
}

function SignalIcon(): JSX.Element {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  )
}

function WifiIcon(): JSX.Element {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
      <path d="M8 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" transform="translate(0 -2.4)" />
      <path d="M8 6.6c1.5 0 2.86.58 3.88 1.52l-1.27 1.32A3.97 3.97 0 0 0 8 8.4c-1 0-1.92.38-2.61 1.04L4.12 8.12A5.55 5.55 0 0 1 8 6.6z" transform="translate(0 -2.4)" />
      <path d="M8 2.8c2.55 0 4.87.99 6.6 2.6l-1.28 1.33A7.6 7.6 0 0 0 8 4.6c-2.04 0-3.9.8-5.32 2.13L1.4 5.4A9.16 9.16 0 0 1 8 2.8z" transform="translate(0 -2.4)" />
    </svg>
  )
}

function BatteryIcon(): JSX.Element {
  return (
    <svg width="25" height="12" viewBox="0 0 25 12" fill="currentColor">
      <rect x="0.5" y="0.5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity="0.5" />
      <rect x="2" y="2" width="15" height="8" rx="1.6" />
      <path d="M23 4v4c1-.3 1.6-1.1 1.6-2S24 4.3 23 4z" opacity="0.5" />
    </svg>
  )
}
