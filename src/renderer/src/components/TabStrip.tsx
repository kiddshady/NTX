import { useLayoutEffect, useRef, type JSX } from 'react'
import { Icon } from './Icon'
import { Swap } from './Swap'
import { MAX_PANES, paneTabLabel, type PaneState } from '../lib/panes'

interface TabStripProps {
  panes: PaneState[]
  focusedIndex: number
  accentOf: (index: number) => string
  onFocus: (index: number) => void
  onClose: (paneId: string) => void
  onNew: () => void
  /** De a una shell o todas a la vista. Opcional: NTX Mobile no lo tiene, y sin
   *  él la tira muestra la ayuda de siempre. */
  layout?: 'tabs' | 'grid'
  onLayout?: (layout: 'tabs' | 'grid') => void
}

export function TabStrip({
  panes,
  focusedIndex,
  accentOf,
  onFocus,
  onClose,
  onNew,
  layout,
  onLayout
}: TabStripProps): JSX.Element {
  const full = panes.length >= MAX_PANES

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
        { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' }
      )
    }
    settleFrom.current.clear()
  })
  // Las que se están yendo ya no cuentan: el contador baja cuando la cerrás.
  const live = panes.filter((pane) => !pane.closing).length

  return (
    <nav className="ntx-tabs ntx-chrome">
      {panes.map((pane, index) => (
        <button
          key={pane.id}
          className="ntx-tab"
          data-active={index === focusedIndex}
          // La tab de un panel que se va se pliega con él, en vez de quedarse
          // entera y desaparecer de golpe cuando el panel termina de irse.
          data-closing={pane.closing}
          tabIndex={pane.closing ? -1 : undefined}
          onClick={() => {
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
      ))}

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
        {!layout && <Icon name="grid" size={10} />}
        Ctrl 1–3 switches shell
      </span>

      {layout && onLayout && (
        <span className="ntx-layout" role="group" aria-label="Layout">
          <button
            className="ntx-layout__btn"
            data-active={layout === 'tabs'}
            aria-pressed={layout === 'tabs'}
            aria-label="Tabs"
            data-tip="One shell at a time · Ctrl Shift G"
            onClick={() => onLayout('tabs')}
          >
            <Icon name="tabs" size={12} strokeWidth={1.7} />
          </button>
          <button
            className="ntx-layout__btn"
            data-active={layout === 'grid'}
            aria-pressed={layout === 'grid'}
            aria-label="Grid"
            data-tip="All shells in view · Ctrl Shift G"
            onClick={() => onLayout('grid')}
          >
            <Icon name="grid" size={11} strokeWidth={1.7} />
          </button>
        </span>
      )}
    </nav>
  )
}
