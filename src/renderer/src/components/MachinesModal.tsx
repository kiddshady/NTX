import { useEffect, useRef, useState, type JSX } from 'react'
import { usePresence } from '../hooks/usePresence'
import { Icon } from './Icon'
import type { ShellProfile } from '../../../shared/types'
import type { HostState, PeerState } from '../../../shared/remote'

interface MachinesModalProps {
  open: boolean
  host: HostState | null
  peers: PeerState[]
  /** Todos los perfiles: de acá salen los de cada máquina para "New shell". */
  profiles: ShellProfile[]
  /** Si el grid ya tiene sus cuatro paneles: "New shell" no tiene dónde caer. */
  full: boolean
  onSpawn: (profileId: string) => void
  onClose: () => void
}

/** El fade de salida dura lo mismo que --ntx-fast, como el About. */
const EXIT_MS = 140

/** Cuánto espera un botón destructivo armado a que lo confirmes. */
const ARM_MS = 3_000

/**
 * Un botón que pide dos clicks: el primero lo arma y le cambia el texto, el
 * segundo hace. Si no llega el segundo, se desarma solo. Para lo que no tiene
 * vuelta atrás sin volver a emparejar.
 */
function ArmedButton({ label, armed: armedLabel, onConfirm }: { label: string; armed: string; onConfirm: () => void }): JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => setArmed(false), ARM_MS)
    return () => window.clearTimeout(timer)
  }, [armed])
  return (
    <button
      className="ntx-btn ntx-btn--danger"
      data-armed={armed}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
        }
      }}
    >
      {armed ? armedLabel : label}
    </button>
  )
}

