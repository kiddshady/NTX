import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types.js'

// electron-updater es CommonJS; en ESM el named import depende del interop del
// bundler, el default no. Por eso se desarma acá y no en el import.
const { autoUpdater } = electronUpdater

/** Cada cuánto se re-escanea solo. NTX vive días en el tray: una vez no alcanza. */
const RESCAN_MS = 4 * 60 * 60 * 1_000

/** El primer escaneo espera a que la app termine de acomodarse. */
const FIRST_SCAN_DELAY_MS = 15_000

export interface Updater {
  check(): void
  install(): void
  dispose(): void
}

/**
 * El auto-update, condensado a dos verbos y un estado.
 *
 * La política es la simple: escanear solo (al arrancar y cada tanto), descargar
 * solo, y avisar recién cuando no queda nada que esperar — el aviso es "listo,
 * se aplica al reiniciar", nunca "¿querés bajarlo?". La única decisión que se le
 * deja al usuario es CUÁNDO reiniciar, porque es la única que le cuesta algo.
 *
 * Si elige "más tarde", no se insiste: `autoInstallOnAppQuit` instala en el
 * próximo cierre real (el de verdad, no el que esconde al tray).
 */
export function createUpdater(send: (state: UpdateState) => void): Updater {
  // Fuera de la app instalada no hay updater: en dev no hay app-update.yml que
  // consultar, y el portable no sabe reinstalarse a sí mismo. La UI recibe
  // `unsupported` y explica, en vez de mostrar un botón que no puede cumplir.
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) {
    return {
      check: () => send({ phase: 'unsupported' }),
      install: () => {},
      dispose: () => {}
    }
  }

  // La versión que viene viaja con cada estado: el progreso llega sin ella y la
  // UI la necesita para decir QUÉ está bajando.
  let incoming: string | undefined

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send({ phase: 'checking' }))
  autoUpdater.on('update-not-available', () => send({ phase: 'uptodate' }))
  autoUpdater.on('update-available', (info) => {
    incoming = info.version
    send({ phase: 'downloading', version: incoming, percent: 0 })
  })
  autoUpdater.on('download-progress', (progress) =>
    send({ phase: 'downloading', version: incoming, percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => send({ phase: 'ready', version: info.version }))
  autoUpdater.on('error', (error) =>
    // El mensaje entero suele ser una traza; a la UI le alcanza la primera línea.
    send({ phase: 'error', error: String(error?.message ?? error).split('\n')[0] })
  )

  const scan = (): void => {
    // El catch va acá y no en cada caller: sin red el escaneo periódico no
    // tiene que tirar nada — ya emitió `error` por el listener de arriba.
    void autoUpdater.checkForUpdates().catch(() => {})
  }

  const firstScan = setTimeout(scan, FIRST_SCAN_DELAY_MS)
  const rescan = setInterval(scan, RESCAN_MS)

  return {
    check: scan,
    // quitAndInstall dispara before-quit, que es quien levanta la bandera
    // `quitting`: el handler de close deja pasar el cierre en vez de esconder.
    install: () => autoUpdater.quitAndInstall(),
    dispose: () => {
      clearTimeout(firstScan)
      clearInterval(rescan)
    }
  }
}
