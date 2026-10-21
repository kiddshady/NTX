import { useEffect, useRef, useState, type JSX } from 'react'
import { usePresence } from '../hooks/usePresence'
import { Swap } from './Swap'
import type { UpdateState } from '../../../shared/types'

interface AboutModalProps {
  open: boolean
  update: UpdateState
  onClose: () => void
}

/** El fade de salida dura lo mismo que --ntx-fast, como la paleta. */
const EXIT_MS = 130

interface StatusAction {
  label: string
  run: () => void
  accent?: boolean
  disabled?: boolean
}

/** Todos los rótulos que puede tener el botón: el botón mide lo del más ancho. */
const LABEL = {
  check: 'Check now',
  again: 'Check again',
  retry: 'Retry',
  restart: 'Restart now'
} as const

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
      return { text: 'Checking for updates…', action: { label: LABEL.check, run: check, disabled: true } }
    case 'uptodate':
      return { text: 'You’re up to date.', action: { label: LABEL.again, run: check } }
    case 'downloading':
      // Sin el porcentaje: lo dice la barra, y en el texto cada punto sería un relevo.
      return { text: `Downloading ${update.version ?? 'the update'}…` }
    case 'ready':
      return {
        text: `${update.version} is ready — it applies on restart.`,
        action: { label: LABEL.restart, run: () => window.ntx.updates.install(), accent: true }
      }
    case 'error':
      return { text: update.error ?? 'The update check failed.', action: { label: LABEL.retry, run: check } }
    default:
      return { text: 'Updates are checked automatically.', action: { label: LABEL.check, run: check } }
  }
}

export function AboutModal({ open, update, onClose }: AboutModalProps): JSX.Element | null {
  const { mounted, closing } = usePresence(open, EXIT_MS)
  const [version, setVersion] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const lastAction = useRef<StatusAction>({ label: LABEL.check, run: () => window.ntx.updates.check() })
  const actionShown = useRef(true)
  const actionKey = useRef(0)
  const lastPercent = useRef(0)
  const wasDownloading = useRef(false)
  const fillKey = useRef(0)

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
  const downloading = update.phase === 'downloading'
  // La barra se apaga llena si la descarga terminó, y quieta donde quedó si
  // no: la fase siguiente no trae porcentaje, y volver a 0 la vaciaba mientras
  // se apagaba. Una descarga nueva la toma de cero sin viaje (fill nuevo).
  if (downloading && !wasDownloading.current) fillKey.current += 1
  wasDownloading.current = downloading
  if (downloading) lastPercent.current = update.percent ?? 0
  else if (update.phase === 'ready') lastPercent.current = 100
  // Cada vez que el botón vuelve a prenderse, su rótulo nace de nuevo.
  if (status.action && !actionShown.current) actionKey.current += 1
  actionShown.current = status.action !== undefined
  // La acción se apaga con su último rótulo adentro.
  if (status.action) lastAction.current = status.action
  const action = lastAction.current

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
          {/* Vacía hasta que llega: un relleno («·») haría del primer dato un
              cambio, y lo vería relevarse al abrir. */}
          <span className="ntx-about__version">{version}</span>
        </div>
        <p className="ntx-about__tag">Multi-shell terminal for Windows</p>

        {/* Datos de máquina: mono y seleccionables, que para eso son datos. */}
        <div className="ntx-about__meta">
          <span>Electron {window.ntx.platform.electron}</span>
          <span>Chrome {window.ntx.platform.version}</span>
        </div>

        <div className="ntx-about__updates">
          <p className="ntx-about__status" data-phase={update.phase}>
            <Swap value={status.text} />
          </p>

          {/* La barra y el botón viven siempre y en la MISMA celda: cuando
              termina la descarga, la barra se apaga y el botón se prende en su
              lugar, sin que la caja cambie de alto. Antes eran dos pliegues,
              uno cerrándose y otro abriéndose a la vez, y el botón subía
              destapándose de arriba para abajo, como una rebanada. */}
          <div className="ntx-reveal" data-open={downloading || status.action !== undefined}>
            <div className="ntx-reveal__inner">
              <div className="ntx-about__slot">
                <div
                  className="ntx-progress"
                  data-shown={downloading}
                  role="progressbar"
                  aria-hidden={!downloading}
                  aria-valuenow={lastPercent.current}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    key={fillKey.current}
                    className="ntx-progress__fill"
                    style={{ transform: `scaleX(${lastPercent.current / 100})` }}
                  />
                </div>
                <div className="ntx-about__row" data-shown={status.action !== undefined}>
                  <button
                    className={action.accent ? 'ntx-btn ntx-btn--accent' : 'ntx-btn'}
                    disabled={action.disabled || !status.action}
                    onClick={action.run}
                  >
                    {/* El ancho lo ponen los rótulos invisibles, todos en la
                        misma celda: el botón mide siempre lo del más ancho y no
                        cambia de tamaño con el relevo, que va centrado. */}
                    <span className="ntx-about__label">
                      {Object.values(LABEL).map((label) => (
                        <span key={label} className="ntx-about__sizer" aria-hidden>
                          {label}
                        </span>
                      ))}
                      {/* Con el botón apagado el rótulo cambia en seco: un relevo
                          ahí seguiría corriendo mientras el botón se prende. */}
                      <Swap key={actionKey.current} value={action.label} />
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
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
