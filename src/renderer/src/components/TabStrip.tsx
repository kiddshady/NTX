import { useLayoutEffect, useRef, type JSX, type PointerEvent } from 'react'
import { Icon } from './Icon'
import { Swap } from './Swap'
import { MAX_PANES, paneTabLabel, type PaneState } from '../lib/panes'
import { useStableOrder } from '../hooks/useStableOrder'
import { reducedMotion, ease, easeBoth } from '../lib/motion'

interface TabStripProps {
  panes: PaneState[]
  focusedIndex: number
  accentOf: (index: number) => string
  onFocus: (index: number) => void
  onClose: (paneId: string) => void
  onNew: () => void
  /** Arrastrar una tab la lleva a otro lugar. Opcional: NTX Mobile no arrastra. */
  onReorder?: (paneId: string, toIndex: number) => void
}

/** Lo que hay que moverse para que un click pase a ser un arrastre. */
const DRAG_THRESHOLD = 4

interface Drag {
  id: string
  pointerId: number
  startX: number
  active: boolean
  /** Lo medido al arrancar (layout, sin transforms), en el orden de las tabs. */
  slots: { id: string; left: number; width: number }[]
  from: number
  to: number
}

export function TabStrip({
  panes,
  focusedIndex,
  accentOf,
  onFocus,
  onClose,
  onNew,
  onReorder
}: TabStripProps): JSX.Element {
  const full = panes.length >= MAX_PANES

  // --- Arrastrar para reordenar ------------------------------------------------
  //
  // Puntero a mano, no drag & drop de HTML: ése arrastra una foto nativa
  // semitransparente de Chromium. La tab que agarrás sigue al mouse (transform,
  // nada de layout), las otras se corren a hacerle lugar, y al soltar cada una
  // viaja desde donde se veía hasta su lugar nuevo (FLIP).
  //
  // Las tabs se renderizan en el orden en que nacieron y el orden que se ve lo
  // pone `order`: mover el nodo le reiniciaría la animación de entrada.
  const stable = useStableOrder(panes)
  const indexOf = new Map(panes.map((pane, index) => [pane.id, index]))
  const strip = useRef<HTMLElement>(null)
  const tabs = useRef(new Map<string, HTMLButtonElement>())
  const drag = useRef<Drag | null>(null)
  // El click que llega al soltar un arrastre no es un click.
  const swallowClick = useRef(false)
  // Dónde se veía cada tab en el instante de soltar, para el FLIP.
  const flipFrom = useRef(new Map<string, number>())

  const settle = (): void => {
    for (const [id, from] of flipFrom.current) {
      const element = tabs.current.get(id)
      if (!element) continue
      for (const animation of element.getAnimations()) {
        if (animation.id === 'ntx-tab-flip') animation.cancel()
      }
      const dx = from - element.getBoundingClientRect().left
      const lifted = element.dataset.lifted === 'true'
      const land = (): void => {
        if (lifted) delete element.dataset.lifted
      }
      if (Math.abs(dx) < 0.5 || reducedMotion()) {
        land()
        continue
      }
      const animation = element.animate(
        [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }],
        { duration: 180, easing: ease(), id: 'ntx-tab-flip' }
      )
      // Con la ventana tapada la animación no avanza y el finished no llega.
      const fallback = window.setTimeout(land, 300)
      animation.finished.then(
        () => {
          window.clearTimeout(fallback)
          land()
        },
        () => undefined
      )
    }
    flipFrom.current.clear()
  }

  useLayoutEffect(() => {
    if (flipFrom.current.size > 0) settle()
  })

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, pane: PaneState): void => {
    swallowClick.current = false
    if (!onReorder || event.button !== 0 || pane.closing) return
    if ((event.target as HTMLElement).closest('.ntx-tab__close')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      id: pane.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      active: false,
      slots: [],
      from: 0,
      to: 0
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.startX
    if (!current.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return
      current.active = true
      current.slots = panes.map((pane) => {
        const element = tabs.current.get(pane.id)
        return { id: pane.id, left: element?.offsetLeft ?? 0, width: element?.offsetWidth ?? 0 }
      })
      current.from = current.slots.findIndex((slot) => slot.id === current.id)
      current.to = current.from
      if (strip.current) strip.current.dataset.dragging = 'true'
      const element = tabs.current.get(current.id)
      if (element) element.dataset.lifted = 'true'
    }

    const { slots, from } = current
    const self = slots[from]!
    const first = slots[0]!
    const last = slots[slots.length - 1]!
    // No sale de la fila de tabs.
    const x = Math.max(first.left - self.left, Math.min(dx, last.left + last.width - self.left - self.width))
    tabs.current.get(current.id)!.style.transform = `translateX(${x}px)`

    // El lugar nuevo: tantas tabs antes como centros quedan a su izquierda. En
    // el tope de cada punta los dos centros coinciden justo (con anchos iguales),
    // así que el empate cuenta a favor de la punta: las de la derecha se pasan
    // con `<=` y las de la izquierda con `<`.
    const center = self.left + self.width / 2 + x
    let to = 0
    slots.forEach((slot, index) => {
      if (index === from) return
      const middle = slot.left + slot.width / 2
      if (index > from ? middle <= center : middle < center) to++
    })
    current.to = to

    // Las del medio se corren lo que ocupa la que se mueve, con su gap.
    const gap = parseFloat(getComputedStyle(strip.current!).columnGap) || 0
    slots.forEach((slot, index) => {
      if (slot.id === current.id) return
      let shift = 0
      if (from < to && index > from && index <= to) shift = -(self.width + gap)
      if (to < from && index >= to && index < from) shift = self.width + gap
      const element = tabs.current.get(slot.id)
      if (element) element.style.transform = shift ? `translateX(${shift}px)` : ''
    })
  }

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>): void => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    if (!current.active) return
    swallowClick.current = event.type === 'pointerup'

    // Primero la foto de dónde se ve cada una, después se sueltan los transforms:
    // sin la transición del arrastre puesta, soltarlos no anima nada.
    for (const slot of current.slots) {
      const element = tabs.current.get(slot.id)
      if (element) flipFrom.current.set(slot.id, element.getBoundingClientRect().left)
    }
    if (strip.current) delete strip.current.dataset.dragging
    for (const slot of current.slots) {
      const element = tabs.current.get(slot.id)
      if (element) element.style.transform = ''
    }
    if (current.to !== current.from && event.type === 'pointerup') onReorder?.(current.id, current.to)
    else settle()
  }

  // --- El latido se apaga asentándose, no cortándose ---------------------------
  //
  // La marca late (ocupado, o comando terminado sin mirar) con una animación
  // infinita, y apagarla es sacarle la animación: el color saltaba en un cuadro
  // desde donde estuviera el ciclo (medido: del 35 % al 45 %, y del 100 % si
  // tocaba en la cresta). Una transición no lo salva — sacar una animación no
  // dispara transiciones —, así que se lee el color que tenía al apagarse y se
  // lo lleva hasta el de reposo. Por color, como todo en el tab strip.
  const marks = useRef(new Map<string, HTMLSpanElement>())
  const pulsing = useRef(new Map<string, boolean>())
  const settleFrom = useRef(new Map<string, { backgroundColor: string; boxShadow: string }>())
  for (const pane of panes) {
    const now = pane.notify || pane.busySince !== null
    const element = marks.current.get(pane.id)
    // Leído en el render, antes de que el commit le saque el atributo: después
    // ya no queda nada que leer.
    if (pulsing.current.get(pane.id) && !now && element && !settleFrom.current.has(pane.id)) {
      const style = getComputedStyle(element)
      settleFrom.current.set(pane.id, { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow })
    }
  }
  useLayoutEffect(() => {
    for (const pane of panes) pulsing.current.set(pane.id, pane.notify || pane.busySince !== null)
    for (const [id, from] of settleFrom.current) {
      const element = marks.current.get(id)
      if (!element) continue
      const to = getComputedStyle(element)
      element.animate(
        [from, { backgroundColor: to.backgroundColor, boxShadow: to.boxShadow }],
        { duration: 280, easing: ease() }
      )
    }
    settleFrom.current.clear()
  })
  // --- Abrir y cerrar: el ancho de verdad, no el tope --------------------------
  //
  // El pliegue va por max-width, y el tope es 260 px (220 en base.css), pero
  // una pastilla «pwsh» mide ~70. Animando hasta el tope, al abrir con expo-out
  // el max-width cruzaba los 70 a los ~15 ms: la pestaña y el + saltaban. Al
  // cerrar, de 260 a 70 no se movía nada y después se plegaba en ~60 ms. Acá se
  // mide el ancho real y se anima ése. La entrada de CSS (ntx-tab-in) y la
  // transición de max-width se cancelan para no pelear: una animación de CSS
  // cancelada no vuelve hasta que cambie su nombre, y una transición cancelada
  // no se rearma hasta que el valor cambie otra vez.
  const seen = useRef(new Set<string>())
  const closingFrom = useRef(new Map<string, number>())
  for (const pane of panes) {
    const element = tabs.current.get(pane.id)
    // Leído en el render, antes de que el commit le ponga data-closing.
    if (pane.closing && element && element.dataset.closing !== 'true' && !closingFrom.current.has(pane.id)) {
      closingFrom.current.set(pane.id, element.getBoundingClientRect().width)
    }
  }
  useLayoutEffect(() => {
    const motion = !reducedMotion()
    for (const pane of stable) {
      const element = tabs.current.get(pane.id)
      if (!element || seen.current.has(pane.id)) continue
      seen.current.add(pane.id)
      if (!motion) continue
      const entrance = element
        .getAnimations()
        .find((animation) => (animation as CSSAnimation).animationName === 'ntx-tab-in')
      if (!entrance) continue
      const duration = Number(entrance.effect?.getTiming().duration) || 280
      entrance.cancel()
      const width = element.getBoundingClientRect().width
      const gap = strip.current ? parseFloat(getComputedStyle(strip.current).columnGap) || 0 : 0
      element.animate(
        [
          {
            maxWidth: '0px',
            minWidth: '0px',
            paddingLeft: '0px',
            paddingRight: '0px',
            // Plegada no deja el hueco del gap de la fila.
            marginRight: `${-gap}px`,
            color: 'transparent'
          },
          { maxWidth: `${width}px` }
        ],
        { duration, easing: ease() }
      )
    }
    for (const [id, from] of closingFrom.current) {
      const element = tabs.current.get(id)
      if (!element || !motion) continue
      const fold = element
        .getAnimations()
        .find((animation) => (animation as CSSTransition).transitionProperty === 'max-width')
      if (!fold) continue
      const duration = Number(fold.effect?.getTiming().duration) || 160
      fold.cancel()
      element.animate([{ maxWidth: `${from}px` }, { maxWidth: '0px' }], { duration, easing: easeBoth() })
    }
    closingFrom.current.clear()
  })

  // Las que se están yendo ya no cuentan: el contador baja cuando la cerrás.
  const live = panes.filter((pane) => !pane.closing).length

  return (
    <nav ref={strip} className="ntx-tabs ntx-chrome">
      {stable.map((pane) => {
        const index = indexOf.get(pane.id)!
        return (
          <button
            key={pane.id}
            ref={(element) => {
              if (element) tabs.current.set(pane.id, element)
              else {
                tabs.current.delete(pane.id)
                seen.current.delete(pane.id)
              }
            }}
            className="ntx-tab"
            style={{ order: index }}
            data-active={index === focusedIndex}
            // La tab de un panel que se va se pliega con él, en vez de quedarse
            // entera y desaparecer de golpe cuando el panel termina de irse.
            data-closing={pane.closing}
            tabIndex={pane.closing ? -1 : undefined}
            onPointerDown={(event) => onPointerDown(event, pane)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false
                return
              }
              if (!pane.closing) onFocus(index)
            }}
          >
            <span
              ref={(element) => {
                if (element) marks.current.set(pane.id, element)
                else marks.current.delete(pane.id)
              }}
              className="ntx-tab__mark"
              data-notify={pane.notify}
              data-busy={pane.busySince !== null}
              style={{ ['--mark' as string]: accentOf(index) }}
            />
            <Swap className="ntx-tab__label" value={paneTabLabel(pane)} />
            <span
              className="ntx-tab__close"
              role="button"
              aria-label={`Close ${paneTabLabel(pane)}`}
              data-tip="Close shell"
              onClick={(event) => {
                // Sin esto, cerrar también enfocaría la tab que estás cerrando.
                event.stopPropagation()
                onClose(pane.id)
              }}
            >
              <Icon name="close" size={10} strokeWidth={2} />
            </span>
          </button>
        )
      })}

      <button
        className="ntx-tabs__new"
        onClick={onNew}
        disabled={full}
        data-tip={full ? 'NTX holds up to three shells' : 'New shell · Ctrl Shift T'}
        aria-label="New shell"
      >
        <Icon name="plus" size={11} strokeWidth={2} />
        <Swap className="ntx-tabs__count" value={`${live}/${MAX_PANES}`} />
      </button>

      <span className="ntx-tabs__hint">
        <Icon name="tabs" size={12} strokeWidth={1.7} />
        Ctrl 1–3 switches shell
      </span>
    </nav>
  )
}
