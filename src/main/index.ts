import { app, BrowserWindow, ipcMain, session } from 'electron'
import { createMainWindow } from './window.js'
import { detectProfiles } from './profiles.js'
import { PtyManager } from './pty.js'
import { branchFor } from './git.js'
import { readStats } from './stats.js'
import type { PaneSnapshot, ShellProfile, SpawnOptions } from '../shared/types.js'

let mainWindow: BrowserWindow | null = null
let profiles: ShellProfile[] = []
let statsTimer: NodeJS.Timeout | null = null

/** Manda un evento al renderer, si todavía hay renderer. */
function toRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const ptys = new PtyManager({
  onData: (paneId, data) => toRenderer('pty:data', paneId, data),
  onExit: (paneId, code) => toRenderer('pty:exit', paneId, code)
})

// Una sola instancia: abrir NTX de nuevo enfoca la que ya está corriendo en vez
// de levantar una segunda con sus propios shells.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    hardenContentSecurityPolicy()
    profiles = detectProfiles()
    registerIpc()
    mainWindow = createMainWindow()

    statsTimer = setInterval(() => toRenderer('stats', readStats()), 1_000)

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    if (statsTimer) clearInterval(statsTimer)
    // Sin esto los shells quedan vivos como procesos huérfanos.
    ptys.killAll()
  })
}

/**
 * CSP estricta, sólo en la app empaquetada.
 *
 * Va como header desde acá y no como `<meta>` en el HTML porque en desarrollo el
 * server de vite inyecta scripts inline (el preámbulo de react-refresh) que una
 * política estricta bloquearía: quedaría la app rota justo donde uno trabaja. La
 * versión que se distribuye no tiene nada de eso, así que ahí sí cierra todo.
 *
 * `style-src` necesita 'unsafe-inline' porque React escribe estilos como atributo
 * (los acentos por panel salen de ahí); es un permiso mucho más acotado que el de
 * scripts.
 */
function hardenContentSecurityPolicy(): void {
  if (!app.isPackaged) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "font-src 'self'; img-src 'self' data:; connect-src 'self'; " +
            "object-src 'none'; base-uri 'none'; form-action 'none'"
        ]
      }
    })
  })
}

function registerIpc(): void {
  ipcMain.handle('profiles:list', () => profiles)

  ipcMain.handle('pty:spawn', async (_e, options: SpawnOptions): Promise<PaneSnapshot> => {
    const profile = profiles.find((p) => p.id === options.profileId) ?? profiles[0]
    if (!profile) throw new Error('No shell available on this machine')

    const pane = ptys.spawn(profile, options.cwd, options.cols, options.rows, options.accent)
    return {
      id: pane.id,
      profileId: profile.id,
      title: profile.label,
      cwd: pane.cwd,
      branch: await branchFor(pane.cwd),
      pid: pane.proc.pid
    }
  })

  ipcMain.on('pty:write', (_e, paneId: string, data: string) => ptys.write(paneId, data))
  ipcMain.on('pty:resize', (_e, paneId: string, cols: number, rows: number) =>
    ptys.resize(paneId, cols, rows)
  )
  ipcMain.on('pty:kill', (_e, paneId: string) => ptys.kill(paneId))

  // El renderer ve el OSC 7 y nos pasa el cwd; nosotros le resolvemos el branch.
  // Va en el main porque es quien puede lanzar procesos.
  ipcMain.on('pane:report-cwd', (_e, paneId: string, cwd: string) => {
    if (ptys.cwdOf(paneId) === cwd) return // mismo directorio: no rehacemos nada
    ptys.setCwd(paneId, cwd)
    void branchFor(cwd).then((branch) => toRenderer('pane:cwd', paneId, cwd, branch))
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}
