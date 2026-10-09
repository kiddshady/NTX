/** Tipos compartidos entre main, preload y renderer. */

import type { HostState, PeerState, RemotePaneInfo } from './remote'

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
  /** Si la shell corre en OTRA máquina, su nombre ("UCK1"). Los perfiles
   *  remotos llevan id `@<peer>/<perfil>` y no traen exec: los arranca el host. */
  host?: string
}

/** Estado de un pty vivo, tal como lo ve el renderer. */
export interface PaneSnapshot {
  id: string
  profileId: string
  title: string
  cwd: string
  branch: string | null
  pid: number
  /** Sólo en los paneles de otra máquina: de cuál, y si hoy se la alcanza. */
  remote?: RemotePaneInfo
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

/** Un panel tal como se recuerda entre arranques: qué shell y dónde estaba. */
export interface SavedPane {
  profileId: string
  cwd: string
}

/**
 * La escena que se guarda para volver a montarla en el próximo arranque.
 *
 * Es sólo la forma del grid — perfiles, directorios y foco. El CONTENIDO de las
 * shells no se puede resucitar (los procesos murieron con el reboot), pero
 * arrancar con tus paneles parados en sus carpetas es casi todo el valor.
 */
export interface SavedSession {
  panes: SavedPane[]
  /** Índice del panel que tenía el foco. */
  focused: number
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
  /**
   * La ruta absoluta de un File soltado sobre la ventana. Vive en el preload
   * porque `File.path` ya no existe en Electron: lo resuelve webUtils, que el
   * renderer no puede tocar. El parámetro va como `unknown` porque este archivo
   * también lo compila el tsconfig de node, que no carga los tipos del DOM.
   */
  pathForFile(file: unknown): string
  session: {
    /** La escena del arranque anterior, o null si no hay nada que restaurar. */
    load(): Promise<SavedSession | null>
    /** Persiste la escena actual. Escribe en main, atómico y sin drama. */
    save(session: SavedSession): void
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    /** Trae la ventana al frente aunque viva escondida en el tray. Lo usa el
     *  click de una notificación: "llevame a ese panel". */
    attention(): void
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

  // --- Otras máquinas ---------------------------------------------------------
  //
  // Opcionales porque NTX Mobile implementa esta misma interfaz sobre su
  // WebSocket y no maneja máquinas: el renderer de NTX los usa con `?.` y,
  // donde no están, la app es la de siempre.

  /** La lista de perfiles cambió: apareció una máquina, o se la olvidó. */
  onProfiles?(handler: (profiles: ShellProfile[]) => void): () => void
  /** Lo que cambió de un panel remoto: si la máquina está, su pid real. */
  onPaneRemote?(handler: (paneId: string, info: RemotePaneInfo) => void): () => void
  remote?: {
    peers(): Promise<PeerState[]>
    onPeers(handler: (peers: PeerState[]) => void): () => void
    /** CPU y memoria de OTRA máquina, por su id, una vez por segundo. */
    onStats(handler: (peerId: string, stats: SystemStats) => void): () => void
    /** Empareja con el NTX que comparte en `address`, con el PIN de su pantalla. */
    pair(address: string, pin: string): Promise<PairResult>
    forget(peerId: string): void
  }
  host?: {
    state(): Promise<HostState>
    onState(handler: (state: HostState) => void): () => void
    setEnabled(enabled: boolean): Promise<HostState>
    openPairing(): void
    closePairing(): void
    /** Token nuevo: todas las máquinas emparejadas quedan afuera. */
    unpairAll(): void
  }
}

export type PairResult = { ok: true; peer: PeerState } | { ok: false; error: string }
