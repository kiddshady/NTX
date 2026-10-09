import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, ipcMain, session, shell, Tray } from 'electron'
import { createMainWindow } from './window.js'
import { detectProfiles } from './profiles.js'
import { PtyManager } from './pty.js'
import { branchFor } from './git.js'
import { readStats } from './stats.js'
import { bringToFront, createTray, toggleWindow, HOTKEY } from './tray.js'
import { createUpdater, type Updater } from './updater.js'
import { loadSession, saveSession } from './session.js'
import { Host } from './host.js'
import { Peers } from './peers.js'
import { loadRemoteConfig, newToken, saveRemoteConfig, type RemoteConfig } from './remoteConfig.js'
import type { PaneSnapshot, SavedSession, ShellProfile, SpawnOptions } from '../shared/types.js'
import type { HostState } from '../shared/remote.js'

/** La casa del proyecto. Única URL que la app abre; el renderer no manda URLs. */
const REPO_URL = 'https://github.com/kiddshady/NTX'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let profiles: ShellProfile[] = []
let statsTimer: NodeJS.Timeout | null = null
let updater: Updater | null = null

/** Las otras máquinas: las que ésta maneja (peers) y, si comparte, el host. */
let remoteConfig: RemoteConfig
let peers: Peers | null = null
let host: Host | null = null

/**
 * Arrancada por Windows al iniciar sesión: va directo al tray. Es el modo de
 * la máquina que comparte — tiene que estar escuchando sin que nadie abra nada.
 */
const startHidden = process.argv.includes('--hidden')

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

// En dev, otra carpeta de datos: con la de la instalada, el lock de abajo haría
// que `npm run dev` se cierre solo apenas NTX está abierto en el tray (o sea
// siempre), y la escena y las máquinas emparejadas de prueba pisarían las de
// verdad. Tiene que ir antes del lock, que se ata a esta carpeta.
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'NTX-dev'))

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
    // Sin esto, los toasts de Windows salen a nombre de "electron.app.NTX" (o
    // no salen): el AppUserModelID tiene que coincidir con el del shortcut que
    // registra el instalador NSIS, que electron-builder deriva del appId.
    //
    // SÓLO empaquetada. En dev el proceso es electron.exe, y si ESE declara el
    // AUMID de la app, Windows le aprende el ícono del átomo de Electron a la
    // identidad de NTX — y la taskbar de la app instalada amanece con el ícono
    // equivocado (pasó de verdad en la 0.8.0). En dev los toasts salen a nombre
    // de Electron, que es exactamente lo que son.
    if (app.isPackaged) app.setAppUserModelId('com.umbrovex.ntx')

    hardenContentSecurityPolicy()
    profiles = detectProfiles()
    remoteConfig = loadRemoteConfig()
    registerIpc()
    mainWindow = createMainWindow({ hidden: startHidden })

    peers = new Peers(
      remoteConfig,
      () => saveRemoteConfig(remoteConfig),
      {
        data: (paneId, data) => toRenderer('pty:data', paneId, data),
        exit: (paneId, code) => toRenderer('pty:exit', paneId, code),
        cwd: (paneId, cwd, branch) => toRenderer('pane:cwd', paneId, cwd, branch),
        info: (paneId, info) => toRenderer('pane:remote', paneId, info),
        stats: (peerId, stats) => toRenderer('peer:stats', peerId, stats),
        peers: (states) => toRenderer('remote:peers', states),
        profiles: () => toRenderer('profiles:changed', allProfiles())
      },
      app.getVersion()
    )
    peers.start()
    if (remoteConfig.host.enabled) startHost()

    statsTimer = setInterval(() => toRenderer('stats', readStats()), 1_000)

    updater = createUpdater((state) => toRenderer('updates:state', state))

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
    updater?.dispose()
    globalShortcut.unregister(HOTKEY)
    tray?.destroy()
    // Sin esto los shells quedan vivos como procesos huérfanos. Las de otras
    // máquinas también: el `bye` le dice a cada host que las suelte ya.
    ptys.killAll()
    peers?.shutdown()
    host?.stop()
  })
}

/** Los perfiles de esta máquina y, detrás, los de las máquinas emparejadas. */
function allProfiles(): ShellProfile[] {
  return [...profiles, ...(peers?.profiles() ?? [])]
}

function startHost(): void {
  if (host) return
  host = new Host({
    token: remoteConfig.host.token,
    port: remoteConfig.host.port,
    version: app.getVersion(),
    profiles: () => profiles,
    onState: (state) => toRenderer('host:state', state)
  })
}

function stopHost(): void {
  host?.stop()
  host = null
}

