import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Titlebar } from './components/Titlebar'
import { TabStrip } from './components/TabStrip'
import { TerminalPane } from './components/TerminalPane'
import { StatusBar } from './components/StatusBar'
import { CommandPalette, type Command } from './components/CommandPalette'
import { AboutModal } from './components/AboutModal'
import { UpdateModal } from './components/UpdateModal'
import { TooltipLayer } from './components/TooltipLayer'
import { CrtLayer } from './components/CrtLayer'
import { MAX_PANES, formatDuration, setHomeDir, shortPath, type PaneState } from './lib/panes'
import { forgetPane, scrollbackOf } from './lib/ptyBus'
import { PALETTE, paneAccent } from './term/themes'
import type { ShellProfile, SystemStats, UpdateState } from '../../shared/types'

/** Lo mismo que --ntx-normal: el panel tiene que terminar de irse antes de desmontarse. */
const PANE_EXIT_MS = 220

/** Un comando que tardó menos que esto no merece aviso: lo viste terminar. */
const NOTIFY_MIN_MS = 6_000

/** Y uno que tarda menos que esto no merece marca de ocupado: cada Enter no
 *  puede hacer parpadear la tab. Más corto que el del aviso a propósito — la
 *  marca es para verla MIENTRAS corre, y a los 6s ya te la perdiste media. */
const BUSY_MIN_MS = 2_000

/** El tamaño de siempre; Ctrl 0 vuelve acá. */
const FONT_SIZE_DEFAULT = 12.5
/* Los topes del zoom: debajo de 8 no se lee y arriba de 24 entran 30 columnas. */
const FONT_SIZE_MIN = 8
const FONT_SIZE_MAX = 24
const FONT_SIZE_KEY = 'ntx:font-size'

function loadFontSize(): number {
  const stored = Number(window.localStorage.getItem(FONT_SIZE_KEY))
  return Number.isFinite(stored) && stored >= FONT_SIZE_MIN && stored <= FONT_SIZE_MAX
    ? stored
    : FONT_SIZE_DEFAULT
}

