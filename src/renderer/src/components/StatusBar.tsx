import { useEffect, useState, type JSX } from 'react'
import { Icon } from './Icon'
import { shortPath, type PaneState } from '../lib/panes'
import type { Palette } from '../term/themes'
import type { SystemStats } from '../../../shared/types'

interface StatusBarProps {
  stats: SystemStats
  active: PaneState | undefined
  palette: Palette
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

export function StatusBar({ stats, active, palette }: StatusBarProps): JSX.Element {
  const clock = useClock()

  return (
    <footer className="ntx-status ntx-chrome">
      <span className="ntx-status__item" style={{ ['--tone' as string]: palette.accent }}>
        <b>cpu</b>
        <span className="ntx-status__value">{stats.cpu}%</span>
      </span>

      <span className="ntx-status__item" style={{ ['--tone' as string]: palette.alt }}>
        <b>mem</b>
        <span className="ntx-status__value">{stats.mem}%</span>
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
            {shortPath(active.cwd)}
          </span>
        </span>
      )}

      {/* A la derecha, sólo el pulso y la hora.
          Antes había además una tira de versiones (utf-8 · ntx · electron ·
          chromium) que no se mira nunca: son datos de diagnóstico, no de uso, y
          competían por atención con lo que sí cambia mientras trabajás. */}
      <span className="ntx-status__right">
        <span className="ntx-status__live" />
        <span className="ntx-status__value" style={{ color: palette.warn }}>
          {clock}
        </span>
      </span>
    </footer>
  )
}
