import { homedir } from 'node:os'
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  NtxApi,
  PaneSnapshot,
  ShellProfile,
  SpawnOptions,
  SystemStats,
  UpdateState
} from '../shared/types.js'

/**
 * Suscribe un handler a un canal y devuelve la función para desuscribirlo.
 *
 * El desuscriptor no es opcional: en React los efectos se re-corren, y sin
 * cleanup cada re-render dejaría un listener más colgado del mismo canal.
 */
function subscribe<A extends unknown[]>(
  channel: string,
  handler: (...args: A) => void
): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void =>
    handler(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api: NtxApi = {
  profiles: () => ipcRenderer.invoke('profiles:list') as Promise<ShellProfile[]>,
  spawn: (options: SpawnOptions) => ipcRenderer.invoke('pty:spawn', options) as Promise<PaneSnapshot>,
  write: (paneId, data) => ipcRenderer.send('pty:write', paneId, data),
  resize: (paneId, cols, rows) => ipcRenderer.send('pty:resize', paneId, cols, rows),
  kill: (paneId) => ipcRenderer.send('pty:kill', paneId),

  onData: (handler) => subscribe<[string, string]>('pty:data', handler),
  onExit: (handler) => subscribe<[string, number]>('pty:exit', handler),
  onCwd: (handler) => subscribe<[string, string, string | null]>('pane:cwd', handler),
  onStats: (handler) => subscribe<[SystemStats]>('stats', handler),
  reportCwd: (paneId, cwd) => ipcRenderer.send('pane:report-cwd', paneId, cwd),

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximizeChange: (handler) => subscribe<[boolean]>('window:maximize-change', handler)
  },

  updates: {
    check: () => ipcRenderer.send('updates:check'),
    install: () => ipcRenderer.send('updates:install'),
    onState: (handler) => subscribe<[UpdateState]>('updates:state', handler)
  },

  meta: {
    version: () => ipcRenderer.invoke('meta:version') as Promise<string>,
    openRepo: () => ipcRenderer.send('meta:open-repo')
  },

  platform: {
    version: process.versions.chrome,
    electron: process.versions.electron,
    // Para poder acortar rutas contra `~` sin que el renderer toque node.
    home: homedir()
  }
}

contextBridge.exposeInMainWorld('ntx', api)
