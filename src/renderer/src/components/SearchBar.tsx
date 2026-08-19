import { useEffect, useRef, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { usePresence } from '../hooks/usePresence'

/** Lo que la barra sabe de la búsqueda en curso. `index` es -1 cuando el addon
 *  desbordó su límite de resaltados y ya no lleva la cuenta de cuál es cuál. */
export interface SearchResults {
  index: number
  count: number
}

export interface SearchQuery {
  term: string
  caseSensitive: boolean
  /** true = no saltar al siguiente si el término extendido sigue matcheando
   *  donde estamos parados. Es el modo del tipeo en vivo. */
  incremental: boolean
  previous: boolean
}

interface SearchBarProps {
  open: boolean
  /** Sube cada vez que se re-pide abrir la búsqueda ya abierta: re-enfoca y
   *  selecciona el término, en vez de no hacer nada. */
  nonce: number
  results: SearchResults | null
  onFind: (query: SearchQuery) => void
  /** Término vacío: hay que apagar los resaltados sin cerrar la barra. */
  onClear: () => void
  onClose: () => void
}

/** El fade de salida dura lo mismo que --ntx-fast. */
const EXIT_MS = 140

/**
 * La barra de búsqueda del scrollback. Flota arriba a la derecha DEL PANEL:
 * la búsqueda es del shell enfocado, no de la app, y quedarse adentro del marco
 * lo dice sin explicarlo.
 */
export function SearchBar({
  open,
  nonce,
  results,
  onFind,
  onClear,
  onClose
}: SearchBarProps): JSX.Element | null {
  const { mounted, closing } = usePresence(open, EXIT_MS)
  const [term, setTerm] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // Igual que la paleta: depende de `mounted` porque en el render en que `open`
  // pasa a true el input todavía no existe. Y el nonce re-dispara el focus si la
  // búsqueda ya estaba abierta y la vuelven a pedir. El término anterior se
  // conserva y queda seleccionado: repetir la última búsqueda es Enter, empezar
  // otra es tipear encima.
  useEffect(() => {
    if (!open || !mounted) return
    input.current?.focus()
    input.current?.select()
  }, [open, mounted, nonce])

  if (!mounted) return null

  const find = (patch: Partial<SearchQuery>): void => {
    const query: SearchQuery = { term, caseSensitive, incremental: false, previous: false, ...patch }
    if (query.term) onFind(query)
    else onClear()
  }

  const onChange = (value: string): void => {
    setTerm(value)
    if (value) onFind({ term: value, caseSensitive, incremental: true, previous: false })
    else onClear()
  }

  const toggleCase = (): void => {
    const next = !caseSensitive
    setCaseSensitive(next)
    find({ caseSensitive: next, incremental: true })
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      find({ previous: event.shiftKey })
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  // El contador es dato puro. index -1 = el addon desbordó su límite: se sabe
  // cuántos hay pero no cuál es el actual, así que se muestra sólo el total.
  const counter =
    !term || !results ? null
    : results.count === 0 ? '0/0'
    : results.index === -1 ? `${results.count}+`
    : `${results.index + 1}/${results.count}`

  return (
    <div className="ntx-search ntx-chrome" role="search" data-closing={closing}>
      <Icon name="search" size={12} strokeWidth={1.8} />
      <input
        ref={input}
        className="ntx-search__input"
        value={term}
        placeholder="Find…"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="ntx-search__count" data-none={counter === '0/0'}>
        {counter}
      </span>
      <span className="ntx-search__sep" aria-hidden="true" />
      <button
        className="ntx-search__btn"
        data-tip="Previous match · Shift Enter"
        aria-label="Previous match"
        onClick={() => find({ previous: true })}
      >
        <Icon name="arrowUp" size={11} />
      </button>
      <button
        className="ntx-search__btn"
        data-tip="Next match · Enter"
        aria-label="Next match"
        onClick={() => find({})}
      >
        <Icon name="arrowDown" size={11} />
      </button>
      <button
        className="ntx-search__btn"
        data-on={caseSensitive}
        data-tip="Match case"
        aria-label="Match case"
        aria-pressed={caseSensitive}
        onClick={toggleCase}
      >
        {/* Texto, no ícono: "Aa" ES el concepto, y dibujado como trazo se
            volvería un logograma que hay que aprender. */}
        <span className="ntx-search__case">Aa</span>
      </button>
      <button className="ntx-search__btn" data-tip="Close · Esc" aria-label="Close search" onClick={onClose}>
        <Icon name="close" size={11} />
      </button>
    </div>
  )
}
