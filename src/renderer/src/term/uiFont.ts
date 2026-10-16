/**
 * La letra mono de la interfaz sigue a la de la terminal (Ctrl+Shift+L): las
 * pestañas, la barra de estado, las cabeceras de los paneles, los atajos y todo
 * lo que va en --ntx-font-mono. La sans (Inter) no cambia.
 *
 * Las dos miden 0,6 em de ancho, así que el cambio no corre nada: lo único que
 * se mueve es la opacidad. Lo que está en mono se apaga, cambia de letra y
 * vuelve, con los mismos tiempos que el fundido de la terminal (110 y 180 ms),
 * para que todo cambie junto.
 */
import { TERMINAL_FONTS, type TerminalFont } from './fonts'
import { reducedMotion } from '../lib/motion'

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const EASE_BOTH = 'cubic-bezier(0.65, 0, 0.35, 1)'

function setVariable(font: TerminalFont): void {
  document.documentElement.style.setProperty('--ntx-font-mono', TERMINAL_FONTS[font])
}

/** Antes del primer render (main.tsx): la letra con la que nace no cambia después de pintar. */
export function initUiFont(font: TerminalFont): void {
  setVariable(font)
}

/** La pila sin comillas ni espacios: el computado la devuelve con comillas
 *  dobles y la variable la tiene con simples. */
function normalize(stack: string): string {
  return stack.replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim()
}

/** Lo más alto de cada rama que va en mono: se funde eso, y lo de adentro va con él.
 *  Fundir también a los hijos multiplicaría la opacidad. */
function monoRoots(stack: string): HTMLElement[] {
  const isMono = (element: Element): boolean => normalize(getComputedStyle(element).fontFamily) === stack
  const roots: HTMLElement[] = []
  for (const element of document.querySelectorAll<HTMLElement>('.ntx-chrome, .ntx-chrome *')) {
    if (element.closest('.xterm') || !isMono(element)) continue
    const parent = element.parentElement
    if (parent && parent.closest('.ntx-chrome') && isMono(parent)) continue
    roots.push(element)
  }
  return roots
}

let pending: Promise<unknown> | null = null

/** Cambia la letra de la interfaz con el fundido. */
export function switchUiFont(font: TerminalFont): void {
  if (reducedMotion()) {
    setVariable(font)
    return
  }
  const stack = normalize(getComputedStyle(document.documentElement).getPropertyValue('--ntx-font-mono'))
  const elements = monoRoots(stack)
  const outs = elements.map((element) => {
    // Si venía de otro cambio a medio fundido, sigue desde donde estaba.
    const from = getComputedStyle(element).opacity
    element.getAnimations().filter((a) => a.id === 'ntx-ui-font').forEach((a) => a.cancel())
    const out = element.animate([{ opacity: from }, { opacity: 0 }], { duration: 110, easing: EASE_BOTH, fill: 'forwards' })
    out.id = 'ntx-ui-font'
    return out
  })
  const done = (pending = Promise.all(outs.map((out) => out.finished)))
  // Plazo de red: con la ventana tapada la línea de tiempo no avanza y el
  // finished no llega nunca; la letra cambia igual.
  const fallback = window.setTimeout(() => finish(), 230)
  let finished = false
  function finish(): void {
    if (finished || pending !== done) return
    finished = true
    window.clearTimeout(fallback)
    setVariable(font)
    for (const out of outs) out.cancel()
    for (const element of elements) {
      // Sin la salida puesta, vuelve al tono que manda el CSS (una pestaña sin foco no es opacidad 1).
      const to = getComputedStyle(element).opacity
      const back = element.animate([{ opacity: 0 }, { opacity: to }], { duration: 180, easing: EASE })
      back.id = 'ntx-ui-font'
    }
  }
  done.then(finish).catch(() => {
    // Cancelada por un cambio más nuevo: ése se encarga.
  })
}