/** "1:42" hasta que venza el PIN. */
function useCountdown(until: number | null): string {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (until === null) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [until])
  if (until === null) return ''
  const left = Math.max(0, Math.round((until - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

const PHASE_LABEL: Record<PeerState['phase'], string> = {
  online: 'Online',
  connecting: 'Looking for it',
  offline: 'Reconnecting',
  failed: 'Needs pairing'
}

export function MachinesModal({
  open,
  host,
  peers,
  profiles,
  full,
  onSpawn,
  onClose
}: MachinesModalProps): JSX.Element | null {
  const { mounted, closing } = usePresence(open, EXIT_MS)
  const panel = useRef<HTMLDivElement>(null)

  const [address, setAddress] = useState('')
  const [pin, setPin] = useState('')
  const [pairing, setPairing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [switching, setSwitching] = useState(false)

  const countdown = useCountdown(host?.pairing?.until ?? null)

  // Lo último que se mostró, para que se pliegue CON su contenido: si el texto
  // se vaciara en el mismo cuadro en que empieza a cerrarse, saltaría.
  const lastResult = useRef(result)
  if (result) lastResult.current = result
  const lastPin = useRef('')
  if (host?.pairing) lastPin.current = host.pairing.pin

  useEffect(() => {
    if (open && mounted) panel.current?.focus()
  }, [open, mounted])

  // Lo que se tipeó en el formulario no sobrevive a cerrar: la próxima vez es
  // otro emparejamiento.
  useEffect(() => {
    if (open) return
    setPin('')
    setResult(null)
  }, [open])

  if (!mounted) return null

  const sharing = host?.enabled ?? false

  const toggleSharing = async (): Promise<void> => {
    if (!window.ntx.host || switching) return
    setSwitching(true)
    try {
      await window.ntx.host.setEnabled(!sharing)
    } finally {
      setSwitching(false)
    }
  }

  const pair = async (): Promise<void> => {
    if (!window.ntx.remote || pairing) return
    setPairing(true)
    setResult(null)
    try {
      const outcome = await window.ntx.remote.pair(address, pin)
      if (outcome.ok) {
        setResult({ ok: true, text: `Paired with ${outcome.peer.name}.` })
        setPin('')
        setAddress('')
      } else {
        setResult({ ok: false, text: outcome.error })
      }
    } finally {
      setPairing(false)
    }
  }

  return (
    <div
      className="ntx-scrim ntx-scrim--center ntx-chrome"
      data-closing={closing}
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        className="ntx-modal ntx-machines"
        role="dialog"
        aria-label="Machines"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="ntx-machines__head">
          <Icon name="machine" size={15} strokeWidth={1.6} />
          <span className="ntx-machines__title">Machines</span>
        </div>

        {/* --- Esta máquina ---------------------------------------------------- */}
        <section className="ntx-machines__block">
          <div className="ntx-machines__label">
            This machine
            {host?.name && <span className="ntx-machines__name">{host.name}</span>}
          </div>

          <button
            className="ntx-switch"
            role="switch"
            aria-checked={sharing}
            data-on={sharing}
            disabled={switching || !window.ntx.host}
            onClick={() => void toggleSharing()}
          >
            <span className="ntx-switch__track">
              <span className="ntx-switch__thumb" />
            </span>
            <span className="ntx-switch__text">
              <span className="ntx-switch__title">Share this machine’s shells</span>
              <span className="ntx-switch__desc">
                Paired machines on your network can open shells here. While it’s on, NTX starts with Windows,
                hidden in the tray.
              </span>
            </span>
          </button>

          <div className="ntx-reveal" data-open={sharing}>
            <div className="ntx-reveal__inner">
              <div className="ntx-machines__facts">
                <span className="ntx-machines__fact-key">Address</span>
                {/* Una por línea: en una laptop suelen ser dos o tres (wifi,
                    Tailscale, el adaptador de VirtualBox) y cortadas al medio
                    no se leen. */}
                <span className="ntx-machines__fact-value ntx-machines__addresses">
                  {host && host.addresses.length > 0
                    ? host.addresses.map((a) => <span key={a}>{`${a}:${host.port}`}</span>)
                    : 'No network yet'}
                </span>
                <span className="ntx-machines__fact-key">Connected</span>
                <span className="ntx-machines__fact-value ntx-machines__fact-value--ui">
                  {host && host.clients.length > 0 ? host.clients.join(', ') : 'Nobody'}
                </span>
              </div>

              <div className="ntx-pin" data-open={host?.pairing != null}>
                <div className="ntx-pin__inner">
                  <span className="ntx-pin__label">Type this PIN on the other machine</span>
                  <span className="ntx-pin__code">{lastPin.current}</span>
                  <span className="ntx-pin__expiry">Expires in {countdown}</span>
                </div>
              </div>

              <div className="ntx-machines__row">
                {host?.pairing ? (
                  <button className="ntx-btn" onClick={() => window.ntx.host?.closePairing()}>
                    Cancel pairing
                  </button>
                ) : (
                  <button className="ntx-btn ntx-btn--accent" onClick={() => window.ntx.host?.openPairing()}>
                    Pair a machine
                  </button>
                )}
                <ArmedButton
                  label="Unpair all"
                  armed="Click again to unpair all"
                  onConfirm={() => window.ntx.host?.unpairAll()}
                />
              </div>
            </div>
          </div>
        </section>

        {/* --- Las otras ------------------------------------------------------- */}
        <section className="ntx-machines__block">
          <div className="ntx-machines__label">Paired machines</div>

          {peers.length === 0 ? (
            <p className="ntx-machines__empty">None yet. Turn sharing on in the other machine and pair it here.</p>
          ) : (
            <ul className="ntx-peers">
              {peers.map((peer) => {
                const first = profiles.find((p) => p.id.startsWith(`@${peer.id}/`))
                return (
                  <li key={peer.id} className="ntx-peer" data-phase={peer.phase}>
                    <span className="ntx-peer__dot" />
                    <span className="ntx-peer__main">
                      <span className="ntx-peer__name">
                        {peer.name}
                        <span className="ntx-peer__address">{peer.address}</span>
                      </span>
                      <span className="ntx-peer__status">
                        {PHASE_LABEL[peer.phase]}
                        {peer.message && peer.phase !== 'online' ? ` · ${peer.message}` : ''}
                      </span>
                    </span>
                    <span className="ntx-peer__actions">
                      <button
                        className="ntx-btn"
                        disabled={!first || full}
                        data-tip={full ? 'The grid already holds four shells' : first ? `Opens ${first.label} on ${peer.name}` : undefined}
                        onClick={() => {
                          if (!first) return
                          onSpawn(first.id)
                          onClose()
                        }}
                      >
                        New shell
                      </button>
                      <ArmedButton
                        label="Forget"
                        armed="Forget?"
                        onConfirm={() => window.ntx.remote?.forget(peer.id)}
                      />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          <form
            className="ntx-pair"
            onSubmit={(event) => {
              event.preventDefault()
              void pair()
            }}
          >
            <input
              className="ntx-field ntx-pair__address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Name or IP · UCK1, 192.168.1.5"
              spellCheck={false}
              aria-label="Address of the other machine"
            />
            <input
              className="ntx-field ntx-pair__pin"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="PIN"
              inputMode="numeric"
              aria-label="PIN shown on the other machine"
            />
            <button
              className="ntx-btn ntx-btn--accent"
              type="submit"
              disabled={pairing || !address.trim() || pin.length !== 6}
            >
              {pairing ? 'Pairing…' : 'Pair'}
            </button>
          </form>

          <p className="ntx-pair__result" data-ok={lastResult.current?.ok ?? true} data-show={result !== null}>
            {lastResult.current?.text ?? ''}
          </p>
        </section>
      </div>
    </div>
  )
}
