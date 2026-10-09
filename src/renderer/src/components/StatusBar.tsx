import { useEffect, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { formatDuration, paneHome, shortPath, type PaneState } from '../lib/panes'
import type { Palette } from '../term/themes'
import type { SystemStats } from '../../../shared/types'

interface StatusBarProps {
  /** Las de la máquina del panel activo: si es de la UCK1, cpu y mem son de ella. */
  stats: SystemStats
  active: PaneState | undefined
  /** El acento del panel activo: el contador de ocupado habla en SU color. */
  accent: string
  palette: Palette
  onOpenAbout: () => void
  /** La ayuda con los atajos. Opcional por lo mismo que Machines: NTX Mobile no
   *  tiene teclado que explicar. */
  onOpenHelp?: () => void
  /** El botón de Machines. Opcionales los dos: NTX Mobile usa esta misma barra
   *  y no maneja máquinas. */
  onOpenMachines?: () => void
  /** Si ESTA máquina comparte, y cuántos están conectados ahora. */
  sharing?: { on: boolean; clients: number }
}

/** Cuánto lleva corriendo, refrescado por segundo — o null si nada corre. El
 *  timer existe SÓLO mientras hay un busySince que contar; en reposo la barra
 *  no gasta ni un tick de más (el reloj de al lado ya tiene el suyo). */
function useElapsed(since: number | null): string | null {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    if (since === null) {
      setLabel(null)
      return
    }
    const tick = (): void => setLabel(formatDuration(Date.now() - since))
    tick()
    const timer = window.setInterval(tick, 1_000)
    return () => window.clearInterval(timer)
  }, [since])

  return label
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export function StatusBar({
  stats,
  active,
  accent,
  palette,
  onOpenAbout,
  onOpenHelp,
  onOpenMachines,
  sharing
}: StatusBarProps): JSX.Element {
  const clock = useClock()
  const running = useElapsed(active?.busySince ?? null)

  return (
    <footer className="ntx-status ntx-chrome">
      {/* De qué máquina hablan cpu, mem y la ruta. Sólo aparece cuando NO es
          ésta: en reposo la barra es la de siempre. Entra plegada y se
          despliega, para que lo de al lado se corra en vez de saltar. */}
      <span
        className="ntx-status__item ntx-status__machine"
        data-show={active?.remote !== undefined}
        data-online={active?.remote?.online ?? true}
      >
        <span className="ntx-status__machine-inner">
          <Icon name="machine" size={11} strokeWidth={1.6} />
          <span className="ntx-status__value">{active?.remote?.host ?? ''}</span>
        </span>
      </span>

      <span className="ntx-status__item" style={{ ['--tone' as string]: palette.accent }}>
        <b>cpu</b>
        <span className="ntx-status__value ntx-status__gauge">{stats.cpu}%</span>
      </span>

      <span className="ntx-status__item" style={{ ['--tone' as string]: palette.alt }}>
        <b>mem</b>
        <span className="ntx-status__value ntx-status__gauge">{stats.mem}%</span>
      </span>

      {active?.branch && (
        <span className="ntx-status__item" style={{ ['--tone' as string]: palette.warn }}>
          <Icon name="branch" size={11} strokeWidth={1.5} />
          <span className="ntx-status__value ntx-copyable">{active.branch}</span>
        </span>
      )}

      {active && (
        <span className="ntx-status__item ntx-status__path">
          <Icon name="folder" size={11} strokeWidth={1.5} />
          <span className="ntx-status__value ntx-copyable" data-tip={active.cwd}>
            {shortPath(active.cwd, 3, paneHome(active))}
          </span>
        </span>
      )}

      {/* Cuánto lleva el comando del panel activo, en el acento de ESE panel —
          es el mismo pulso que respira en su tab, dicho en números. Va al final
          de la fila: su ancho cambia por segundo, y acá atrás el temblor se lo
          come el espacio libre en vez de correr a los vecinos. */}
      {running !== null && (
        <span className="ntx-status__item ntx-status__run" style={{ ['--tone' as string]: accent }}>
          <b>run</b>
          <span className="ntx-status__value">{running}</span>
        </span>
      )}

      {/* A la derecha, Machines, la ayuda, el about, el pulso y la hora.
          Antes había además una tira de versiones (utf-8 · ntx · electron ·
          chromium) que no se mira nunca: son datos de diagnóstico, no de uso, y
          competían por atención con lo que sí cambia mientras trabajás. El
          about vive acá abajo por lo mismo: es información de la app, y su
          lugar es el rincón de los datos quietos, no la titlebar. */}
      <span className="ntx-status__right">
        {onOpenMachines && (
          <button
            className="ntx-status__btn ntx-status__machines"
            data-sharing={sharing?.on ?? false}
            data-tip={
              sharing?.on
                ? `Machines · sharing${sharing.clients ? ` · ${sharing.clients} connected` : ''}`
                : 'Machines'
            }
            aria-label="Machines"
            onClick={onOpenMachines}
          >
            <Icon name="machine" size={12} strokeWidth={1.5} />
            {/* Esta máquina abierta a la red: un punto que no se apaga mientras
                dure. Con alguien conectado, late. */}
            <span className="ntx-status__share" data-live={(sharing?.clients ?? 0) > 0} />
          </button>
        )}
        {onOpenHelp && (
          <button
            className="ntx-status__btn"
            data-tip="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={onOpenHelp}
          >
            <Icon name="help" size={12} strokeWidth={1.5} />
          </button>
        )}
        <button className="ntx-status__btn" data-tip="About NTX" aria-label="About NTX" onClick={onOpenAbout}>
          <Icon name="info" size={12} strokeWidth={1.5} />
        </button>
        <span className="ntx-status__live" />
        {/* En el gris de los demás valores, como corresponde: estuvo en warn un
            tiempo y era decoración — la hora no es una alerta, y el amarillo
            tiene rol fijo. El color le llega heredado de la barra. */}
        <span className="ntx-status__value">{clock}</span>
      </span>
    </footer>
  )
}
