/**
 * El Ctrl+click sobre un link lo abre NTX, y la app de adentro no tiene que
 * abrirlo otra vez.
 *
 * Una app que toma el mouse (Claude Code, por ejemplo) recibe el mismo click
 * que NTX, con la marca de Ctrl adentro. Claude Code, al ver un Ctrl+click
 * sobre un link, lo abre por su cuenta (salvo que la terminal sea VS Code o
 * diga ser xterm.js por XTVERSION), así que el navegador abría la página dos
 * veces. Y en un panel remoto, la segunda vez se abría en la OTRA máquina.
 *
 * Mientras el puntero está sobre un link que NTX va a abrir, el click le llega
 * a la app sin el Ctrl: para ella es un click común, que no abre nada.
 */

// Reporte SGR (modo 1006): ESC [ < botón ; columna ; fila M (apretar) o m (soltar).
// En el botón, el bit 16 es Ctrl, el 32 es movimiento y el 64 la rueda.
const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/

const CTRL = 16
const MOTION = 32
const WHEEL = 64

/** El mismo reporte sin el Ctrl, si es un apretar o soltar con Ctrl; si no, tal cual. */
export function withoutCtrlClick(data: string): string {
  const m = SGR_MOUSE.exec(data)
  if (!m) return data
  const button = Number(m[1])
  if (!(button & CTRL) || button & (MOTION | WHEEL)) return data
  return `\x1b[<${button & ~CTRL};${m[2]};${m[3]}${m[4]}`
}
