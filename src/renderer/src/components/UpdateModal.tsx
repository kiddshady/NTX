import { useEffect, useRef, type JSX } from 'react'
import { usePresence } from '../hooks/usePresence'

interface UpdateModalProps {
  open: boolean
  version?: string
  onInstall: () => void
  onLater: () => void
}

const EXIT_MS = 140

/**
 * El aviso de que la actualización YA está: bajó sola y solo falta reiniciar.
 *
 * Aparece una única vez por versión y la pregunta es sólo CUÁNDO — por eso los
 * botones son "ahora" y "después", nunca "¿descargar?". Y el foco va al panel,
 * no al botón primario: este modal interrumpe a alguien tipeando en una shell,
 * y un Enter que venía para el prompt no puede terminar reiniciando la app.
 */
export function UpdateModal({ open, version, onInstall, onLater }: UpdateModalProps): JSX.Element | null {
  const { mounted, closing } = usePresence(open, EXIT_MS)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && mounted) panel.current?.focus()
  }, [open, mounted])

  if (!mounted) return null

  return (
    <div
      className="ntx-scrim ntx-scrim--center ntx-chrome"
      data-closing={closing}
      onMouseDown={onLater}
      role="presentation"
    >
      <div
        ref={panel}
        className="ntx-modal ntx-update"
        role="dialog"
        aria-label="Update ready"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onLater()
          }
        }}
      >
        <div className="ntx-update__head">
          <span className="ntx-update__pulse" aria-hidden="true" />
          <span className="ntx-update__title">Update ready</span>
        </div>

        <p className="ntx-update__body">
          NTX {version} downloaded itself and applies on restart. Restarting closes the shells you
          have open — later works too: it installs with the next real quit.
        </p>

        <div className="ntx-modal__actions">
          <button className="ntx-btn" onClick={onLater}>
            Later
          </button>
          <button className="ntx-btn ntx-btn--accent" onClick={onInstall}>
            Restart now
          </button>
        </div>
      </div>
    </div>
  )
}
