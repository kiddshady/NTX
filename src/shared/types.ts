/** Tipos compartidos entre main, preload y renderer. */

/** Los shells que NTX sabe levantar. */
export type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'wsl' | 'gitbash'

/** Un perfil concreto y ya resuelto: sabemos que el ejecutable existe. */
export interface ShellProfile {
  id: string
  label: string
  kind: ShellKind
  /** Ruta absoluta al ejecutable. */
  exec: string
  args: string[]
  /** Si el perfil trae un init propio que hay que dot-sourcear / ejecutar. */
  initFile?: string
}

/** Estado de un pty vivo, tal como lo ve el renderer. */
export interface PaneSnapshot {
  id: string
  profileId: string
  title: string
  cwd: string
  branch: string | null
  pid: number
}

export interface SpawnOptions {
  profileId: string
  cwd?: string
  cols: number
  rows: number
  /** El acento del panel, en hex. Viaja al shell para que el prompt haga juego. */
  accent?: string
}

export interface SystemStats {
  cpu: number
  mem: number
}

/** Todo lo que el preload expone al renderer. */
export interface NtxApi {
  profiles(): Promise<ShellProfile[]>
  spawn(options: SpawnOptions): Promise<PaneSnapshot>
  write(paneId: string, data: string): void
  resize(paneId: string, cols: number, rows: number): void
  kill(paneId: string): void
  onData(handler: (paneId: string, data: string) => void): () => void
  onExit(handler: (paneId: string, code: number) => void): () => void
  onCwd(handler: (paneId: string, cwd: string, branch: string | null) => void): () => void
  onStats(handler: (stats: SystemStats) => void): () => void
  /** El renderer avisa el cwd que vio por OSC 7; main resuelve el branch. */
  reportCwd(paneId: string, cwd: string): void
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximizeChange(handler: (maximized: boolean) => void): () => void
  }
  platform: {
    version: string
    electron: string
    home: string
  }
}
