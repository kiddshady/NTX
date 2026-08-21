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
  /** Desde cuándo corre el comando actual (timestamp), o null en reposo. Se
   *  enciende recién pasado el umbral de App: para esta marca los comandos
   *  instantáneos no existen, así cada Enter no hace parpadear la tab. */
  busySince: number | null
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

/**
 * La ruta de un archivo soltado sobre un panel, dicha en el idioma de ESA
 * shell. Una ruta de Windows pegada cruda sirve en PowerShell y cmd, pero
 * adentro de WSL no significa nada y en bash los backslashes son escapes: acá
 * se traduce y se cita, para que lo que cae al prompt sea usable tal cual.
 *
 * - pwsh / powershell: tal cual, entre comillas simples si hace falta (la
 *   simple interna se duplica, que es el escape de PowerShell).
 * - cmd: tal cual, entre comillas dobles si hace falta (cmd no entiende otras).
 * - gitbash: backslashes a barras — `C:/foo` lo entiende sin drama y no hay
 *   escape que pelear. Comillas simples si hace falta.
 * - wsl: `C:\foo` se vuelve `/mnt/c/foo`, y un UNC de WSL (`\\wsl$\...` o
 *   `\\wsl.localhost\...`) vuelve a ser la ruta Linux que siempre fue.
 *
 * Sin comillas cuando no hacen falta: la ruta limpia se lee mejor y se edita
 * mejor. El criterio es un set de caracteres inocuos, no una lista de malos.
 */
export function pathForShell(fullPath: string, profileId: string): string {
  const posixQuote = (path: string): string =>
    /^[\w\-./:~+]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`

  if (profileId === 'wsl') {
    const share = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(.*)$/.exec(fullPath)
    const drive = /^([A-Za-z]):[\\/](.*)$/.exec(fullPath)
    const path = share
      ? share[1]!.replace(/\\/g, '/') || '/'
      : drive
        ? `/mnt/${drive[1]!.toLowerCase()}/${drive[2]!.replace(/\\/g, '/')}`
        : fullPath.replace(/\\/g, '/')
    return posixQuote(path)
  }
  if (profileId === 'gitbash') return posixQuote(fullPath.replace(/\\/g, '/'))
  if (profileId === 'cmd') return /^[\w\-.:\\]+$/.test(fullPath) ? fullPath : `"${fullPath}"`
  return /^[\w\-.:\\]+$/.test(fullPath) ? fullPath : `'${fullPath.replace(/'/g, "''")}'`
}

/** "6s", "1m 14s", "1h 03m" — para el cuerpo de una notificación. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
