import type { Terminal } from '@xterm/xterm'

/**
 * Los fondos de celda van en una capa DEBAJO de todo el texto de la terminal.
 *
 * El renderer DOM de xterm pinta cada tramo de celdas con el mismo estilo como
 * un span, y el fondo de un truecolor lo lleva inline en ese span. Un span es
 * fondo + texto en un solo paso, así que el fondo de un tramo se pinta ENCIMA
 * de lo que el tramo de la izquierda dejó asomar. Con letras no importa; con
 * bloques sí: ntx-blocks.ttf (ver scripts/make-blocks.py) saca cada borde un
 * pelito afuera de la celda para que los vecinos se pisen, y el fondo del tramo
 * siguiente se come justo ese pisotón. El mascot de Claude Code lleva fondo
 * negro desde la tercera celda de cada fila, y ahí quedaba una costura vertical
 * de punta a punta, verdosa con ClearType.
 *
 * El arreglo es el orden de pintado que ya tienen los renderers de canvas y
 * WebGL: primero todos los fondos, después todas las letras. A cada span que
 * llega con fondo inline se le pasa ese color a `--ntx-cell-bg` y se le saca el
 * fondo; lo pinta su `::before` con z-index -1 dentro de `.xterm-screen`, que
 * es contexto de apilamiento (base.css). Hay que sacárselo de verdad: con
 * `background-clip: text` el span repinta el fondo con la forma de la letra y
 * oscurece los bordes suavizados, que es la misma costura con otra causa.
 *
 * El observer corre como microtarea después de que xterm arma la fila y antes
 * del pintado: no hay un frame con el fondo viejo. xterm rehace los spans de una
 * fila entera cada vez que la vuelve a dibujar, así que alcanza con mirar los
 * nodos agregados. El cursor queda afuera: sus reglas de base.css le pintan el
 * fondo al span mismo y lo hacen parpadear con `inherit`.
 *
 * Sólo los fondos inline (truecolor). Los de paleta van por clase
 * (`.xterm-bg-N`) y siguen como siempre; hasta hoy la costura sólo apareció con
 * truecolor.
 */
export function lowerCellBackgrounds(terminal: Terminal): () => void {
  const rows = terminal.element?.querySelector<HTMLElement>('.xterm-rows')
  if (!rows) return () => {}

  const lower = (span: HTMLElement): void => {
    const background = span.style.backgroundColor
    if (!background || span.classList.contains('xterm-cursor')) return
    span.style.setProperty('--ntx-cell-bg', background)
    span.style.backgroundColor = ''
    span.classList.add('ntx-cell-bg')
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLSpanElement) lower(node)
        // Una fila nueva entera (al redimensionar) llega con los spans adentro.
        else if (node instanceof HTMLElement) node.querySelectorAll('span').forEach(lower)
      }
    }
  })
  // Las filas son hijas directas de `.xterm-rows` y los spans, hijos de cada
  // fila: subtree para llegar a los spans, sin atributos para no escucharnos.
  observer.observe(rows, { childList: true, subtree: true })
  for (const span of rows.querySelectorAll<HTMLElement>('span')) lower(span)

  return () => observer.disconnect()
}