export function App(): JSX.Element {
  const [profiles, setProfiles] = useState<ShellProfile[]>([])
  const [panes, setPanes] = useState<PaneState[]>([])
  const [focused, setFocused] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // La búsqueda del scrollback: a qué panel pertenece la única barra abierta.
  // El nonce sube cuando se re-pide la que ya está abierta, para re-enfocarla.
  const [search, setSearch] = useState<{ paneId: string; nonce: number } | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [stats, setStats] = useState<SystemStats>({ cpu: 0, mem: 0 })
  const [update, setUpdate] = useState<UpdateState>({ phase: 'idle' })
  // La versión cuyo aviso ya se descartó: el modal insiste por versión nueva,
  // nunca dos veces por la misma.
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(loadFontSize)

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

  // Qué panel tiene algo corriendo desde cuándo (OSC 133). Va en ref: cada
  // marca del shell no puede costar un render.
  const commandStart = useRef(new Map<string, number>())

  // Los timers que encienden la marca de ocupado pasado BUSY_MIN_MS. Sólo un
  // comando que sobrevive el umbral toca el estado — así el render se paga
  // únicamente cuando hay algo que mostrar.
  const busyTimer = useRef(new Map<string, number>())

  /** Apaga la marca de ocupado de un panel: el timer pendiente si no llegó a
   *  disparar, y el busySince si llegó. El setPanes devuelve el MISMO array
   *  cuando no había nada encendido, para que React ni parpadee. */
  const clearBusy = useCallback((paneId: string): void => {
    const timer = busyTimer.current.get(paneId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      busyTimer.current.delete(paneId)
    }
    setPanes((previous) =>
      previous.some((pane) => pane.id === paneId && pane.busySince !== null)
        ? previous.map((pane) => (pane.id === paneId ? { ...pane, busySince: null } : pane))
        : previous
    )
  }, [])

  // --- Zoom -----------------------------------------------------------------

  const zoom = useCallback((delta: number): void => {
    setFontSize((current) => Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, current + delta)))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(FONT_SIZE_KEY, String(fontSize))
  }, [fontSize])

  // Ctrl+rueda, como en el navegador. En captura y frenando el evento: si
  // llegara hasta xterm, el gesto además scrollearía el scrollback.
  useEffect(() => {
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()
      event.stopPropagation()
      zoom(event.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [zoom])

  // Un archivo soltado FUERA de un panel (titlebar, gaps del grid) caería en el
  // default de Chromium: navegar la ventana al file:// y llevarse la app
  // puesta. Se traga acá, una sola vez; los panes manejan su drop antes de que
  // esto llegue a opinar.
  useEffect(() => {
    const swallow = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  // Abrir el About descarta el aviso pendiente: ahí adentro ya se ve el estado
  // y el botón de reiniciar, mostrarlo dos veces sería perseguir.
  const openAbout = useCallback((): void => {
    setAboutOpen(true)
    const current = updateRef.current
    if (current.phase === 'ready' && current.version) setDismissedUpdate(current.version)
  }, [])

  // --- Búsqueda en el scrollback ---------------------------------------------

  const openSearch = useCallback((): void => {
    const pane = panesRef.current[focusedRef.current]
    if (!pane || pane.closing) return
    // Pedirla sobre el mismo panel no la duplica: sube el nonce y la barra
    // re-enfoca su input. Pedirla desde otro panel se la lleva ahí.
    setSearch((previous) => ({ paneId: pane.id, nonce: (previous?.nonce ?? 0) + 1 }))
  }, [])

  const closeSearch = useCallback((): void => setSearch(null), [])

  // --- Paneles --------------------------------------------------------------

  /** El salto circular entre shells: del último vuelve al primero y al revés.
   *  Salta por encima de los paneles que se están yendo — viven 220 ms más que
   *  su cierre, y aterrizar en uno sería enfocar un fantasma. */
  const cycleFocus = useCallback((step: number): void => {
    const current = panesRef.current
    if (current.length === 0) return
    let index = focusedRef.current
    for (let attempt = 0; attempt < current.length; attempt++) {
      index = (index + step + current.length) % current.length
      if (!current[index]?.closing) break
    }
    setFocused(index)
  }, [])

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
          closing: false,
          notify: false,
          busySince: null
        }
      ]
    })
  }, [])

  const closePane = useCallback((paneId: string): void => {
    // Matamos el shell ya, pero el panel se va con su animación: sacarlo del DOM
    // en el mismo frame se siente como un crash, no como un cierre.
    window.ntx.kill(paneId)
    // Si la búsqueda vivía en este panel, se va con él. Y su comando en vuelo
    // ya no le debe aviso ni marca de ocupado a nadie.
    setSearch((previous) => (previous?.paneId === paneId ? null : previous))
    commandStart.current.delete(paneId)
    clearBusy(paneId)
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
  }, [clearBusy])

  // Arranque: detectamos shells y remontamos la escena del arranque anterior —
  // mismos paneles, mismos perfiles, mismas carpetas. El contenido no vuelve
  // (esos procesos ya no existen), pero el grid sí. Sin escena guardada se abre
  // una sola shell: el grid crece cuando el usuario quiere, no de prepo.
  //
  // El guard NO es paranoia: en desarrollo StrictMode monta, desmonta y vuelve a
  // montar para exponer efectos sin cleanup, y sin esto arrancabas con dos
  // shells. Un pty no es un suscriptor que se pueda deshacer y rehacer gratis —
  // del otro lado hay un proceso de verdad.
  const booted = useRef(false)
  // Recién cuando la escena terminó de montarse se permite guardar: si no, el
  // estado vacío del primer render pisaría lo guardado antes de restaurarlo.
  const restored = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true

    setHomeDir(window.ntx.platform.home)
    void Promise.all([window.ntx.profiles(), window.ntx.session.load()]).then(
      async ([available, saved]) => {
        setProfiles(available)
        if (!available[0]) return

        // Un perfil guardado que ya no está instalado cae al default: vuelve la
        // FORMA del grid completa, que es lo que uno recuerda de su sesión.
        const scene = (saved?.panes ?? []).slice(0, MAX_PANES).map((pane) => ({
          profileId: available.some((profile) => profile.id === pane.profileId)
            ? pane.profileId
            : available[0]!.id,
          cwd: pane.cwd
        }))

        if (scene.length === 0) {
          await spawn(available[0].id)
        } else {
          // En serie a propósito: el acento y el número de cada panel salen de
          // su posición, y spawns en paralelo llegarían en cualquier orden.
          for (const pane of scene) await spawn(pane.profileId, pane.cwd)
          // Un tick de respiro antes de aplicar el foco guardado: cada spawn
          // enfoca su panel DESDE ADENTRO del updater de setPanes, así que ese
          // setFocused se encola después de cualquiera hecho acá en línea — y
          // el del último spawn pisaría a éste.
          await new Promise((resolve) => setTimeout(resolve, 0))
          setFocused(Math.max(0, Math.min(saved?.focused ?? 0, scene.length - 1)))
        }
        restored.current = true
      }
    )
  }, [spawn])

  // La escena se guarda sola en cada cambio — paneles, carpetas, foco — con un
  // debounce corto: un `cd` no merece más de una escritura.
  useEffect(() => {
    if (!restored.current) return
    const timer = window.setTimeout(() => {
      window.ntx.session.save({
        panes: panes
          .filter((pane) => !pane.closing)
          .map((pane) => ({ profileId: pane.profileId, cwd: pane.cwd })),
        focused
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [panes, focused])

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
      // La shell murió: lo que estuviera corriendo murió con ella, así que la
      // marca de ocupado no puede quedar contando sobre un panel muerto.
      commandStart.current.delete(paneId)
      clearBusy(paneId)
      // Salida limpia (un `exit` del usuario) = cerramos el panel. Salida con
      // error = lo dejamos abierto, porque el motivo está escrito ahí adentro y
      // cerrarlo se lo lleva puesto.
      if (code === 0) closePane(paneId)
    },
    [closePane, clearBusy]
  )

  // --- Aviso de comando terminado ---------------------------------------------

  const onPaneCommand = useCallback((paneId: string, running: boolean, exitCode: number): void => {
    const starts = commandStart.current
    if (running) {
      starts.set(paneId, Date.now())
      // La marca de ocupado espera su umbral ANTES de tocar el estado: un
      // comando instantáneo entra y sale de este handler sin costar un render.
      // El timer relee el arranque al disparar — si para entonces llegó el D,
      // el mapa ya no lo tiene y no hay nada que encender.
      const pending = busyTimer.current.get(paneId)
      if (pending !== undefined) window.clearTimeout(pending)
      busyTimer.current.set(
        paneId,
        window.setTimeout(() => {
          busyTimer.current.delete(paneId)
          const since = starts.get(paneId)
          if (since === undefined) return
          setPanes((previous) =>
            previous.map((pane) => (pane.id === paneId ? { ...pane, busySince: since } : pane))
          )
        }, BUSY_MIN_MS)
      )
      return
    }

    clearBusy(paneId)

    const startedAt = starts.get(paneId)
    // Un D sin C es el prompt respirando (arranque, Enter en vacío): no corre nada.
    if (startedAt === undefined) return
    starts.delete(paneId)

    const elapsed = Date.now() - startedAt
    if (elapsed < NOTIFY_MIN_MS) return

    const panes = panesRef.current
    const index = panes.findIndex((pane) => pane.id === paneId)
    if (index === -1) return
    const pane = panes[index]!

    // Si lo estabas mirando —ese panel, con la ventana al frente— no hay nada
    // que avisar: lo viste terminar.
    const attended = document.visibilityState === 'visible' && document.hasFocus()
    if (attended && index === focusedRef.current) return

    // La tab late con su acento hasta que el panel reciba foco.
    setPanes((previous) =>
      previous.map((p) => (p.id === paneId ? { ...p, notify: true } : p))
    )

    // Y si la ventana entera está oculta o detrás de otra, un toast de Windows.
    // Silencioso: es una terminal avisando, no un chat reclamando.
    if (!attended) {
      const notification = new Notification(`${pane.profileLabel} — command finished`, {
        body: `${formatDuration(elapsed)} · exit ${exitCode} · ${shortPath(pane.cwd, 2)}`,
        silent: true
      })
      notification.onclick = () => {
        window.ntx.window.attention()
        const current = panesRef.current.findIndex((p) => p.id === paneId)
        if (current !== -1) setFocused(current)
      }
    }
  }, [clearBusy])

  // El latido se apaga cuando el panel por fin recibe la mirada: foco de panel,
  // o la ventana volviendo al frente con ese panel ya enfocado.
  useEffect(() => {
    const clearNotify = (): void => {
      const pane = panesRef.current[focusedRef.current]
      if (!pane?.notify) return
      setPanes((previous) =>
        previous.map((p) => (p.id === pane.id ? { ...p, notify: false } : p))
      )
    }
    clearNotify()
    window.addEventListener('focus', clearNotify)
    return () => window.removeEventListener('focus', clearNotify)
  }, [focused])

  // --- Atajos ----------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()

      // Con un modal abierto no sobrevive ninguno: su teclado es Escape y sus
      // botones, y abrir la paleta ENCIMA de una pregunta pendiente la taparía.
      if (modalOpenRef.current) return

      // Con la paleta abierta no sobrevive ninguno: su teclado (flechas, enter,
      // escape) lo maneja ella, y mover paneles por detrás de un overlay
      // abierto sería peor que no hacer nada.
      if (paletteOpenRef.current) return

      // El zoom va antes del bloque de Shift: según el layout, el «+» sale con
      // Shift (US: Shift+=) o sin él, y acá los dos caminos valen lo mismo.
      if (key === '+' || key === '=') {
        event.preventDefault()
        zoom(1)
        return
      }
      if (key === '-' || key === '_') {
        event.preventDefault()
        zoom(-1)
        return
      }
      if (key === '0') {
        event.preventDefault()
        setFontSize(FONT_SIZE_DEFAULT)
        return
      }

      // Ctrl+Tab avanza y Ctrl+Shift+Tab vuelve, como en cualquier navegador.
      // Va ANTES del bloque de Shift porque la vuelta atrás lo lleva puesto, y
      // ahí adentro no habría cómo distinguirla.
      //
      // El TAB pelado no se toca a propósito: es el autocompletado del shell
      // (PSReadLine, bash) y quedárselo sería romperlo en las cuatro.
      //
      // Y acá sí hace falta cortar la propagación además de prevenir: xterm
      // mira el keyCode del Tab sin importarle el Ctrl, así que el evento
      // llegando a la terminal escribiría un tabulador (o un ESC[Z con Shift)
      // en el prompt. Capturamos en window, así que cortando acá nunca baja.
      if (key === 'tab') {
        event.preventDefault()
        event.stopPropagation()
        cycleFocus(event.shiftKey ? -1 : 1)
        return
      }

      // Los combos de la app van con Shift: los pelados son del shell (Ctrl+T
      // y Ctrl+W son de PSReadLine, Ctrl+K es kill-line en media terminal).
      //
      // La paleta no tiene atajo A PROPÓSITO, y la historia lo justifica: tuvo
      // Ctrl+K (kill-line, pisaba nano y al propio prompt), después
      // Ctrl+Shift+K con cesión heurística a TUIs (falló para los dos lados), y
      // al final resultó que Windows se comía el combo con los modificadores
      // izquierdos si el sistema los tiene de hotkey de idioma. Es un menú: se
      // abre con su botón, siempre, desde cualquier estado del teclado.
      if (event.shiftKey) {
        if (key === 't') {
          event.preventDefault()
          void spawn()
        } else if (key === 'w') {
          event.preventDefault()
          const pane = panesRef.current[focusedRef.current]
          if (pane) closePane(pane.id)
        } else if (key === 'f') {
          event.preventDefault()
          openSearch()
        }
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
  }, [spawn, closePane, zoom, openSearch, cycleFocus])

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
        hint: full ? 'Full' : undefined,
        run: () => {
          if (!full) void spawn(profile.id)
        }
      })
    }

    if (activePane) {
      // Duplicar = mismo perfil Y misma carpeta, dicho explícito. spawn() pelado
      // hoy hereda las dos cosas del panel enfocado, pero este comando no
      // depende de ese default: pasa los argumentos porque ése es su contrato.
      list.push({
        id: 'duplicate',
        label: `Duplicate shell · ${activePane.profileLabel}`,
        icon: 'duplicate',
        desc: full
          ? `The grid already holds ${MAX_PANES} shells`
          : `Same profile, standing in ${shortPath(activePane.cwd, 2) || 'its folder'}`,
        hint: full ? 'Full' : undefined,
        run: () => {
          if (!full) void spawn(activePane.profileId, activePane.cwd)
        }
      })
      list.push({
        id: 'find',
        label: 'Find in scrollback',
        icon: 'search',
        desc: `Searches what the ${activePane.profileLabel} pane has printed`,
        hint: 'Ctrl Shift F',
        run: openSearch
      })
      // El scrollback se lleva: al portapapeles o a un archivo. Los dos leen el
      // buffer recién al ejecutarse (scrollbackOf), nunca al armar la lista.
      list.push({
        id: 'copy-scrollback',
        label: 'Copy scrollback',
        icon: 'clipboard',
        desc: `Everything the ${activePane.profileLabel} pane has printed, to the clipboard`,
        run: () => {
          const text = scrollbackOf(activePane.id)
          if (text) void navigator.clipboard.writeText(text)
        }
      })
      list.push({
        id: 'save-scrollback',
        label: 'Save scrollback to a file',
        icon: 'download',
        desc: 'Plain text, wherever you choose',
        run: () => {
          const text = scrollbackOf(activePane.id)
          if (!text) return
          const now = new Date()
          const pad = (value: number): string => String(value).padStart(2, '0')
          const stamp =
            `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
            `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
          void window.ntx.saveText(`ntx-${activePane.profileId}-${stamp}.txt`, text)
        }
      })
      list.push({
        id: 'close',
        label: 'Close the active shell',
        icon: 'close',
        desc: `Ends the ${activePane.profileLabel} process`,
        hint: 'Ctrl Shift W',
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
        hint: `Ctrl ${index + 1}`,
        run: () => setFocused(index)
      })
    })

    // Sólo aparece cuando hay algo que resetear: en reposo sería ruido.
    if (fontSize !== FONT_SIZE_DEFAULT) {
      list.push({
        id: 'zoom-reset',
        label: `Reset zoom · now at ${fontSize}px`,
        icon: 'search',
        desc: 'Back to 12.5px — Ctrl +/− and Ctrl+wheel zoom',
        hint: 'Ctrl 0',
        run: () => setFontSize(FONT_SIZE_DEFAULT)
      })
    }

    list.push({
      id: 'about',
      label: 'About NTX',
      icon: 'info',
      desc: 'Version, updates and the repo',
      run: openAbout
    })

    return list
  }, [profiles, panes, focused, palette, spawn, closePane, openAbout, openSearch, fontSize])

  // --- Render ----------------------------------------------------------------

  return (
    <div className="ntx-app">
      {/* El sustrato: grano y cuadrícula. Va primero y no recibe eventos — es el
          fondo mismo, no una capa de efecto. La capa de efecto existe pero vive
          en la otra punta del árbol: el vidrio CRT, que mira todo desde
          adelante. Desde que las superficies son opacas el sustrato sólo asoma
          por los gaps del grid. */}
      <div className="ntx-bg" aria-hidden="true" />

      <Titlebar onOpenPalette={() => setPaletteOpen(true)} />

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
            fontSize={fontSize}
            focused={index === focused}
            // La búsqueda abierta también apaga el teclado de la terminal: el
            // que tipea ahí es el input de la barra. Cerrarla lo devuelve.
            keyboardFocus={
              index === focused &&
              !paletteOpen &&
              !aboutOpen &&
              !updatePromptOpen &&
              search?.paneId !== pane.id
            }
            searchOpen={search?.paneId === pane.id}
            searchNonce={search?.nonce ?? 0}
            onSearchClose={closeSearch}
            onFocus={() => setFocused(index)}
            onExit={(code) => onPaneExit(pane.id, code)}
            onCwd={(cwd) => onPaneCwd(pane.id, cwd)}
            onCommand={(running, exitCode) => onPaneCommand(pane.id, running, exitCode)}
          />
        ))}
      </main>

      <StatusBar
        stats={stats}
        active={panes[focused]}
        accent={accentOf(focused)}
        palette={palette}
        onOpenAbout={openAbout}
      />

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

      {/* El vidrio CRT cierra el árbol: scanlines POR DELANTE de todo — scrim,
          paleta, modales y tooltips incluidos. El efecto es del monitor, no de
          la escena; por eso es UNA capa acá y no un ajuste por overlay. */}
      <CrtLayer />
    </div>
  )
}
