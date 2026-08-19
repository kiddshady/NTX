import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Titlebar } from './components/Titlebar'
import { TabStrip } from './components/TabStrip'
import { TerminalPane } from './components/TerminalPane'
import { StatusBar } from './components/StatusBar'
import { CommandPalette, type Command } from './components/CommandPalette'
import { AboutModal } from './components/AboutModal'
import { UpdateModal } from './components/UpdateModal'
import { TooltipLayer } from './components/TooltipLayer'
import { MAX_PANES, setHomeDir, type PaneState } from './lib/panes'
import { forgetPane } from './lib/ptyBus'
import { PALETTE, paneAccent } from './term/themes'
import type { ShellProfile, SystemStats, UpdateState } from '../../shared/types'

/** Lo mismo que --ntx-normal: el panel tiene que terminar de irse antes de desmontarse. */
const PANE_EXIT_MS = 220

export function App(): JSX.Element {
  const [profiles, setProfiles] = useState<ShellProfile[]>([])
  const [panes, setPanes] = useState<PaneState[]>([])
  const [focused, setFocused] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [stats, setStats] = useState<SystemStats>({ cpu: 0, mem: 0 })
  const [update, setUpdate] = useState<UpdateState>({ phase: 'idle' })
  // La versión cuyo aviso ya se descartó: el modal insiste por versión nueva,
  // nunca dos veces por la misma.
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)

  const palette = PALETTE
  const accentOf = useCallback((index: number) => paneAccent(palette, index), [palette])

  // El aviso salta solo cuando la descarga terminó, y se calla si el About ya
  // está mostrando lo mismo.
  const updatePromptOpen =
    update.phase === 'ready' &&
    update.version != null &&
    update.version !== dismissedUpdate &&
    !aboutOpen

  // Espejos para los handlers de teclado, que se registran una sola vez y no
  // pueden depender del estado sin volver a suscribirse en cada tecla.
  const panesRef = useRef(panes)
  panesRef.current = panes
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const paletteOpenRef = useRef(paletteOpen)
  paletteOpenRef.current = paletteOpen
  const modalOpenRef = useRef(false)
  modalOpenRef.current = aboutOpen || updatePromptOpen
  const updateRef = useRef(update)
  updateRef.current = update

  // Abrir el About descarta el aviso pendiente: ahí adentro ya se ve el estado
  // y el botón de reiniciar, mostrarlo dos veces sería perseguir.
  const openAbout = useCallback((): void => {
    setAboutOpen(true)
    const current = updateRef.current
    if (current.phase === 'ready' && current.version) setDismissedUpdate(current.version)
  }, [])

  // --- Paneles --------------------------------------------------------------

  const spawn = useCallback(async (profileId?: string, cwd?: string): Promise<void> => {
    const current = panesRef.current
    if (current.length >= MAX_PANES) return

    const targetProfile = profileId ?? current[focusedRef.current]?.profileId
    // El tamaño real lo pone el primer fit del panel; con esto el shell arranca
    // con algo razonable en vez de 0×0, que tira ConPTY abajo.
    const snapshot = await window.ntx.spawn({
      profileId: targetProfile ?? '',
      cwd: cwd ?? current[focusedRef.current]?.cwd,
      cols: 80,
      rows: 24,
      accent: paneAccent(PALETTE, current.length)
    })

    setPanes((previous) => {
      if (previous.length >= MAX_PANES) {
        window.ntx.kill(snapshot.id)
        return previous
      }
      setFocused(previous.length)
      return [
        ...previous,
        {
          id: snapshot.id,
          profileId: snapshot.profileId,
          profileLabel: snapshot.title,
          cwd: snapshot.cwd,
          branch: snapshot.branch,
          pid: snapshot.pid,
          closing: false
        }
      ]
    })
  }, [])

  const closePane = useCallback((paneId: string): void => {
    // Matamos el shell ya, pero el panel se va con su animación: sacarlo del DOM
    // en el mismo frame se siente como un crash, no como un cierre.
    window.ntx.kill(paneId)
    setPanes((previous) =>
      previous.map((pane) => (pane.id === paneId ? { ...pane, closing: true } : pane))
    )

    window.setTimeout(() => {
      forgetPane(paneId)
      setPanes((previous) => {
        const next = previous.filter((pane) => pane.id !== paneId)
        setFocused((current) => Math.max(0, Math.min(current, next.length - 1)))
        return next
      })
    }, PANE_EXIT_MS)
  }, [])

  // Arranque: detectamos shells y abrimos una sola. El grid crece cuando el
  // usuario quiere, no de prepo.
  //
  // El guard NO es paranoia: en desarrollo StrictMode monta, desmonta y vuelve a
  // montar para exponer efectos sin cleanup, y sin esto arrancabas con dos
  // shells. Un pty no es un suscriptor que se pueda deshacer y rehacer gratis —
  // del otro lado hay un proceso de verdad.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true

    setHomeDir(window.ntx.platform.home)
    void window.ntx.profiles().then((available) => {
      setProfiles(available)
      if (available[0]) void spawn(available[0].id)
    })
  }, [spawn])

  // --- Eventos del main ------------------------------------------------------

  useEffect(() => window.ntx.onStats(setStats), [])

  useEffect(() => window.ntx.updates.onState(setUpdate), [])

  useEffect(
    () =>
      window.ntx.onCwd((paneId, cwd, branch) =>
        setPanes((previous) =>
          previous.map((pane) => (pane.id === paneId ? { ...pane, cwd, branch } : pane))
        )
      ),
    []
  )

  const onPaneCwd = useCallback((paneId: string, cwd: string): void => {
    // El branch lo resuelve el main (es quien puede lanzar `git`) y vuelve por
    // el evento de arriba.
    window.ntx.reportCwd(paneId, cwd)
    setPanes((previous) =>
      previous.map((pane) => (pane.id === paneId ? { ...pane, cwd } : pane))
    )
  }, [])

  const onPaneExit = useCallback(
    (paneId: string, code: number): void => {
      // Salida limpia (un `exit` del usuario) = cerramos el panel. Salida con
      // error = lo dejamos abierto, porque el motivo está escrito ahí adentro y
      // cerrarlo se lo lleva puesto.
      if (code === 0) closePane(paneId)
    },
    [closePane]
  )

  // --- Atajos ----------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()

      // Con un modal abierto no sobrevive ninguno: su teclado es Escape y sus
      // botones, y abrir la paleta ENCIMA de una pregunta pendiente la taparía.
      if (modalOpenRef.current) return

      // Con la paleta abierta sólo sobrevive el toggle: el resto de los atajos
      // los maneja ella (flechas, enter, escape) y pisárselos desde acá sería
      // mover paneles por detrás de un overlay abierto.
      if (paletteOpenRef.current && key !== 'k') return

      // Los combos con Shift son los que pisarían algo del shell (Ctrl+T y Ctrl+W
      // están tomados por PSReadLine), así que van con Shift y el shell se queda
      // con los suyos.
      if (event.shiftKey) {
        if (key === 't') {
          event.preventDefault()
          void spawn()
        } else if (key === 'w') {
          event.preventDefault()
          const pane = panesRef.current[focusedRef.current]
          if (pane) closePane(pane.id)
        }
        return
      }

      if (key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      if (key >= '1' && key <= '4') {
        const index = Number(key) - 1
        if (index < panesRef.current.length) {
          event.preventDefault()
          setFocused(index)
        }
      }
    }

    // Fase de captura: xterm escucha en su propio textarea, y sin capturar acá
    // se comería los atajos antes de que lleguen.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [spawn, closePane])

  // --- Comandos --------------------------------------------------------------

  const commands = useMemo<Command[]>(() => {
    const full = panes.length >= MAX_PANES
    const activePane = panes[focused]
    const list: Command[] = []

    for (const profile of profiles) {
      list.push({
        id: `new:${profile.id}`,
        label: `New shell · ${profile.label}`,
        // Todas las shells con el mismo símbolo: lo que las distingue es el
        // nombre, y un ícono distinto para una sola sugiere una diferencia de
        // categoría que no existe — abrir WSL es abrir una shell, como el resto.
        icon: 'shell',
        desc: full ? `The grid already holds ${MAX_PANES} shells` : `Opens a pane running ${profile.label}`,
        hint: full ? 'full' : undefined,
        run: () => {
          if (!full) void spawn(profile.id)
        }
      })
    }

    if (activePane) {
      list.push({
        id: 'close',
        label: 'Close the active shell',
        icon: 'close',
        desc: `Ends the ${activePane.profileLabel} process`,
        hint: 'ctrl shift w',
        run: () => closePane(activePane.id)
      })
    }

    panes.forEach((pane, index) => {
      if (index === focused) return
      list.push({
        id: `focus:${pane.id}`,
        label: `Go to shell ${index + 1} · ${pane.profileLabel}`,
        icon: 'caret',
        desc: pane.cwd ?? 'Moves focus to that pane',
        hint: `ctrl ${index + 1}`,
        run: () => setFocused(index)
      })
    })

    list.push({
      id: 'about',
      label: 'About NTX',
      icon: 'info',
      desc: 'Version, updates and the repo',
      run: openAbout
    })

    return list
  }, [profiles, panes, focused, palette, spawn, closePane, openAbout])

  // --- Render ----------------------------------------------------------------

  return (
    <div className="ntx-app">
      {/* El sustrato que el vidrio difumina. Va primero y no recibe eventos: no
          es una capa de efecto por encima como era el CRT, es el fondo mismo. */}
      <div className="ntx-bg" aria-hidden="true" />

      <Titlebar onOpenPalette={() => setPaletteOpen(true)} onOpenAbout={openAbout} />

      <TabStrip
        panes={panes}
        focusedIndex={focused}
        accentOf={accentOf}
        onFocus={setFocused}
        onClose={closePane}
        onNew={() => void spawn()}
      />

      <main className="ntx-grid" data-count={panes.length}>
        {panes.map((pane, index) => (
          <TerminalPane
            key={pane.id}
            pane={pane}
            index={index}
            accent={accentOf(index)}
            palette={palette}
            focused={index === focused}
            keyboardFocus={index === focused && !paletteOpen && !aboutOpen && !updatePromptOpen}
            onFocus={() => setFocused(index)}
            onExit={(code) => onPaneExit(pane.id, code)}
            onCwd={(cwd) => onPaneCwd(pane.id, cwd)}
          />
        ))}
      </main>

      <StatusBar stats={stats} active={panes[focused]} palette={palette} />

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />

      <AboutModal open={aboutOpen} update={update} onClose={() => setAboutOpen(false)} />

      <UpdateModal
        open={updatePromptOpen}
        version={update.version}
        onInstall={() => window.ntx.updates.install()}
        onLater={() => setDismissedUpdate(update.version ?? null)}
      />

      <TooltipLayer />
    </div>
  )
}
