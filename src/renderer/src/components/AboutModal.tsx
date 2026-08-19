import { useEffect, useRef, useState, type JSX } from 'react'
import { usePresence } from '../hooks/usePresence'
import type { UpdateState } from '../../../shared/types'

interface AboutModalProps {
  open: boolean
  update: UpdateState
  onClose: () => void
}

/** El fade de salida dura lo mismo que --ntx-fast, como la paleta. */
const EXIT_MS = 140

interface StatusAction {
  label: string
  run: () => void
  accent?: boolean
  disabled?: boolean
}

/**
 * Una fase → una línea y a lo sumo un botón. El modal no re-cuenta la historia
 * del updater: dice dónde está parado ahora y qué se puede hacer al respecto.
 */
function describe(update: UpdateState): { text: string; action?: StatusAction } {
  const check = (): void => window.ntx.updates.check()

  switch (update.phase) {
    case 'unsupported':
      return { text: 'Updates only run in the installed app.' }
    case 'checking':
      return { text: 'Checking for updates…', action: { label: 'Check now', run: check, disabled: true } }
    case 'uptodate':
      return { text: 'You’re up to date.', action: { label: 'Check again', run: check } }
    case 'downloading':
      return { text: `Downloading ${update.version ?? 'the update'} · ${update.percent ?? 0}%` }
    case 'ready':
      return {
        text: `${update.version} is ready — it applies on restart.`,
        action: { label: 'Restart now', run: () => window.ntx.updates.install(), accent: true }
      }
    case 'error':
      return { text: update.error ?? 'The update check failed.', action: { label: 'Retry', run: check } }
    default:
      return { text: 'NTX checks for updates on its own.', action: { label: 'Check now', run: check } }
  }
}

export function AboutModal({ open, update, onClose }: AboutModalProps): JSX.Element | null {
  const { mounted, closing } = usePresence(open, EXIT_MS)
  const [version, setVersion] = useState('')
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.ntx.meta.version().then(setVersion)
  }, [])

  // El foco va al panel para que Escape cierre. Depende de `mounted` por lo
  // mismo que el input de la paleta: recién ahí existe el nodo.
  useEffect(() => {
    if (open && mounted) panel.current?.focus()
  }, [open, mounted])

  if (!mounted) return null

  const status = describe(update)

  return (
    <div
      className="ntx-scrim ntx-scrim--center ntx-chrome"
      data-closing={closing}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        className="ntx-modal ntx-about"
        role="dialog"
        aria-label="About NTX"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="ntx-about__head">
          <span className="ntx-about__brand">NTX</span>
          <span className="ntx-about__version">{version || '·'}</span>
        </div>
        <p className="ntx-about__tag">Multi-shell terminal for Windows</p>

        {/* Datos de máquina: mono y seleccionables, que para eso son datos. */}
        <div className="ntx-about__meta">
          <span>Electron {window.ntx.platform.electron}</span>
          <span>Chrome {window.ntx.platform.version}</span>
        </div>

        <div className="ntx-about__updates">
          <p className="ntx-about__status" data-phase={update.phase}>
            {status.text}
          </p>

          {update.phase === 'downloading' && (
            <div
              className="ntx-progress"
              role="progressbar"
              aria-valuenow={update.percent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="ntx-progress__fill" style={{ width: `${update.percent ?? 0}%` }} />
            </div>
          )}

          {status.action && (
            <div className="ntx-about__row">
              <button
                className={status.action.accent ? 'ntx-btn ntx-btn--accent' : 'ntx-btn'}
                disabled={status.action.disabled}
                onClick={status.action.run}
              >
                {status.action.label}
              </button>
            </div>
          )}
        </div>

        <div className="ntx-about__foot">
          <button className="ntx-link" onClick={() => window.ntx.meta.openRepo()}>
            kiddshady/NTX on GitHub
          </button>
        </div>
      </div>
    </div>
  )
}
