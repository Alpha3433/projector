import { contextBridge, ipcRenderer } from 'electron'
import type {
  DeviceFlowEvent,
  DeviceMetrics,
  LogLine,
  ProjectEvent,
  ProjectSelection,
  ProjectorApi
} from '../shared/types'

function subscribe<T>(channel: string) {
  return (cb: (payload: T) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const api: ProjectorApi = {
  getAuthState: () => ipcRenderer.invoke('auth:state'),
  signInWithToken: (token: string) => ipcRenderer.invoke('auth:signin-token', token),
  signOut: () => ipcRenderer.invoke('auth:signout'),
  saveClientId: (clientId: string) => ipcRenderer.invoke('auth:save-client-id', clientId),
  startDeviceFlow: (clientId: string) => ipcRenderer.invoke('auth:deviceflow-start', clientId),
  cancelDeviceFlow: () => ipcRenderer.invoke('auth:deviceflow-cancel'),
  listRepos: () => ipcRenderer.invoke('github:repos'),
  listBranches: (owner: string, repo: string) => ipcRenderer.invoke('github:branches', owner, repo),
  openProject: (sel: ProjectSelection) => ipcRenderer.invoke('project:open', sel),
  stopProject: () => ipcRenderer.invoke('project:stop'),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  enableTouchEmulation: (webContentsId: number, metrics: DeviceMetrics) =>
    ipcRenderer.invoke('emulation:enable', webContentsId, metrics),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  onProjectEvent: subscribe<ProjectEvent>('project:event'),
  onProjectLog: subscribe<LogLine>('project:log'),
  onDeviceFlow: subscribe<DeviceFlowEvent>('auth:deviceflow')
}

contextBridge.exposeInMainWorld('projector', api)
