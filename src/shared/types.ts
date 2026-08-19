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

/**
 * El ciclo de vida de una actualización, aplanado a lo que la UI necesita.
 *
 * electron-updater emite bastantes más eventos; acá se condensan en fases
 * excluyentes para que el About y el aviso no tengan que rearmar la historia.
 * `unsupported` cubre dev y el portable: ahí no hay nada que actualizar y la UI
 * lo dice en vez de ofrecer un botón que no puede cumplir.
 */
export type UpdatePhase =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'uptodate'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** La versión que viene, apenas se conoce. */
  version?: string
  /** 0–100 mientras baja. */
  percent?: number
  error?: string
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
  updates: {
    /** Pide un escaneo ya. El resultado vuelve por `onState`, como todos. */
    check(): void
    /** Cierra la app e instala lo que `ready` dejó descargado. */
    install(): void
    onState(handler: (state: UpdateState) => void): () => void
  }
  meta: {
    version(): Promise<string>
    /** Abre el repo en el navegador. La URL vive en el main, no viaja de acá. */
    openRepo(): void
  }
  platform: {
    version: string
    electron: string
    home: string
  }
}
