import { useEffect, useRef, useState } from 'react'
import type { ProjectPhase } from '../../../shared/types'
import { api } from '../api'
import { USER_AGENTS, type DeviceSpec } from '../devices'
import type { LogEntry } from './LogsPanel'

interface WebviewTag extends HTMLElement {
  reload(): void
  getWebContentsId(): number
}

interface Props {
  device: DeviceSpec
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

export default function DeviceFrame({
  device,
  url,
  phase,
  statusMsg,
  reloadKey,
  onAppLog
}: Props): JSX.Element {
  const areaRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewTag | null>(null)
  const [scale, setScale] = useState(0.8)
  const [clock, setClock] = useState(formatClock())

  const totalW = device.width + device.chrome.side * 2
  const totalH = device.height + device.chrome.top + device.chrome.bottom

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const s = Math.min((el.clientWidth - 48) / totalW, (el.clientHeight - 48) / totalH, 1.1)
      setScale(Math.max(0.25, s))
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
        width: device.width,
        height: device.height,
        dpr: device.dpr,
        safeArea: device.safeArea
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
  }, [url, reloadKey, device, onAppLog])

  const maskSpread = Math.max(device.chrome.top, device.chrome.bottom, device.chrome.side) + 6

  return (
    <div className="device-area" ref={areaRef}>
      <div style={{ width: totalW * scale, height: totalH * scale }}>
        <div
          className="device-frame"
          style={{
            width: totalW,
            height: totalH,
            borderRadius: device.chrome.radius,
            padding: `${device.chrome.top}px ${device.chrome.side}px ${device.chrome.bottom}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }}
        >
          <div
            className="device-screen"
            style={{
              width: device.width,
              height: device.height,
              borderRadius: device.screenRadius
            }}
          >
            {url ? (
              <webview
                key={`${url}::${reloadKey}::${device.id}`}
                ref={(node) => {
                  webviewRef.current = node as WebviewTag | null
                }}
                className="device-webview"
                src={url}
                useragent={USER_AGENTS[device.ua]}
              />
            ) : (
              <BootScreen phase={phase} statusMsg={statusMsg} />
            )}

            <div
              className="screen-corner-mask"
              style={{
                borderRadius: device.screenRadius,
                boxShadow: `0 0 0 ${maskSpread}px #15171c`
              }}
            />
            <div
              className={`status-bar status-bar-${device.statusBar}`}
              style={{ height: device.safeArea.top || undefined }}
            >
              <span className="status-time">{clock}</span>
              <span className="status-icons">
                <SignalIcon />
                <WifiIcon />
                <BatteryIcon />
              </span>
            </div>
            {device.cutout === 'island' && <div className="dynamic-island" />}
            {device.cutout === 'notch' && <div className="notch" />}
            {device.homeIndicator && <div className="home-indicator" />}
          </div>
          {device.homeButton && (
            <div
              className="home-button"
              style={{ bottom: (device.chrome.bottom - 48) / 2 }}
            />
          )}
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
