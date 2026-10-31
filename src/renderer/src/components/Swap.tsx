import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import { reducedMotion, ease, easeBoth } from '../lib/motion'

/** Lo que tarda en irse el texto viejo (la salida, en ease-both). */
const OUT_MS = 160

interface Item {
  key: number
  text: string
  leaving: boolean
  /** Si entra relevando a otro: espera su turno para no encimarse. */
  after: boolean
}

interface SwapProps {
  value: string
  className?: string
  /** Para un data-tip o un aria-label del contenedor. */
  tip?: string
}

/**
 * Un texto que cambia en su lugar: el viejo se va y el nuevo entra en la misma
 * celda, y el ancho viaja de uno al otro en vez de saltar (lo que viene detrás
 * se corre suave).
 *
 * El fundido va por COLOR, hacia y desde transparente, y no por opacidad: así
 * sirve también en el tab strip, donde una opacidad animada crea una capa del
 * compositor y le apaga el ClearType a todas las terminales (ver base.css, la
 * marca de la tab).
 *
 * La primera vez no anima: el primer llenado no es un cambio.
 */
export function Swap({ value, className, tip }: SwapProps): JSX.Element {
  const counter = useRef(0)
  const [items, setItems] = useState<Item[]>(() => [{ key: 0, text: value, leaving: false, after: false }])
  const box = useRef<HTMLSpanElement>(null)
  const width = useRef<number | null>(null)

  const current = items.find((item) => !item.leaving)
  if (current && current.text !== value) {
    // Cambio de valor durante el render: se decide acá para que el cuadro que
    // pinta el valor nuevo ya pinte el relevo (un efecto llegaría un cuadro
    // tarde y se vería el texto nuevo entero antes de que arranque).
    const key = ++counter.current
    setItems((previous) => [
      ...previous.map((item) => ({ ...item, leaving: true })),
      { key, text: value, leaving: false, after: previous.some((item) => !item.leaving && item.text !== '') }
    ])
  }

  // Los que se fueron, afuera cuando terminó su salida.
  useLayoutEffect(() => {
    if (!items.some((item) => item.leaving)) return
    const timer = window.setTimeout(
      () => setItems((previous) => previous.filter((item) => !item.leaving)),
      OUT_MS + 20
    )
    return () => window.clearTimeout(timer)
  }, [items])

  // El ancho viaja: el que se va no ocupa lugar (va fuera del flujo), así que
  // la caja ya mide lo del texto nuevo y se anima desde lo que medía antes.
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    // Desde lo que se ve AHORA: si el texto cambia dos veces seguidas, el viaje
    // retoma desde donde iba y no desde el destino del anterior (saltaba).
    const travelling = element.getAnimations()
    const shown = travelling.length > 0 ? element.getBoundingClientRect().width : width.current
    // Un viaje a medio camino se suelta antes de medir: si no, se mediría el
    // ancho animado y no el del texto.
    for (const running of travelling) running.cancel()
    const next = element.getBoundingClientRect().width
    const previous = shown
    width.current = next
    if (previous === null) return
    // El que se va queda clavado en el ancho que tenía. Suelto (va absoluto),
    // se acomodaba a la caja que se achica y se cortaba con «…» cuando todavía
    // se veía casi entero. Con decimales: clientWidth redondea.
    for (const out of element.querySelectorAll<HTMLElement>(':scope > [data-state="out"]')) {
      if (!out.style.width) out.style.width = `${previous}px`
    }
    if (Math.abs(previous - next) < 0.5 || reducedMotion()) return
    // Al achicarse con alguien yéndose, la caja espera a que el viejo casi no
    // se vea (motion-timing §10): primero se va lo de adentro, después se pliega.
    const shrinkingOverExit = next < previous && items.some((item) => item.leaving)
    element.animate(
      [{ width: `${previous}px` }, { width: `${next}px` }],
      shrinkingOverExit
        ? { duration: 180, easing: easeBoth(), delay: 100, fill: 'backwards' }
        : { duration: 180, easing: ease() }
    )
  }, [items])

  return (
    <span ref={box} className={className ? `ntx-swap ${className}` : 'ntx-swap'} data-tip={tip}>
      {items.map((item) => (
        <span
          key={item.key}
          className="ntx-swap__item"
          data-state={item.leaving ? 'out' : item.key === 0 ? 'still' : 'in'}
          data-after={item.after}
          aria-hidden={item.leaving || undefined}
        >
          {item.text}
        </span>
      ))}
    </span>
  )
}
