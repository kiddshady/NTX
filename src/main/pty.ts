import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { ShellProfile } from '../shared/types.js'

interface Pane {
  id: string
  profile: ShellProfile
  proc: IPty
  cwd: string
}

interface PtyEvents {
  onData(paneId: string, data: string): void
  onExit(paneId: string, code: number): void
}

export class PtyManager {
  private panes = new Map<string, Pane>()

  constructor(private events: PtyEvents) {}

  spawn(
    profile: ShellProfile,
    cwd: string | undefined,
    cols: number,
    rows: number,
    accent?: string
  ): Pane {
    const id = randomUUID()
    const startDir = cwd && existsSync(cwd) ? cwd : homedir()

    const proc = pty.spawn(profile.exec, profile.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: startDir,
      env: {
        ...process.env,
        // El shell lee de acá la ruta de su init. Va por env y no inline en los
        // args para que una ruta con espacios no rompa el parseo del -Command.
        ...(profile.initFile ? { NTX_INIT: profile.initFile } : {}),
        // El acento del panel. Lo lee el prompt para que sus esquinas hagan juego
        // con el borde del panel que lo contiene. Se fija al arrancar la shell:
        // si después cambiás de tema, el prompt de las shells YA abiertas se
        // queda con el color viejo hasta que las vuelvas a abrir.
        ...(accent ? { NTX_ACCENT: accent } : {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        NTX: '1'
      } as Record<string, string>,
      // ConPTY: el backend moderno de Windows. Sin esto node-pty cae a winpty,
      // que no soporta secuencias VT completas.
      useConpty: true
    })

    const pane: Pane = { id, profile, proc, cwd: startDir }
    this.panes.set(id, pane)

    proc.onData((data) => this.events.onData(id, data))
    proc.onExit(({ exitCode }) => {
      this.panes.delete(id)
      this.events.onExit(id, exitCode)
    })

    return pane
  }

  write(id: string, data: string): void {
    this.panes.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const pane = this.panes.get(id)
    if (!pane) return
    // Un resize a 0 tira ConPTY abajo, y pasa de verdad: el pane arranca con el
    // contenedor todavía sin medir.
    if (cols < 1 || rows < 1) return
    try {
      pane.proc.resize(cols, rows)
    } catch {
      // El proceso puede haber muerto entre el render y este resize.
    }
  }

  setCwd(id: string, cwd: string): void {
    const pane = this.panes.get(id)
    if (pane) pane.cwd = cwd
  }

  cwdOf(id: string): string | undefined {
    return this.panes.get(id)?.cwd
  }

  kill(id: string): void {
    const pane = this.panes.get(id)
    if (!pane) return
    this.panes.delete(id)
    try {
      pane.proc.kill()
    } catch {
      // Ya estaba muerto.
    }
  }

  killAll(): void {
    for (const id of [...this.panes.keys()]) this.kill(id)
  }
}
