import { useEffect, useMemo, useState } from 'react'
import type { AuthState, BranchInfo, RecentProject, RepoInfo } from '../../../shared/types'
import type { WorkspaceSelection } from '../App'
import { api } from '../api'

interface Props {
  auth: AuthState
  onOpen: (sel: WorkspaceSelection) => void
  onSignOut: () => void
}

function timeAgo(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${Math.max(mins, 1)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export default function RepoPicker({ auth, onOpen, onSignOut }: Props): JSX.Element {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<RepoInfo | null>(null)
  const [branches, setBranches] = useState<BranchInfo[] | null>(null)
  const [branch, setBranch] = useState('')
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    void api
      .listRepos()
      .then(setRepos)
      .catch((err: Error) => setError(err.message))
    void api.getRecentProjects().then(setRecent)
  }, [])

  useEffect(() => {
    if (!selected) return
    setBranches(null)
    setBranch(selected.defaultBranch)
    void api
      .listBranches(selected.owner, selected.name)
      .then(setBranches)
      .catch((err: Error) => setError(err.message))
  }, [selected])

  const filtered = useMemo(() => {
    if (!repos) return null
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(
      (r) => r.fullName.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    )
  }, [repos, query])

  const openSelected = (): void => {
    if (!selected || !branches) return
    onOpen({ kind: 'github', owner: selected.owner, repo: selected.name, branch, branches })
  }

  const openRecent = async (p: RecentProject): Promise<void> => {
    if (p.kind === 'local') {
      onOpen({ kind: 'local', path: p.path })
      return
    }
    setOpening(true)
    setError(null)
    try {
      const b = await api.listBranches(p.owner, p.repo)
      onOpen({ kind: 'github', owner: p.owner, repo: p.repo, branch: p.branch, branches: b })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setOpening(false)
    }
  }

  const openLocalFolder = async (): Promise<void> => {
    const folder = await api.pickLocalFolder()
    if (folder) onOpen({ kind: 'local', path: folder })
  }

  return (
    <div className="picker-screen">
      <header className="picker-header">
        <div className="brand brand-small">
          <div className="brand-phone" />
          <h1>Projector</h1>
        </div>
        <div className="picker-user">
          {auth.avatarUrl && <img className="avatar" src={auth.avatarUrl} alt="" />}
          <span>{auth.login}</span>
          <button className="btn btn-ghost btn-small" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="picker-body">
        {error && <div className="error-banner">{error}</div>}

        {recent.length > 0 && (
          <section className="recent-section">
            <h2>Recent</h2>
            <div className="recent-row">
              {recent.map((p) => (
                <button
                  key={p.kind === 'local' ? `local:${p.path}` : `${p.owner}/${p.repo}#${p.branch}`}
                  className="recent-chip"
                  disabled={opening}
                  title={p.kind === 'local' ? p.path : undefined}
                  onClick={() => void openRecent(p)}
                >
                  <span className="recent-repo">
                    {p.kind === 'local'
                      ? (p.path.split(/[\\/]/).filter(Boolean).pop() ?? p.path)
                      : `${p.owner}/${p.repo}`}
                  </span>
                  <span className="recent-branch">
                    {p.kind === 'local' ? '📁 local folder' : p.branch}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="repos-section">
          <h2>Your repositories</h2>
          <div className="picker-actions-row">
            <input
              className="search-input"
              type="text"
              placeholder="Search repositories…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="btn btn-ghost"
              title="Run a folder on this computer — file changes appear in the frame instantly, no push needed"
              onClick={() => void openLocalFolder()}
            >
              📁 Open local folder…
            </button>
          </div>

          {!filtered && !error && <div className="muted loading-row">Loading repositories…</div>}

          <div className="repo-list">
            {filtered?.map((repo) => (
              <div
                key={repo.id}
                className={`repo-row ${selected?.id === repo.id ? 'repo-row-selected' : ''}`}
              >
                <button className="repo-row-main" onClick={() => setSelected(repo)}>
                  <div className="repo-title">
                    <span className="repo-name">{repo.fullName}</span>
                    {repo.private && <span className="badge">private</span>}
                    <span className="repo-pushed">{timeAgo(repo.pushedAt)}</span>
                  </div>
                  {repo.description && <div className="repo-desc">{repo.description}</div>}
                </button>

                {selected?.id === repo.id && (
                  <div className="repo-open-bar">
                    <label htmlFor="branch-select">Branch</label>
                    <select
                      id="branch-select"
                      value={branch}
                      disabled={!branches}
                      onChange={(e) => setBranch(e.target.value)}
                    >
                      {(branches ?? [{ name: branch, commitSha: '' }]).map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary btn-small"
                      disabled={!branches}
                      onClick={openSelected}
                    >
                      {branches ? 'Open in iPhone' : 'Loading branches…'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {filtered && filtered.length === 0 && (
              <div className="muted loading-row">No repositories match “{query}”.</div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
