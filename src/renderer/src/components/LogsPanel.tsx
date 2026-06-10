import { useEffect, useRef, useState } from 'react'

export interface LogEntry {
  id: number
  source: 'system' | 'server' | 'app'
  level?: 'log' | 'warn' | 'error'
  text: string
}

const TAGS: Record<LogEntry['source'], string> = {
  system: 'SYS',
  server: 'SRV',
  app: 'APP'
}

interface Props {
  logs: LogEntry[]
  onClear: () => void
}

export default function LogsPanel({ logs, onClear }: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    if (pinned && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, pinned])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  return (
    <aside className="logs-panel">
      <div className="logs-header">
        <span>Logs</span>
        {!pinned && (
          <button
            className="btn btn-ghost btn-small"
            onClick={() => {
              setPinned(true)
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
            }}
          >
            ↓ Follow
          </button>
        )}
        <button className="btn btn-ghost btn-small" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="logs-scroll" ref={scrollRef} onScroll={onScroll}>
        {logs.length === 0 && <div className="muted logs-empty">Logs will appear here.</div>}
        {logs.map((l) => (
          <div key={l.id} className={`log-row log-${l.source} ${l.level ? `log-level-${l.level}` : ''}`}>
            <span className={`log-tag log-tag-${l.source}`}>{TAGS[l.source]}</span>
            <span className="log-text">{l.text}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
