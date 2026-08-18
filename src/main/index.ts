import { app, BrowserWindow, globalShortcut, ipcMain, session, Tray } from 'electron'
import { createMainWindow } from './window.js'
import { detectProfiles } from './profiles.js'
import { PtyManager } from './pty.js'
import { branchFor } from './git.js'
import { readStats } from './stats.js'
import { bringToFront, createTray, toggleWindow, HOTKEY } from './tray.js'
import type { PaneSnapshot, ShellProfile, SpawnOptions } from '../shared/types.js'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let profiles: ShellProfile[] = []
let statsTimer: NodeJS.Timeout | null = null

/**
 * Cerrar la ventana manda NTX al tray; salir de verdad es explícito.
 *
 * Esta bandera es la que distingue las dos cosas. Sin ella no hay forma de
 * cerrar la app: el handler de `close` cancelaría también el cierre que dispara
 * `app.quit()`, y quedaría un proceso que no se puede terminar salvo por el
 * administrador de tareas.
 */
let quitting = false

function quitForReal(): void {
  quitting = true
  app.quit()
}

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
  // Volver a abrir NTX no levanta una segunda instancia: recupera ésta. Y tiene
  // que ser `bringToFront` y no `focus()`, porque desde que existe el tray la
  // ventana puede estar OCULTA, y a algo oculto no se le da foco.
  app.on('second-instance', () => {
    if (mainWindow) bringToFront(mainWindow)
  })

  app.whenReady().then(() => {
    hardenContentSecurityPolicy()
    profiles = detectProfiles()
    registerIpc()
    mainWindow = createMainWindow()

    statsTimer = setInterval(() => toRenderer('stats', readStats()), 1_000)

    tray = createTray({ getWindow: () => mainWindow, quit: quitForReal })

    // El atajo global. Si otra app ya se quedó con la tecla, register() devuelve
    // false en vez de tirar: la app tiene que arrancar igual, sólo que sin atajo.
    // Peor que quedarse sin atajo sería no arrancar por una tecla ocupada.
    if (!globalShortcut.register(HOTKEY, () => {
      if (mainWindow) toggleWindow(mainWindow)
    })) {
      console.warn(`[ntx] no se pudo registrar ${HOTKEY}: otra app ya lo tiene`)
    }

    // La X de la ventana esconde en vez de cerrar. Los shells siguen vivos —
    // que es justamente el punto de dejar la terminal abierta todo el día— y el
    // atajo la trae de vuelta al instante, sin volver a levantar el proceso.
    mainWindow.on('close', (event) => {
      if (quitting) return
      event.preventDefault()
      mainWindow?.hide()
    })

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })

  // NO cerramos con la última ventana: NTX vive en el tray. Si esto llamara a
  // quit(), esconder la ventana mataría la app y el atajo global no tendría a
  // quién despertar.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    quitting = true
    if (statsTimer) clearInterval(statsTimer)
    globalShortcut.unregister(HOTKEY)
    tray?.destroy()
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
