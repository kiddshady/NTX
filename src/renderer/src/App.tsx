import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type JSX } from 'react'
import { Titlebar } from './components/Titlebar'
import { TabStrip } from './components/TabStrip'
import { TerminalPane } from './components/TerminalPane'
import { StatusBar } from './components/StatusBar'
import { CommandPalette, type Command } from './components/CommandPalette'
import { AboutModal } from './components/AboutModal'
import { UpdateModal } from './components/UpdateModal'
import { TooltipLayer } from './components/TooltipLayer'
import { CrtLayer } from './components/CrtLayer'
import { MachinesModal } from './components/MachinesModal'
import { HelpModal } from './components/HelpModal'
import { MAX_PANES, formatDuration, otherMachinePwsh, paneHome, setHomeDir, shortPath, thisMachineShell, type PaneState } from './lib/panes'
import { forgetPane } from './lib/ptyBus'
import { reducedMotion } from './lib/motion'
import { PALETTE, paneAccent } from './term/themes'
import { loadTerminalFont, saveTerminalFont } from './term/fonts'
import type { ShellProfile, SystemStats, UpdateState } from '../../shared/types'
import type { HostState, PeerState } from '../../shared/remote'

/** La salida del panel (160 ms en base.css) y un respiro: tiene que terminar de
 *  irse antes de desmontarse. */
const PANE_EXIT_MS = 180

/** El reacomodo del grid cuando entra o sale una shell (--ntx-slow). */
const GRID_MS = 280
const GRID_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

type Box = { left: number; top: number; width: number; height: number }

/**
 * El grid se reacomoda viajando, no saltando.
 *
 * Cuando entra o sale una shell cambia la forma del grid y los paneles que ya
 * estaban cambian de lugar y de tamaño de un cuadro al otro. Acá se anima ese
 * cambio con FLIP: se recuerda la caja de cada panel, y cuando cambia se lo
 * dibuja con un transform que lo deja donde estaba y se lo suelta hacia su
 * lugar nuevo. El contenido no puede viajar escalado (la letra se estiraría al
 * doble): se apaga mientras el marco viaja y vuelve ya en su tamaño, que de
 * paso tapa el re-fit de xterm.
 *
 * El que se cierra sale del flujo en el acto, clavado en su caja: los demás
 * ocupan su lugar MIENTRAS él se funde encima, en vez de esperar a que termine.
 */
