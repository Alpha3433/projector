import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectPhase } from '../../../shared/types'
import type { WorkspaceSelection } from '../App'
import { api } from '../api'
import DeviceFrame from '../components/DeviceFrame'
import LogsPanel, { type LogEntry } from '../components/LogsPanel'

interface Props {
  sel: WorkspaceSelection
  onBack: () => void
}

const PHASE_LABEL: Record<ProjectPhase, string> = {
  idle: 'Idle',
  syncing: 'Syncing repo',
  installing: 'Installing',
  starting: 'Starting server',
  ready: 'Ready',
  stopped: 'Stopped',
  error: 'Error'
}

export default function Workspace({ sel, onBack }: Props): JSX.Element {
  const [branch, setBranch] = useState(sel.branch)
  const [phase, setPhase] = useState<ProjectPhase>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const logId = useRef(0)

  const pushLog = useCallback((entry: Omit<LogEntry, 'id'>): void => {
    setLogs((prev) => {
      const next = [...prev, { ...entry, id: ++logId.current }]
      return next.length > 1500 ? next.slice(next.length - 1500) : next
    })
  }, [])

  useEffect(() => {
    const offEvent = api.onProjectEvent((e) => {
      setPhase(e.phase)
      if (e.message) setStatusMsg(e.message)
      setUrl(e.phase === 'ready' ? (e.url ?? null) : null)
      if (e.message && (e.phase === 'error' || e.phase === 'ready')) {
        pushLog({ source: 'system', text: e.message, level: e.phase === 'error' ? 'error' : 'log' })
      }
    })
    const offLog = api.onProjectLog((l) => {
      pushLog({ source: l.source, text: l.text })
    })
    return () => {
      offEvent()
      offLog()
    }
  }, [pushLog])

  useEffect(() => {
    void api.openProject({ owner: sel.owner, repo: sel.repo, branch })
  }, [sel.owner, sel.repo, branch])

  useEffect(() => {
    return () => {
      void api.stopProject()
    }
  }, [])

  const busy = phase === 'syncing' || phase === 'installing' || phase === 'starting'

  const onAppLog = useCallback(
    (level: LogEntry['level'], text: string): void => {
      pushLog({ source: 'app', level, text })
    },
    [pushLog]
  )

  return (
    <div className="workspace">
      <div className="toolbar">
        <button className="btn btn-ghost btn-small" onClick={onBack}>
          ← Repos
        </button>
        <span className="toolbar-title">
          {sel.owner}/{sel.repo}
        </span>
        <select
          className="branch-select"
          value={branch}
          disabled={busy}
          onChange={(e) => setBranch(e.target.value)}
          title="Switch branch"
        >
          {sel.branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-ghost btn-small"
          disabled={busy}
          title="Fetch the latest commits and restart"
          onClick={() => void api.openProject({ owner: sel.owner, repo: sel.repo, branch })}
        >
          ⟳ Pull latest
        </button>
        <button
          className="btn btn-ghost btn-small"
          disabled={!url}
          title="Reload the app inside the frame"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          ↻ Reload app
        </button>
        <div className="toolbar-spacer" />
        {url && <span className="toolbar-url">{url}</span>}
        <span className={`phase-chip phase-${phase}`}>{PHASE_LABEL[phase]}</span>
      </div>

      <div className="workspace-body">
        <DeviceFrame
          url={url}
          phase={phase}
          statusMsg={statusMsg}
          reloadKey={reloadKey}
          onAppLog={onAppLog}
        />
        <LogsPanel logs={logs} onClear={() => setLogs([])} />
      </div>
    </div>
  )
}
