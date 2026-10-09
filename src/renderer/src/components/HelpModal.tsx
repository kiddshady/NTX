import { Fragment, useEffect, useRef, type JSX } from 'react'
import { usePresence } from '../hooks/usePresence'

interface HelpModalProps {
  open: boolean
  onClose: () => void
}

/** El fade de salida dura lo mismo que --ntx-fast, como el about. */
const EXIT_MS = 140

/** Un atajo: cada combo es una lista de teclas, y un atajo puede tener más de
 *  un combo que hace lo mismo (Ctrl C con selección, o Ctrl Shift C). */
interface Shortcut {
  label: string
  combos: string[][]
}

/**
 * Los atajos de NTX, todos en un lugar. Es la única copia escrita: si se agrega
 * o cambia uno en App o en TerminalPane, se cambia también acá.
 *
 * Antes la paleta los iba anunciando de a uno al costado de sus comandos, pero
 * eso obligaba a cargarla de comandos que ya tenían su tecla — y la paleta
 * quedó para lo que se elige de una lista: qué shell abrir.
 */
const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Shells',
    items: [
      { label: 'New shell', combos: [['Ctrl', 'Shift', 'T']] },
      { label: 'Close the active shell', combos: [['Ctrl', 'Shift', 'W']] },
      { label: 'Next shell', combos: [['Ctrl', 'Tab']] },
      { label: 'Previous shell', combos: [['Ctrl', 'Shift', 'Tab']] },
      { label: 'Jump to a shell', combos: [['Ctrl', '1–4']] }
    ]
  },
  {
    title: 'Terminal',
    items: [
      { label: 'Copy the selection', combos: [['Ctrl', 'C'], ['Ctrl', 'Shift', 'C']] },
      { label: 'Paste', combos: [['Ctrl', 'V'], ['Ctrl', 'Shift', 'V']] },
      { label: 'Find in scrollback', combos: [['Ctrl', 'Shift', 'F']] },
      { label: 'Next · previous match', combos: [['Enter'], ['Shift', 'Enter']] }
    ]
  },
  {
    title: 'Window',
    items: [{ label: 'Show or hide NTX, from anywhere', combos: [['Ctrl', 'Alt', 'X']] }]
  },
  {
    title: 'Zoom',
    items: [
      { label: 'Zoom in · out', combos: [['Ctrl', '+'], ['Ctrl', '-']] },
      { label: 'Zoom with the wheel', combos: [['Ctrl', 'Wheel']] },
      { label: 'Reset zoom', combos: [['Ctrl', '0']] }
    ]
  }
]

export function HelpModal({ open, onClose }: HelpModalProps): JSX.Element | null {
  const { mounted, closing } = usePresence(open, EXIT_MS)
  const panel = useRef<HTMLDivElement>(null)

  // El foco va al panel para que Escape cierre; depende de `mounted` por lo
  // mismo que el about: recién ahí existe el nodo.
  useEffect(() => {
    if (open && mounted) panel.current?.focus()
  }, [open, mounted])

  if (!mounted) return null

  return (
    <div
      className="ntx-scrim ntx-scrim--center ntx-chrome"
      data-closing={closing}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        className="ntx-modal ntx-help"
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="ntx-help__head">Keyboard shortcuts</div>

        {GROUPS.map((group) => (
          <section key={group.title} className="ntx-help__group">
            <h3 className="ntx-help__title">{group.title}</h3>
            {group.items.map((item) => (
              <div key={item.label} className="ntx-help__row">
                <span className="ntx-help__label">{item.label}</span>
                <span className="ntx-help__combos">
                  {item.combos.map((combo, index) => (
                    <Fragment key={combo.join('+')}>
                      {/* Dos combos que hacen lo mismo se separan con un «or»
                          en palabras: una barra o un punto se leerían como
                          parte de la tecla. */}
                      {index > 0 && <span className="ntx-help__or">or</span>}
                      <span className="ntx-help__combo">
                        {combo.map((key) => (
                          <kbd key={key} className="ntx-help__key">
                            {key}
                          </kbd>
                        ))}
                      </span>
                    </Fragment>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}

        <p className="ntx-help__foot">
          Ctrl C copies only with something selected — otherwise it interrupts, as always.
        </p>
      </div>
    </div>
  )
}
