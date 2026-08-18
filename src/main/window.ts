import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'

/**
 * El color base de la app. Va acá Y en el CSS, y tienen que ser el mismo.
 *
 * Electron 40 usa este color para teñir el frame fantasma que el compositor de
 * Windows pinta al restaurar la ventana. En Electron 33 y anteriores ese frame se
 * pintaba blanco hardcodeado y NO había CSS que lo tapara: por eso la versión está
 * pineada en 40.10.2.
 */
export const BASE_COLOR = '#08080a'

const WIN_W = 1280
const WIN_H = 820

export function createMainWindow(): BrowserWindow {
  // Centramos a mano sobre el área útil (descuenta la taskbar). Tiene que ser a
  // mano porque abajo pasamos x/y explícitos, y eso desactiva el auto-centrado.
  const { x: waX, y: waY, width: waW, height: waH } = screen.getPrimaryDisplay().workArea
  const winX = Math.round(waX + (waW - WIN_W) / 2)
  const winY = Math.round(waY + (waH - WIN_H) / 2)

  const win = new BrowserWindow({
    // Nace fuera de pantalla, a propósito.
    //
    // Al mapear el HWND por primera vez, el DWM de Win11 compone su backdrop
    // blanco POR ENCIMA del swap chain de Chromium. Ese flash no se puede evitar
    // —backgroundColor, splash inline y doble rAF no lo tocan, porque operan
    // dentro del contenido y no en lo que el compositor elige pintar encima—,
    // pero sí se puede provocar donde nadie lo vea. Mostramos acá, a -20000px, y
    // recién después movemos: una ventana ya compuesta se mueve sin volver a
    // disparar el flash.
    x: -20000,
    y: -20000,
    width: WIN_W,
    height: WIN_H,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    show: false,
    // Fuerza a Chromium a pintar el primer frame con la ventana oculta: cuando
    // hagamos show() off-screen ya hay contenido, y garantiza que ready-to-show
    // dispare.
    paintWhenInitiallyHidden: true,
    backgroundColor: BASE_COLOR,
    webPreferences: {
      // .mjs, no .js: el proyecto es ESM y electron-vite emite el preload con esa
      // extensión. Electron sólo carga un preload ESM si además `sandbox` es
      // false — de ahí la línea de abajo.
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // El pty vive en el main; el renderer sólo manda strings por IPC.
      sandbox: false,
      spellcheck: false
    }
  })

  // En dev el renderer vive en el server de vite (electron-vite exporta la URL);
  // empaquetado, sale del bundle en disco. Sin esta carga la ventana se queda sin
  // contenido, `ready-to-show` no dispara nunca y la app queda invisible allá en
  // -20000px — falla muda y desconcertante, porque el proceso arranca bien.
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  win.once('ready-to-show', () => {
    // El flash del compositor pasa acá — off-screen, invisible.
    win.show()
    // Y le damos al DWM tiempo de asentar ese show antes de mover. Moverla
    // demasiado rápido dispara un SEGUNDO flash, ya en destino. 200 ms es el
    // valor validado; 120 resultó intermitente.
    setTimeout(() => {
      if (!win.isDestroyed()) win.setPosition(winX, winY)
    }, 200)
  })

  // Un link del terminal abre en el navegador del sistema, nunca adentro de la
  // app: una ventana de Electron navegando a un sitio arbitrario es una vía de
  // escape del sandbox.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const emitMaximize = (): void => {
    if (!win.isDestroyed()) win.webContents.send('window:maximize-change', win.isMaximized())
  }
  win.on('maximize', emitMaximize)
  win.on('unmaximize', emitMaximize)

  return win
}
