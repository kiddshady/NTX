import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'

interface TipState {
  label: string
  /** Centro horizontal del elemento que lo dispara. */
  centerX: number
  anchorTop: number
  anchorBottom: number
  /** Dónde estaba el puntero al momento de abrirse. */
  pointerY: number
}

const OPEN_DELAY_MS = 380
const EXIT_MS = 160
/** Aire entre el tooltip y lo que lo despeja. */
const GAP_PX = 8
/** Margen mínimo contra los bordes de la ventana. */
const EDGE_PX = 6
/**
 * Cuánto baja el dibujo del cursor por debajo de su punto activo.
 *
 * El tooltip tiene que despejar LA MANITO, no el elemento. Suena a lo mismo pero
 * no lo es: un botón alto (los de ntermx ocupan toda la titlebar) ya termina por
 * debajo del cursor, así que alcanza con separarse de su borde. Los puntitos de
 * acá miden 12px y su borde inferior queda por ENCIMA de la manito — separarse de
 * él dejaba el tooltip tapado por el propio cursor.
 */
const CURSOR_PX = 18

/**
 * El tooltip de NTX. Se monta una sola vez y atiende a todo el árbol.
 *
 * El `title=` nativo queda descartado por tres motivos: es amarillo del sistema,
 * tarda casi un segundo y no se puede estilar ni animar. Este va por delegación
 * de eventos sobre `[data-tip]`, así que cualquier elemento se vuelve tooltipeable
 * agregando el atributo, sin envolverlo en nada.
 */
export function TooltipLayer(): JSX.Element | null {
  const [tip, setTip] = useState<TipState | null>(null)
  const [open, setOpen] = useState(false)
  const openTimer = useRef<number | null>(null)
  const unmountTimer = useRef<number | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const node = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cancelTimers = (): void => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current)
      if (unmountTimer.current !== null) window.clearTimeout(unmountTimer.current)
      openTimer.current = null
      unmountTimer.current = null
    }

    const hide = (): void => {
      cancelTimers()
      setOpen(false)
      // Se desmonta recién cuando terminó el fade de salida. Sacarlo ya lo haría
      // desaparecer de un frame al otro.
      unmountTimer.current = window.setTimeout(() => setTip(null), EXIT_MS)
    }

    // El puntero se sigue en vivo: entre que entrás al elemento y que vence la
    // demora podés haberte movido, y el tooltip tiene que despejar dónde está la
    // manito AHORA, no dónde entró.
    const onMove = (event: MouseEvent): void => {
      pointer.current = { x: event.clientX, y: event.clientY }
    }

    const onOver = (event: MouseEvent): void => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]')
      const label = target?.dataset.tip
      if (!label) return

      cancelTimers()
      openTimer.current = window.setTimeout(() => {
        const box = target!.getBoundingClientRect()
        setTip({
          label,
          centerX: box.left + box.width / 2,
          anchorTop: box.top,
          anchorBottom: box.bottom,
          pointerY: pointer.current.y
        })
      }, OPEN_DELAY_MS)
    }

    const onOut = (event: MouseEvent): void => {
      if ((event.target as HTMLElement | null)?.closest('[data-tip]')) hide()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    // Un click o perder el foco dejan el tooltip flotando sobre algo que ya no está.
    document.addEventListener('mousedown', hide)
    window.addEventListener('blur', hide)

    return () => {
      cancelTimers()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('mousedown', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Posicionar y recién después abrir. Las dos cosas van juntas a propósito: si
  // montara ya con data-open, el navegador no vería un CAMBIO de opacidad y no
  // habría transición — el tooltip aparecería de golpe.
  useLayoutEffect(() => {
    const el = node.current
    if (!el || !tip) return

    const { width, height } = el.getBoundingClientRect()

    // Centrado en el elemento, pero sin salirse de la ventana.
    const left = Math.max(
      EDGE_PX,
      Math.min(tip.centerX - width / 2, window.innerWidth - width - EDGE_PX)
    )

    // Debajo del elemento Y debajo de la manito: mandá el que quede más abajo.
    let top = Math.max(tip.anchorBottom, tip.pointerY + CURSOR_PX) + GAP_PX
    let above = false
    // Si no entra abajo (por ejemplo el de la ruta, que vive en la status bar),
    // se da vuelta y va arriba del elemento.
    if (top + height > window.innerHeight - EDGE_PX) {
      top = tip.anchorTop - height - GAP_PX
      above = true
    }

    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.dataset.above = String(above)

    const frame = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [tip])

  if (!tip) return null

  return (
    <div ref={node} className="ntx-tooltip" data-open={open} role="tooltip">
      {tip.label}
    </div>
  )
}
