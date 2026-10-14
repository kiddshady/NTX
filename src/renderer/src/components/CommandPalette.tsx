import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Icon, type IconName } from './Icon'
import { usePresence } from '../hooks/usePresence'
import { reducedMotion } from '../lib/motion'

export interface Command {
  id: string
  label: string
  /** La segunda línea: qué hace, en pocas palabras. */
  desc?: string
  /** El atajo, si lo tiene. */
  hint?: string
  icon: IconName
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  commands: Command[]
  onClose: () => void
}

/** El fade de salida dura lo mismo que --ntx-fast. */
const EXIT_MS = 130

/** El reacomodo de la lista al filtrar: lo que queda viaja, lo que se va se
 *  apaga en su lugar y el alto de la lista acompaña. */
const LIST_MS = 180
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const EASE_BOTH = 'cubic-bezier(0.65, 0, 0.35, 1)'

/**
 * Filtro por subsecuencia: "nps" encuentra "Nueva shell · PowerShell". Es lo que
 * uno espera de una paleta de comandos — tipear las iniciales y que aparezca.
 */
function matches(label: string, query: string): boolean {
  if (!query) return true

  const haystack = label.toLowerCase()
  const needle = query.toLowerCase().replace(/\s+/g, '')
  let cursor = 0

  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor)
    if (cursor === -1) return false
    cursor++
  }
  return true
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps): JSX.Element | null {
  const { mounted, closing } = usePresence(open, EXIT_MS)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const visible = useMemo(
    () => commands.filter((command) => matches(command.label, query)),
    [commands, query]
  )

  // Abrir siempre empieza en limpio: una paleta que recuerda lo último tipeado
  // obliga a borrar antes de poder usarla.
  //
  // Depende de `mounted` y no sólo de `open` por un desfasaje de un render:
  // cuando `open` pasa a true, usePresence todavía no marcó `mounted`, así que en
  // ese render el componente devuelve null y el input NO existe — el focus() caía
  // sobre una ref vacía y las teclas terminaban en la terminal de atrás.
  useEffect(() => {
    if (!open || !mounted) return
    setQuery('')
    setSelected(0)
    input.current?.focus()
  }, [open, mounted])

  // Si el filtro achicó la lista, la selección puede haber quedado afuera.
  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, visible.length - 1)))
  }, [visible.length])

  // La opción elegida con el teclado tiene que estar a la vista.
  useEffect(() => {
    list.current?.querySelectorAll('.ntx-command:not([data-ghost])')[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // --- El filtro no reescribe la lista: la reacomoda ---------------------------
  //
  // Cada comando es el MISMO botón de un filtro al siguiente (va por clave), así
  // que se puede animar de dónde estaba a dónde quedó (FLIP). El que el filtro
  // saca ya no existe en el DOM: se deja en su lugar un calco, fuera del flujo,
  // que se apaga encima. Y el alto de la lista viaja en vez de saltar.
  const layout = useRef<{ height: number; items: Map<string, { top: number; node: HTMLElement }> } | null>(null)
  const visibleKey = visible.map((command) => command.id).join('\n')
  useLayoutEffect(() => {
    const element = list.current
    if (!element) {
      layout.current = null
      return
    }
    const buttons = [...element.querySelectorAll<HTMLElement>('.ntx-command:not([data-ghost])')]
    const now = new Map(buttons.map((button) => [button.dataset.id!, { top: button.offsetTop, node: button }]))
    const before = layout.current
    const height = element.offsetHeight
    layout.current = { height, items: now }
    if (!before || reducedMotion()) return

    for (const [id, item] of now) {
      const was = before.items.get(id)
      if (!was) {
        item.node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: LIST_MS, easing: EASE })
      } else if (was.top !== item.top) {
        item.node.animate(
          [{ transform: `translateY(${was.top - item.top}px)` }, { transform: 'none' }],
          { duration: LIST_MS, easing: EASE }
        )
      }
    }
    for (const [id, was] of before.items) {
      if (now.has(id)) continue
      const ghost = was.node.cloneNode(true) as HTMLElement
      ghost.dataset.ghost = 'true'
      ghost.style.position = 'absolute'
      ghost.style.top = `${was.top}px`
      ghost.style.left = '7px'
      ghost.style.width = 'calc(100% - 14px)'
      ghost.style.pointerEvents = 'none'
      element.appendChild(ghost)
      const out = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE_BOTH, fill: 'forwards' })
      const drop = (): void => ghost.remove()
      out.finished.then(drop, drop)
      // Plazo de red: una ventana tapada no avanza la línea de tiempo.
      window.setTimeout(drop, 300)
    }
    if (before.height !== height) {
      // Al achicarse arranca despacio: el borde de abajo no puede pasarles por
      // encima a los calcos que todavía se están apagando.
      element.animate([{ height: `${before.height}px` }, { height: `${height}px` }], {
        duration: LIST_MS,
        easing: height < before.height ? EASE_BOTH : EASE
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, mounted])

  if (!mounted) return null

  const runAt = (index: number): void => {
    const command = visible[index]
    if (!command) return
    onClose()
    command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      setSelected((current) => (current + 1) % Math.max(1, visible.length))
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      setSelected((current) => (current - 1 + visible.length) % Math.max(1, visible.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runAt(selected)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="ntx-scrim ntx-chrome"
      data-closing={closing}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="ntx-palette"
        role="dialog"
        aria-label="Command palette"
        // Un click adentro del panel no debe llegar al scrim y cerrarlo.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ntx-palette__field">
          <Icon name="search" size={14} strokeWidth={1.8} />
          <input
            ref={input}
            className="ntx-palette__input"
            value={query}
            placeholder="Search for a command…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="ntx-palette__list" ref={list}>
          <div className="ntx-reveal" data-open={visible.length === 0}>
            <div className="ntx-reveal__inner">
              <div className="ntx-palette__empty">No commands match</div>
            </div>
          </div>

          {visible.map((command, index) => (
            <button
              key={command.id}
              data-id={command.id}
              className="ntx-command"
              data-selected={index === selected}
              onMouseEnter={() => setSelected(index)}
              onClick={() => runAt(index)}
            >
              <span className="ntx-command__icon">
                <Icon name={command.icon} size={14} />
              </span>
              <span className="ntx-command__text">
                <span className="ntx-command__label">{command.label}</span>
                {command.desc && <span className="ntx-command__desc">{command.desc}</span>}
              </span>
              {command.hint && <span className="ntx-command__hint">{command.hint}</span>}
            </button>
          ))}
        </div>

        {/* El pie con los atajos. Además de informar, es lo que hace que la lista
            corte contra una línea y no al aire: por eso arriba no lleva fade. */}
        <div className="ntx-palette__foot">
          <span className="ntx-palette__key">
            <Icon name="arrowUp" size={11} />
            <Icon name="arrowDown" size={11} />
            move
          </span>
          <span className="ntx-palette__key">
            <b>Enter</b> run
          </span>
          <span className="ntx-palette__key">
            <b>Esc</b> close
          </span>
        </div>
      </div>
    </div>
  )
}
