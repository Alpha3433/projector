import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ProjectSelection, RecentProject } from '../shared/types'

export interface SettingsData {
  githubClientId?: string
  user?: { login: string; avatarUrl?: string }
  recentProjects: RecentProject[]
  lockHashes: Record<string, string>
  /** Re-sync automatically when new commits land on the watched branch. Defaults to true. */
  autoRefresh?: boolean
}

let cached: SettingsData | null = null

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function settings(): SettingsData {
  if (!cached) {
    let loaded: Partial<SettingsData> = {}
    try {
      loaded = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    } catch {
      // first run or corrupt file — start fresh
    }
    cached = { recentProjects: [], lockHashes: {}, ...loaded }
  }
  return cached
}

export function persistSettings(): void {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(settings(), null, 2))
}

export function projectKey(sel: Pick<ProjectSelection, 'owner' | 'repo'>): string {
  return `${sel.owner}/${sel.repo}`
}

export function projectDir(sel: Pick<ProjectSelection, 'owner' | 'repo'>): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(app.getPath('userData'), 'projects', `${safe(sel.owner)}__${safe(sel.repo)}`)
}

export function addRecentProject(sel: ProjectSelection): void {
  const s = settings()
  s.recentProjects = [
    { kind: 'github' as const, ...sel, lastOpenedAt: Date.now() },
    ...s.recentProjects.filter(
      (p) =>
        p.kind === 'local' ||
        !(p.owner === sel.owner && p.repo === sel.repo && p.branch === sel.branch)
    )
  ].slice(0, 12)
  persistSettings()
}

export function addRecentLocal(localPath: string): void {
  const s = settings()
  s.recentProjects = [
    { kind: 'local' as const, path: localPath, lastOpenedAt: Date.now() },
    ...s.recentProjects.filter((p) => !(p.kind === 'local' && p.path === localPath))
  ].slice(0, 12)
  persistSettings()
}
