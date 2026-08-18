import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'

/**
 * El atajo global.
 *
 * Sigue la convención del resto de las apps —`Ctrl+Alt+<inicial>`, como
 * `Ctrl+Alt+C` de Console o `Ctrl+Alt+N` de NeonCode—. La X es la letra que
 * distingue a NTX: la N y la T ya estaban tomadas.
 *
 * Ojo con cambiarlo: un `globalShortcut` se queda con la tecla en TODAS las
 * apps, no sólo cuando NTX está al frente. Por eso no va nada como `Ctrl+`` `` o
 * F12, que le romperían la terminal integrada de VS Code o las devtools.
 */
export const HOTKEY = 'Control+Alt+X'

/** El ícono del tray, en ICO: Windows elige adentro el tamaño que pide el DPI. */
function trayIcon(): Electron.NativeImage {
  const file = app.isPackaged
    ? join(process.resourcesPath, 'icons', 'tray.ico')
    : join(app.getAppPath(), 'resources', 'icons', 'tray.ico')
  return nativeImage.createFromPath(file)
}

/**
 * Trae la ventana al frente de verdad.
 *
 * `focus()` solo no alcanza en Windows: el sistema no le deja robar el primer
 * plano a un proceso que no originó la interacción, y la llamada se convierte en
 * un parpadeo del botón de la barra de tareas. El paso por `alwaysOnTop` fuerza
 * el z-order y después lo devuelve como estaba.
 */
export function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.setAlwaysOnTop(true)
  win.focus()
  win.setAlwaysOnTop(false)
}

/**
 * El toggle del atajo, con TRES estados y no dos.
 *
 * Alternar visible/oculto a secas es lo intuitivo y es incómodo: cuando la
 * ventana está a la vista pero tapada por otra, apretar el atajo la esconde
 * justo cuando lo que querías era traerla. Por eso "sin foco" y "con foco" se
 * tratan distinto:
 *
 *   oculta            → mostrar y enfocar
 *   visible sin foco  → traer al frente
 *   visible con foco  → al tray
 */
export function toggleWindow(win: BrowserWindow): void {
  if (!win.isVisible() || win.isMinimized()) {
    bringToFront(win)
    return
  }
  if (!win.isFocused()) {
    bringToFront(win)
    return
  }
  win.hide()
}

interface TrayOptions {
  getWindow: () => BrowserWindow | null
  /** Salida de verdad: termina los ptys y cierra la app. */
  quit: () => void
}

export function createTray({ getWindow, quit }: TrayOptions): Tray {
  const tray = new Tray(trayIcon())
  tray.setToolTip('NTX')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show NTX',
      click: () => {
        const win = getWindow()
        if (win) bringToFront(win)
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: quit }
  ])

  // El menú va en el click DERECHO. El izquierdo hace toggle, que es lo que uno
  // espera de un ícono de tray y evita tener que pasar por el menú para lo único
  // que se usa todo el tiempo.
  tray.setContextMenu(menu)
  tray.on('click', () => {
    const win = getWindow()
    if (win) toggleWindow(win)
  })

  return tray
}
