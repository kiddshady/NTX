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
// El --op-bg de Opal (oklch 14.5% 0 258): la única superficie opaca de la piel.
export const BASE_COLOR = '#0a0a0a'

const WIN_W = 1200
const WIN_H = 800

/**
 * El tamaño y la posición de entrada: 1200×800 achicado al área útil (descuenta
 * la taskbar) y centrado ahí.
 *
 * Achicar no es opcional. En la UCK1 (1366×768, área útil 1366×720) los 800 de
 * alto no entraban: centrar daba y = (720 − 800) / 2 = −40 y la barra de título
 * nacía arriba de la pantalla, sin forma de agarrarla. Es el mismo fitIn() que
 * ya tienen las apps de Onyx y Opal.
 *
 * Centramos a mano porque abajo pasamos x/y explícitos, y eso desactiva el
 * auto-centrado.
 */
export function enAreaUtil(
  a: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(WIN_W, a.width)
  const height = Math.min(WIN_H, a.height)
  return {
    width,
    height,
    x: Math.round(a.x + (a.width - width) / 2),
    y: Math.round(a.y + (a.height - height) / 2)
  }
}

export function createMainWindow({ hidden = false }: { hidden?: boolean } = {}): BrowserWindow {
  const destino = enAreaUtil(screen.getPrimaryDisplay().workArea)

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
    width: destino.width,
    height: destino.height,
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
    // El flash del compositor pasa acá — off-screen, invisible. Arrancada
    // escondida (con Windows, para compartir la máquina) se compone igual pero
    // sin robar el foco, y se vuelve a esconder: así el primer show de verdad,
    // desde el tray, es el de una ventana ya compuesta y no flashea.
    if (hidden) win.showInactive()
    else win.show()
    // Y le damos al DWM tiempo de asentar ese show antes de mover. Moverla
    // demasiado rápido dispara un SEGUNDO flash, ya en destino. 200 ms es el
    // valor validado; 120 resultó intermitente.
    setTimeout(() => {
      if (win.isDestroyed()) return
      if (hidden) win.hide()
      win.setPosition(destino.x, destino.y)
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
