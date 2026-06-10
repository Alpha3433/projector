export interface AuthState {
  signedIn: boolean
  login?: string
  avatarUrl?: string
  /** GitHub OAuth app client ID configured for device flow, if any. */
  clientId?: string
  /** Whether the OS keychain is available for encrypting the stored token. */
  encryptionAvailable: boolean
}

export interface RepoInfo {
  id: number
  owner: string
  name: string
  fullName: string
  description: string
  private: boolean
  defaultBranch: string
  pushedAt: string
}

export interface BranchInfo {
  name: string
  commitSha: string
}

export interface ProjectSelection {
  owner: string
  repo: string
  branch: string
}

export interface RecentProject extends ProjectSelection {
  lastOpenedAt: number
}

export type ProjectPhase =
  | 'idle'
  | 'syncing'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'stopped'
  | 'error'

export interface ProjectEvent {
  phase: ProjectPhase
  message?: string
  /** Local URL of the running dev server; present when phase is "ready". */
  url?: string
}

export interface LogLine {
  source: 'system' | 'server'
  text: string
}

export interface DeviceMetrics {
  width: number
  height: number
  dpr: number
}

export type DeviceFlowEvent =
  | { type: 'code'; userCode: string; verificationUri: string }
  | { type: 'success' }
  | { type: 'error'; message: string }

export interface ProjectorApi {
  getAuthState(): Promise<AuthState>
  signInWithToken(token: string): Promise<AuthState>
  signOut(): Promise<void>
  saveClientId(clientId: string): Promise<void>
  startDeviceFlow(clientId: string): Promise<void>
  cancelDeviceFlow(): Promise<void>
  listRepos(): Promise<RepoInfo[]>
  listBranches(owner: string, repo: string): Promise<BranchInfo[]>
  openProject(sel: ProjectSelection): Promise<void>
  stopProject(): Promise<void>
  getRecentProjects(): Promise<RecentProject[]>
  getAutoRefresh(): Promise<boolean>
  setAutoRefresh(value: boolean): Promise<void>
  enableTouchEmulation(webContentsId: number, metrics: DeviceMetrics): Promise<void>
  openExternal(url: string): Promise<void>
  onProjectEvent(cb: (e: ProjectEvent) => void): () => void
  onProjectLog(cb: (l: LogLine) => void): () => void
  onDeviceFlow(cb: (e: DeviceFlowEvent) => void): () => void
}
