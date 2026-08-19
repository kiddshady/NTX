/** Un panel tal como lo ve el renderer. */
export interface PaneState {
  /** El id que devolvió el main al abrir el pty. */
  id: string
  profileId: string
  /** Etiqueta del perfil ("PowerShell 7"), fija. */
  profileLabel: string
  cwd: string
  branch: string | null
  pid: number
  /** Está corriendo su animación de salida: sigue en el DOM pero ya se va. */
  closing: boolean
  /** Un comando largo terminó acá mientras nadie miraba: la tab late con su
   *  acento hasta que el panel reciba foco. */
  notify: boolean
}

/** Cuántas shells entran en el grid. Más de cuatro dejan de leerse. */
export const MAX_PANES = 4

/** El home del usuario, para poder acortar rutas contra él. */
let homeDir = ''

export function setHomeDir(dir: string): void {
  homeDir = dir.replace(/[\\/]+$/, '')
}

/**
 * Ruta corta y legible: el home se colapsa a `~` y, si sigue siendo larga, se
 * deja el último tramo. La status bar tiene 26px de alto y compite con el resto
 * del chrome, así que la ruta completa no entra.
 */
export function shortPath(fullPath: string, maxSegments = 3): string {
  if (!fullPath) return ''

  let path = fullPath.replace(/\//g, '\\')
  if (homeDir && path.toLowerCase().startsWith(homeDir.toLowerCase())) {
    path = `~${path.slice(homeDir.length)}`
  }

  const segments = path.split('\\').filter(Boolean)
  if (segments.length <= maxSegments) return path

  return `…\\${segments.slice(-maxSegments).join('\\')}`
}

/** El título del panel: el perfil, y dónde está parado. */
export function paneTitle(pane: PaneState): string {
  const where = shortPath(pane.cwd, 2)
  return where ? `${pane.profileLabel} — ${where}` : pane.profileLabel
}

/** La etiqueta corta de la tab: sólo el directorio, que es lo que cambia. */
export function paneTabLabel(pane: PaneState): string {
  const shell = pane.profileLabel.split(' ')[0]
  // shortPath ya colapsa el home a `~`; sin esto la tab del home diría el nombre
  // de usuario, que no le sirve a nadie.
  const where = shortPath(pane.cwd, 1)
  return where ? `${shell} · ${where.replace(/^…\\/, '')}` : pane.profileLabel
}

/** "6s", "1m 14s", "1h 03m" — para el cuerpo de una notificación. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