function useGridFlip(grid: React.RefObject<HTMLElement | null>, panes: PaneState[], layout: Layout): void {
  const boxes = useRef(new Map<string, Box>())

  const measure = (element: HTMLElement): Box => ({
    left: element.offsetLeft,
    top: element.offsetTop,
    width: element.offsetWidth,
    height: element.offsetHeight
  })

  useLayoutEffect(() => {
    const container = grid.current
    if (!container) return
    const seen = new Set<string>()
    const elements = [...container.querySelectorAll<HTMLElement>(':scope > .ntx-pane')]

    // Primero, los que se van salen del flujo, en la caja que tenían. Tiene que
    // ser ANTES de medir a los demás: con uno de más en el flujo, el grid de
    // tres se armaba con una fila de más y los otros se medían en cualquier
    // lado (y viajaban dos veces, una al cerrar y otra al desmontar).
    for (const element of elements) {
      const id = element.dataset.pane
      if (!id || element.dataset.closing !== 'true') continue
      seen.add(id)
      const before = boxes.current.get(id)
      if (before && element.style.position !== 'absolute') {
        Object.assign(element.style, {
          position: 'absolute',
          left: `${before.left}px`,
          top: `${before.top}px`,
          width: `${before.width}px`,
          height: `${before.height}px`,
          zIndex: '1'
        })
      }
    }

    for (const element of elements) {
      const id = element.dataset.pane
      if (!id || element.dataset.closing === 'true') continue
      seen.add(id)
      const before = boxes.current.get(id)
      const now = measure(element)
      boxes.current.set(id, now)
      if (!before) continue
      const moved =
        Math.abs(before.left - now.left) > 0.5 ||
        Math.abs(before.top - now.top) > 0.5 ||
        Math.abs(before.width - now.width) > 0.5 ||
        Math.abs(before.height - now.height) > 0.5
      if (!moved || reducedMotion()) continue

      const scaleX = before.width / now.width
      const scaleY = before.height / now.height
      element.animate(
        [
          {
            transformOrigin: '0 0',
            transform: `translate(${before.left - now.left}px, ${before.top - now.top}px) scale(${scaleX}, ${scaleY})`
          },
          { transformOrigin: '0 0', transform: 'none' }
        ],
        { duration: GRID_MS, easing: GRID_EASE }
      )
      for (const child of element.children) {
        if (!(child instanceof HTMLElement) || child.classList.contains('ntx-search')) continue
        child.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], {
          duration: GRID_MS,
          easing: 'linear'
        })
      }
    }
    for (const id of boxes.current.keys()) if (!seen.has(id)) boxes.current.delete(id)
  }, [grid, panes, layout])

  // Si la ventana cambia de tamaño las cajas cambian sin que cambien los
  // paneles: se re-miden sin animar, o el próximo reacomodo saldría de cajas
  // que ya no existen.
  useEffect(() => {
    const container = grid.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      for (const element of container.querySelectorAll<HTMLElement>(':scope > .ntx-pane')) {
        const id = element.dataset.pane
        if (id && element.dataset.closing !== 'true') boxes.current.set(id, measure(element))
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [grid])
}

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

/* El vidrio CRT prendido o apagado (Ctrl Shift S). Prendido es lo de siempre:
   sólo un '0' guardado lo apaga. */
const CRT_KEY = 'ntx:crt'

function loadCrt(): boolean {
  return window.localStorage.getItem(CRT_KEY) !== '0'
}

/* Cómo se muestran las shells (Ctrl Shift G): de a una, en pestañas, o todas a
   la vista en el grid. Pestañas es lo de siempre desde la 1.1.0: sólo un
   'grid' guardado arranca en grid. */
type Layout = 'tabs' | 'grid'
const LAYOUT_KEY = 'ntx:layout'

function loadLayout(): Layout {
  return window.localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'tabs'
}

/**
 * La status bar con sus números vivos. cpu y mem llegan una vez por segundo (y
 * otra por cada máquina emparejada): suscriptos acá, ese tic re-renderiza la
 * barra y no la app entera con sus cuatro terminales.
 */
function LiveStatusBar({
  peer,
  ...props
}: Omit<ComponentProps<typeof StatusBar>, 'stats'> & {
  /** Si el panel activo es de otra máquina, cuál: cpu y mem son los de ella. */
  peer?: string
}): JSX.Element {
  const [stats, setStats] = useState<SystemStats>({ cpu: 0, mem: 0 })
  const [peerStats, setPeerStats] = useState<Record<string, SystemStats>>({})
  useEffect(() => window.ntx.onStats(setStats), [])
  useEffect(
    () =>
      window.ntx.remote?.onStats((peerId, next) =>
        setPeerStats((previous) => ({ ...previous, [peerId]: next }))
      ),
    []
  )
  return <StatusBar {...props} stats={peer ? (peerStats[peer] ?? { cpu: 0, mem: 0 }) : stats} />
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
  const [helpOpen, setHelpOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateState>({ phase: 'idle' })
  // La versión cuyo aviso ya se descartó: el modal insiste por versión nueva,
  // nunca dos veces por la misma.
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(loadFontSize)
  const [crt, setCrt] = useState(loadCrt)
  const [layout, setLayout] = useState(loadLayout)
  const [terminalFont, setTerminalFont] = useState(loadTerminalFont)
  // Las otras máquinas: las emparejadas (con sus cpu/mem) y, si ésta comparte,
  // el estado de su host.
  const [machinesOpen, setMachinesOpen] = useState(false)
  const [peers, setPeers] = useState<PeerState[]>([])
  const [hostState, setHostState] = useState<HostState | null>(null)

  const gridRef = useRef<HTMLElement>(null)
  useGridFlip(gridRef, panes, layout)

  const palette = PALETTE
  const accentOf = useCallback((index: number) => paneAccent(palette, index), [palette])

  // El aviso salta solo cuando la descarga terminó, y se calla si el About ya
  // está mostrando lo mismo. Con otro modal o la paleta abiertos espera a que
  // se cierren: encima serían dos scrims y dos preguntas a la vez.
  const updatePromptOpen =
    update.phase === 'ready' &&
    update.version != null &&
    update.version !== dismissedUpdate &&
    !aboutOpen &&
    !machinesOpen &&
    !helpOpen &&
    !paletteOpen

  // Espejos para los handlers de teclado, que se registran una sola vez y no
  // pueden depender del estado sin volver a suscribirse en cada tecla.
  const panesRef = useRef(panes)
  panesRef.current = panes
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const paletteOpenRef = useRef(paletteOpen)
  paletteOpenRef.current = paletteOpen
  const modalOpenRef = useRef(false)
  modalOpenRef.current = aboutOpen || updatePromptOpen || machinesOpen || helpOpen
  const updateRef = useRef(update)
  updateRef.current = update
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles

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

  useEffect(() => {
    window.localStorage.setItem(CRT_KEY, crt ? '1' : '0')
  }, [crt])

  useEffect(() => saveTerminalFont(terminalFont), [terminalFont])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_KEY, layout)
  }, [layout])

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

  // La barra es del panel donde se abrió. Si el foco se va a otro (Ctrl 1–4,
  // Ctrl+Tab, un click), se cierra: abierta allá, con sus resaltados, mientras
  // el teclado ya está en otra shell, Escape le llegaba a la shell nueva.
  useEffect(() => {
    setSearch((previous) =>
      previous && panes[focused]?.id !== previous.paneId ? null : previous
    )
  }, [focused, panes])

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

  // Los lugares del grid ocupados: los paneles que hay más los que vienen en
  // camino. El acento de un panel sale de su lugar, y `panesRef` recién se
  // entera de uno nuevo cuando React lo dibuja: al restaurar una escena los
  // spawns van uno atrás del otro sin un render en el medio, y todos nacían
  // creyéndose el primero (el prompt de los cuatro, con el cian del 1).
  const slots = useRef(0)
  // El panel que tiene que quedarse con el foco apenas aparezca.
  const focusOnArrival = useRef<string | null>(null)

  const spawn = useCallback(async (profileId?: string, cwd?: string, focus = true): Promise<void> => {
    const current = panesRef.current
    if (slots.current >= MAX_PANES) return
    const slot = slots.current++

    const targetProfile = profileId ?? current[focusedRef.current]?.profileId
    // La carpeta del panel activo se hereda sólo si es de la MISMA máquina: una
    // ruta de la UCX no significa nada en la UCK1. Los perfiles remotos traen
    // la máquina en el id (`@<peer>/pwsh`); los locales, nada.
    const machineOf = (id: string | undefined): string => (id?.startsWith('@') ? id.split('/')[0]! : '')
    const focusedPane = current[focusedRef.current]
    const inherited =
      focusedPane && machineOf(focusedPane.profileId) === machineOf(targetProfile) ? focusedPane.cwd : undefined
    // El tamaño real lo pone el primer fit del panel; con esto el shell arranca
    // con algo razonable en vez de 0×0, que tira ConPTY abajo.
    let snapshot: Awaited<ReturnType<typeof window.ntx.spawn>>
    try {
      snapshot = await window.ntx.spawn({
        profileId: targetProfile ?? '',
        cwd: cwd ?? inherited,
        cols: 80,
        rows: 24,
        accent: paneAccent(PALETTE, slot)
      })
    } catch (error) {
      slots.current--
      throw error
    }

    if (focus) focusOnArrival.current = snapshot.id
    setPanes((previous) => [
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
          busySince: null,
          remote: snapshot.remote
        }
      ])
  }, [])

  // El foco va al panel nuevo cuando ya existe, no adentro del actualizador de
  // setPanes: React puede correr ese actualizador dos veces.
  useEffect(() => {
    const id = focusOnArrival.current
    if (!id) return
    const index = panes.findIndex((pane) => pane.id === id)
    if (index === -1) return
    focusOnArrival.current = null
    setFocused(index)
  }, [panes])

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

    // Si se cierra la que estás mirando, el foco (y el teclado) pasan YA a la
    // vecina: la de la derecha, o la de la izquierda si era la última. Hasta la
    // 1.0.7 se quedaba 220 ms en el panel que se iba, y lo tipeado en ese rato
    // se perdía; Ctrl+Shift+W dos veces seguidas cerraba una sola.
    const current = panesRef.current
    const index = current.findIndex((pane) => pane.id === paneId)
    if (index !== -1 && index === focusedRef.current) {
      const alive = (i: number): boolean => i !== index && current[i] !== undefined && !current[i]!.closing
      let next = -1
      for (let i = index + 1; i < current.length && next === -1; i++) if (alive(i)) next = i
      for (let i = index - 1; i >= 0 && next === -1; i--) if (alive(i)) next = i
      if (next !== -1) setFocused(next)
    }

    window.setTimeout(() => {
      forgetPane(paneId)
      const removed = panesRef.current.findIndex((pane) => pane.id === paneId)
      if (removed === -1) return
      slots.current--
      const remaining = panesRef.current.length - 1
      setPanes((previous) => previous.filter((pane) => pane.id !== paneId))
      // El foco sigue a SU shell: si la que se fue estaba antes, todas se corren
      // un lugar. Hasta la 1.0.7 sólo se acotaba al largo, y cerrar la 1ª de
      // cuatro escribiendo en la 3ª te mandaba el teclado a la 4ª.
      setFocused((focusedNow) =>
        Math.max(0, Math.min(focusedNow > removed ? focusedNow - 1 : focusedNow, remaining - 1))
      )
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
          // Sin foco cada uno: el que corresponde es el guardado, y va al final.
          for (const pane of scene) await spawn(pane.profileId, pane.cwd, false)
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

  // --- Otras máquinas ----------------------------------------------------------

  useEffect(() => {
    const remote = window.ntx.remote
    const host = window.ntx.host
    void remote?.peers().then(setPeers)
    void host?.state().then(setHostState)
    const off = [
      remote?.onPeers(setPeers),
      host?.onState(setHostState),
      // Apareció una máquina o se olvidó una: la paleta ofrece sus shells.
      window.ntx.onProfiles?.(setProfiles),
      // Un panel remoto se enteró de algo: si su máquina está, y su pid real
      // cuando la shell por fin arrancó del otro lado.
      window.ntx.onPaneRemote?.((paneId, info) =>
        setPanes((previous) =>
          previous.map((pane) =>
            pane.id === paneId ? { ...pane, remote: info, pid: info.pid ?? pane.pid } : pane
          )
        )
      )
    ]
    return () => off.forEach((unsubscribe) => unsubscribe?.())
  }, [])

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
      const where = pane.remote ? `${pane.remote.host} · ` : ''
      const notification = new Notification(`${where}${pane.profileLabel} — command finished`, {
        body: `${formatDuration(elapsed)} · exit ${exitCode} · ${shortPath(pane.cwd, 2, paneHome(pane))}`,
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
          // Siempre una shell de ésta, aunque el panel activo sea de otra
          // máquina: para la otra está Ctrl+Shift+M.
          event.preventDefault()
          void spawn(thisMachineShell(profilesRef.current, panesRef.current[focusedRef.current]?.profileId))
        } else if (key === 'w') {
          event.preventDefault()
          const pane = panesRef.current[focusedRef.current]
          if (pane) closePane(pane.id)
        } else if (key === 'f') {
          event.preventDefault()
          openSearch()
        } else if (key === 'm') {
          // Un PowerShell 7 de la otra máquina, aunque el panel activo sea de
          // ésta. Sin ninguna emparejada abre Machines, que es donde se empareja.
          event.preventDefault()
          const remote = otherMachinePwsh(
            profilesRef.current,
            panesRef.current[focusedRef.current]?.profileId
          )
          if (remote) void spawn(remote.id)
          else setMachinesOpen(true)
        } else if (key === 's') {
          // S de scanlines: prende y apaga el vidrio CRT.
          event.preventDefault()
          setCrt((on) => !on)
        } else if (key === 'l') {
          // L de letra: la terminal pasa de JetBrains Mono a Roboto Mono y
          // vuelve. Sólo la terminal; la interfaz no cambia.
          event.preventDefault()
          setTerminalFont((current) => (current === 'jetbrains' ? 'roboto' : 'jetbrains'))
        } else if (key === 'g') {
          // G de grid: de pestañas a todas a la vista, y vuelta.
          event.preventDefault()
          setLayout((current) => (current === 'tabs' ? 'grid' : 'tabs'))
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

  // Tab adentro de un modal da la vuelta adentro del modal. Sin esto se salía
  // al textarea de la terminal de atrás, y lo que tipeabas iba a la shell con
  // el modal abierto.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.ctrlKey || event.altKey) return
      const dialogs = document.querySelectorAll<HTMLElement>(
        '.ntx-scrim:not([data-closing="true"]) [role="dialog"]'
      )
      const dialog = dialogs[dialogs.length - 1]
      if (!dialog) return
      const stops = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ].filter((element) => element.getClientRects().length > 0)
      const first = stops[0]
      const last = stops[stops.length - 1]
      const active = document.activeElement
      if (!first || !last) {
        event.preventDefault()
        return
      }
      if (!dialog.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Un click en un botón del chrome (la tab activa, maximizar, la cruz de otra
  // tab) no se lleva el teclado: sin esto el foco quedaba en el botón, o en
  // ningún lado si el botón se desmontaba, y lo que tipeabas después no iba a
  // ninguna shell. Los botones de los overlays (modales, búsqueda) sí lo toman:
  // ahí el teclado es de ellos.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('.ntx-chrome button')) return
      if (target.closest('.ntx-scrim, .ntx-search')) return
      event.preventDefault()
    }
    window.addEventListener('mousedown', onMouseDown, true)
    return () => window.removeEventListener('mousedown', onMouseDown, true)
  }, [])

  // --- Comandos --------------------------------------------------------------

  const commands = useMemo<Command[]>(() => {
    const full = panes.length >= MAX_PANES
    const list: Command[] = []

    for (const profile of profiles) {
      // Las de otra máquina llevan su nombre adelante: "New shell · UCK1 · PowerShell 7".
      const label = profile.host ? `${profile.host} · ${profile.label}` : profile.label
      list.push({
        id: `new:${profile.id}`,
        label: `New shell · ${label}`,
        // Todas las shells con el mismo símbolo: lo que las distingue es el
        // nombre, y un ícono distinto para una sola sugiere una diferencia de
        // categoría que no existe — abrir WSL es abrir una shell, como el resto.
        icon: 'shell',
        desc: full ? `${MAX_PANES} shells are already open` : `Opens a shell running ${profile.label}`,
        hint: full ? 'Full' : undefined,
        run: () => {
          if (!full) void spawn(profile.id)
        }
      })
    }

    // Nada más: lo que antes vivía acá (buscar, cerrar la shell, Machines,
    // resetear el zoom) tiene su tecla o su botón a la vista, y los atajos están
    // todos juntos en la ayuda de la status bar. La paleta queda para lo que se
    // elige de una lista.

    return list
  }, [profiles, panes, spawn])

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
        onNew={() => void spawn(thisMachineShell(profilesRef.current, panesRef.current[focusedRef.current]?.profileId))}
        layout={layout}
        onLayout={setLayout}
      />

      {/* La forma del grid la dan los que se quedan: el que se cierra ya salió
          del flujo (ver useGridFlip). En pestañas la forma es siempre una celda,
          con todas las shells apiladas adentro y la activa a la vista. */}
      <main
        ref={gridRef}
        className="ntx-grid"
        data-layout={layout}
        data-count={layout === 'tabs' ? 1 : panes.filter((pane) => !pane.closing).length}
      >
        {panes.map((pane, index) => (
          <TerminalPane
            key={pane.id}
            pane={pane}
            index={index}
            accent={accentOf(index)}
            palette={palette}
            fontSize={fontSize}
            font={terminalFont}
            focused={index === focused}
            // La búsqueda abierta también apaga el teclado de la terminal: el
            // que tipea ahí es el input de la barra. Cerrarla lo devuelve.
            keyboardFocus={
              index === focused &&
              !paletteOpen &&
              !aboutOpen &&
              !updatePromptOpen &&
              !machinesOpen &&
              !helpOpen &&
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

      <LiveStatusBar
        // cpu y mem son de la máquina donde corre el panel activo: mirando una
        // shell de la UCK1, lo que importa es cómo está la UCK1.
        peer={panes[focused]?.remote?.peer}
        active={panes[focused]}
        accent={accentOf(focused)}
        palette={palette}
        onOpenAbout={openAbout}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenMachines={window.ntx.remote ? () => setMachinesOpen(true) : undefined}
        sharing={{ on: hostState?.enabled ?? false, clients: hostState?.clients.length ?? 0 }}
      />

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <AboutModal open={aboutOpen} update={update} onClose={() => setAboutOpen(false)} />

      <MachinesModal
        open={machinesOpen}
        host={hostState}
        peers={peers}
        profiles={profiles}
        full={panes.filter((pane) => !pane.closing).length >= MAX_PANES}
        onSpawn={(profileId) => void spawn(profileId)}
        onClose={() => setMachinesOpen(false)}
      />

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
      <CrtLayer on={crt} />
    </div>
  )
}
