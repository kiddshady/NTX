import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { SavedPane, SavedSession } from '../shared/types.js'

/**
 * La escena persistida: qué paneles había, en qué perfil, parados dónde.
 *
 * Vive en el main y no en localStorage por dos motivos: el renderer puede morir
 * antes de flushear, y el JSON en userData se puede escribir ATÓMICO — tmp y
 * rename — así un corte a mitad de escritura deja la versión anterior intacta
 * en vez de un archivo a medias que no parsea.
 */
function sessionFile(): string {
  return join(app.getPath('userData'), 'session.json')
}

/**
 * Las escrituras van en fila. Con el debounce del renderer casi nunca se
 * encima una con otra, pero si pasa, dos rename simultáneos sobre el mismo
 * destino son una carrera que no hace falta correr.
 */
let queue: Promise<void> = Promise.resolve()

export function saveSession(session: SavedSession): void {
  queue = queue.then(async () => {
    const file = sessionFile()
    try {
      await writeFile(`${file}.tmp`, JSON.stringify(session), 'utf8')
      await rename(`${file}.tmp`, file)
    } catch {
      // Guardar la escena es mejora, no contrato: fallar acá no puede molestar.
    }
  })
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(sessionFile(), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null

    const raw = (parsed as { panes?: unknown; focused?: unknown }).panes
    if (!Array.isArray(raw)) return null

    // Se valida entrada por entrada: un archivo editado a mano o de una versión
    // vieja no puede colar un panel sin perfil ni tirar el arranque.
    const panes = raw.filter(
      (pane): pane is SavedPane =>
        typeof pane === 'object' &&
        pane !== null &&
        typeof (pane as SavedPane).profileId === 'string' &&
        typeof (pane as SavedPane).cwd === 'string'
    )
    if (panes.length === 0) return null

    const focused = (parsed as { focused?: unknown }).focused
    return {
      panes,
      focused: typeof focused === 'number' && Number.isInteger(focused) ? focused : 0
    }
  } catch {
    return null // primer arranque, o un JSON roto: se arranca como siempre
  }
}
