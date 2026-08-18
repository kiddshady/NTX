import { type JSX } from 'react'
import { Icon } from './Icon'
import { MAX_PANES, paneTabLabel, type PaneState } from '../lib/panes'

interface TabStripProps {
  panes: PaneState[]
  focusedIndex: number
  accentOf: (index: number) => string
  onFocus: (index: number) => void
  onClose: (paneId: string) => void
  onNew: () => void
}

export function TabStrip({
  panes,
  focusedIndex,
  accentOf,
  onFocus,
  onClose,
  onNew
}: TabStripProps): JSX.Element {
  const full = panes.length >= MAX_PANES

  return (
    <nav className="ntx-tabs ntx-chrome">
      {panes.map((pane, index) => (
        <button
          key={pane.id}
          className="ntx-tab"
          data-active={index === focusedIndex}
          onClick={() => onFocus(index)}
        >
          <span className="ntx-tab__mark" style={{ ['--mark' as string]: accentOf(index) }} />
          <span className="ntx-tab__label">{paneTabLabel(pane)}</span>
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
        data-tip={full ? 'The grid holds up to four shells' : 'New shell · Ctrl Shift T'}
        aria-label="New shell"
      >
        <Icon name="plus" size={11} strokeWidth={2} />
        <span className="ntx-tabs__count">
          {panes.length}/{MAX_PANES}
        </span>
      </button>

      <span className="ntx-tabs__hint">
        <Icon name="grid" size={10} />
        Ctrl 1–4 switches shell
      </span>
    </nav>
  )
}