function hostState(): HostState {
  return (
    host?.state() ?? {
      enabled: false,
      addresses: [],
      port: remoteConfig.host.port,
      name: '',
      clients: [],
      pairing: null
    }
  )
}

/**
 * Prender o apagar el host. Lo acompaña el arranque con Windows (escondida en
 * el tray): una máquina que comparte tiene que estar escuchando sin que nadie
 * abra NTX a mano. Sólo empaquetada — en dev el exe es electron.exe y quedaría
 * registrado eso. Se toca sólo acá, al cambiar el switch: si alguien puso NTX
 * en el inicio por su cuenta, el arranque normal no se lo desarma.
 */
function setHostEnabled(enabled: boolean): HostState {
  remoteConfig.host.enabled = enabled
  saveRemoteConfig(remoteConfig)
  if (enabled) startHost()
  else stopHost()
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
  const state = hostState()
  toRenderer('host:state', state)
  return state
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
  ipcMain.handle('profiles:list', () => allProfiles())

  ipcMain.handle('pty:spawn', async (_e, options: SpawnOptions): Promise<PaneSnapshot> => {
    // Un perfil de otra máquina: el panel nace ya, su shell cuando se pueda.
    if (peers?.isRemoteProfile(options.profileId)) return peers.spawn(options)

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

  // Cada panel va a donde vive su shell: a este PtyManager o al socket de su
  // máquina. El renderer no distingue; el id alcanza.
  ipcMain.on('pty:write', (_e, paneId: string, data: string) => {
    if (peers?.owns(paneId)) peers.write(paneId, data)
    else ptys.write(paneId, data)
  })
  ipcMain.on('pty:resize', (_e, paneId: string, cols: number, rows: number) => {
    if (peers?.owns(paneId)) peers.resize(paneId, cols, rows)
    else ptys.resize(paneId, cols, rows)
  })
  ipcMain.on('pty:kill', (_e, paneId: string) => {
    if (peers?.owns(paneId)) peers.kill(paneId)
    else ptys.kill(paneId)
  })

  // El renderer ve el OSC 7 y nos pasa el cwd; nosotros le resolvemos el branch.
  // Va en el main porque es quien puede lanzar procesos. El de una shell remota
  // lo resuelve su host, que es donde existe esa carpeta.
  ipcMain.on('pane:report-cwd', (_e, paneId: string, cwd: string) => {
    if (peers?.owns(paneId)) {
      peers.reportCwd(paneId, cwd)
      return
    }
    if (ptys.cwdOf(paneId) === cwd) return // mismo directorio: no rehacemos nada
    ptys.setCwd(paneId, cwd)
    void branchFor(cwd).then((branch) => toRenderer('pane:cwd', paneId, cwd, branch))
  })

  // La escena entre arranques: el renderer la manda cuando cambia y la pide al
  // arrancar. Los shells nuevos los abre él por el camino de siempre (pty:spawn).
  ipcMain.handle('session:load', () => loadSession())
  ipcMain.on('session:save', (_e, session: SavedSession) => saveSession(session))

  // Las otras máquinas, de los dos lados.
  ipcMain.handle('remote:peers', () => peers?.states() ?? [])
  ipcMain.handle('remote:pair', (_e, address: string, pin: string) =>
    peers ? peers.pair(String(address), String(pin)) : { ok: false, error: 'Not ready yet.' }
  )
  ipcMain.on('remote:forget', (_e, peerId: string) => peers?.forget(String(peerId)))

  ipcMain.handle('host:state', () => hostState())
  ipcMain.handle('host:set-enabled', (_e, enabled: boolean) => setHostEnabled(enabled === true))
  ipcMain.on('host:pair-open', () => host?.openPairing())
  ipcMain.on('host:pair-close', () => host?.closePairing())
  ipcMain.on('host:unpair-all', () => {
    // Token nuevo: las máquinas emparejadas quedan afuera. Si se comparte, se
    // reinicia el host para que lo use y corte a los que estaban.
    remoteConfig.host.token = newToken()
    saveRemoteConfig(remoteConfig)
    if (host) {
      stopHost()
      startHost()
    }
    toRenderer('host:state', hostState())
  })

  ipcMain.on('updates:check', () => updater?.check())
  ipcMain.on('updates:install', () => updater?.install())
  ipcMain.handle('meta:version', () => app.getVersion())
  ipcMain.on('meta:open-repo', () => void shell.openExternal(REPO_URL))

  // El click de una notificación: mostrar y enfocar aunque viva en el tray.
  ipcMain.on('window:attention', () => {
    if (mainWindow) bringToFront(mainWindow)
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}
