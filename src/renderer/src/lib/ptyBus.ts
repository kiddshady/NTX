/**
 * Puente entre los eventos del pty y los paneles.
 *
 * Existe por un problema de carrera concreto: el shell empieza a escribir apenas
 * arranca en el main, pero el `<TerminalPane>` recién se monta un par de frames
 * después. Sin nada en el medio, el banner de PowerShell y la primera línea del
 * prompt se pierden — y el síntoma es de los que enloquecen, porque el panel
 * queda en blanco hasta que apretás una tecla.
 *
 * Así que el bus se suscribe UNA sola vez, apenas carga el módulo, y guarda lo
 * que llega para paneles que todavía no existen. Cuando el panel se engancha,
 * primero recibe lo acumulado y después sigue en vivo.
 */

type DataHandler = (data: string) => void
type ExitHandler = (code: number) => void

const handlers = new Map<string, DataHandler>()
const pending = new Map<string, string[]>()
const exitHandlers = new Map<string, ExitHandler>()
const exited = new Map<string, number>()

window.ntx.onData((paneId, data) => {
  const handler = handlers.get(paneId)
  if (handler) {
    handler(data)
    return
  }
  const queue = pending.get(paneId)
  if (queue) queue.push(data)
  else pending.set(paneId, [data])
})

window.ntx.onExit((paneId, code) => {
  const handler = exitHandlers.get(paneId)
  if (handler) handler(code)
  else exited.set(paneId, code)
})

/**
 * Engancha un panel al stream de su pty. Devuelve el desuscriptor.
 *
 * Lo acumulado se entrega en una sola escritura: xterm reflowea por cada write,
 * así que meterle el backlog de a chunks es tan lento como visible.
 */
export function attachPane(paneId: string, onData: DataHandler, onExit: ExitHandler): () => void {
  const backlog = pending.get(paneId)
  if (backlog) {
    pending.delete(paneId)
    onData(backlog.join(''))
  }
  handlers.set(paneId, onData)

  const exitCode = exited.get(paneId)
  if (exitCode !== undefined) {
    exited.delete(paneId)
    onExit(exitCode)
  }
  exitHandlers.set(paneId, onExit)

  return () => {
    handlers.delete(paneId)
    exitHandlers.delete(paneId)
  }
}

/** Limpia lo que hubiera quedado colgado de un panel ya cerrado. */
export function forgetPane(paneId: string): void {
  handlers.delete(paneId)
  exitHandlers.delete(paneId)
  pending.delete(paneId)
  exited.delete(paneId)
  readers.delete(paneId)
}

/* ---------------------------------------------------------------------------
 * Lo que el panel expone hacia arriba: su scrollback.
 *
 * La terminal vive adentro de <TerminalPane> y los comandos de la paleta viven
 * en App — este registro es el puente en la otra dirección. Cada panel deja un
 * lector (una función, no una copia: el buffer se lee recién cuando alguien lo
 * pide) y App lo consulta por id, igual que el bus de datos de arriba.
 * ------------------------------------------------------------------------- */

const readers = new Map<string, () => string>()

/** El panel registra cómo leerle el scrollback. Devuelve el desregistrador. */
export function attachReader(paneId: string, read: () => string): () => void {
  readers.set(paneId, read)
  return () => {
    readers.delete(paneId)
  }
}

/** El scrollback completo de un panel, o null si (ya) no está. */
export function scrollbackOf(paneId: string): string | null {
  return readers.get(paneId)?.() ?? null
}
