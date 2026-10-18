import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { Icon } from './Icon'
import { SearchBar, type SearchQuery, type SearchResults } from './SearchBar'
import { Swap } from './Swap'
import { attachPane } from '../lib/ptyBus'
import { mixHex, xtermTheme, type Palette } from '../term/themes'
import { lowerCellBackgrounds } from '../term/cellBackgrounds'
import { TERMINAL_FONTS, type TerminalFont } from '../term/fonts'
import { reducedMotion } from '../lib/motion'
import { withoutCtrlClick } from '../lib/mouseLink'
import { paneTitle, pathForShell, type PaneState } from '../lib/panes'

// Tope del base64 de un OSC 52 (~1 MB de texto): un copiado de verdad no llega
// ni cerca, y un programa desbocado no nos llena el portapapeles.
const OSC52_MAX = 1_400_000

/** El build de Windows que se le declara a xterm si la plataforma no lo dice
 *  (NTX Mobile): un Windows 11, que es donde corren todas las shells. */
const WINDOWS_BUILD_FALLBACK = 22631

/** Cuánto espera el fit a que el tamaño se quede quieto. Arrastrando el borde de
 *  la ventana el observer dispara en cada cuadro, y cada fit es un resize del
 *  pty (por la red, en los paneles de otra máquina) y un repintado de ConPTY. */
const FIT_SETTLE_MS = 90

/** Las shells que pegan solas con Ctrl+V leyendo el portapapeles (PSReadLine).
 *  En las demás (cmd, bash, WSL) el ^V crudo no pega nada. */
const PASTES_ITSELF = new Set(['pwsh', 'powershell'])

/** Las curvas de base.css (--ntx-ease, --ntx-ease-both), para el fundido del
 *  cambio de letra, que va por WAAPI. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const EASE_BOTH = 'cubic-bezier(0.65, 0, 0.35, 1)'

interface TerminalPaneProps {
  pane: PaneState
  index: number
  accent: string
  palette: Palette
  /** El tamaño de letra del momento: lo gobierna App, es uno solo para todas. */
  fontSize: number
  /** La letra (Ctrl+Shift+L), también una sola para todas. Opcional porque NTX
   *  Mobile monta el panel sin ella: ahí es JetBrains. */
  font?: TerminalFont
  /** Manda el anillo de acento: el panel activo se sigue viendo activo. */
  focused: boolean
  /** Si además tiene que quedarse el teclado. Es false mientras hay un overlay
   *  abierto, para no pelearle el foco al input de la paleta. */
  keyboardFocus: boolean
  /** La barra de búsqueda de ESTE panel. La gobierna App porque sólo puede
   *  haber una abierta: la búsqueda vive donde está el foco. */
  searchOpen: boolean
  /** Sube cuando se re-pide la búsqueda ya abierta: re-enfoca la barra. */
  searchNonce: number
  onSearchClose: () => void
  onFocus: () => void
  onExit: (code: number) => void
  onCwd: (cwd: string) => void
  /** OSC 133: un comando arrancó (C) o terminó (D, con su exit code). */
  onCommand: (running: boolean, exitCode: number) => void
}

export function TerminalPane({
  pane,
  index,
  accent,
  palette,
  fontSize,
  font = 'jetbrains',
  focused,
  keyboardFocus,
  searchOpen,
  searchNonce,
  onSearchClose,
  onFocus,
  onExit,
  onCwd,
  onCommand
}: TerminalPaneProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const search = useRef<SearchAddon | null>(null)
  const [dead, setDead] = useState<number | null>(null)
  const lastDead = useRef(0)
  if (dead !== null) lastDead.current = dead
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  // Un archivo en vuelo sobre el panel: enciende el anillo de "soltá acá".
  const [dropping, setDropping] = useState(false)
  // dragenter/dragleave disparan por cada hijo que el puntero cruza; el
  // contador es el truco clásico para saber cuándo se fue del panel DE VERDAD.
  const dragDepth = useRef(0)

  // Los callbacks van por ref para que el efecto de montaje no dependa de ellos:
  // si dependiera, cada render de App destruiría y recrearía la terminal entera,
  // scrollback incluido.
  const callbacks = useRef({ onExit, onCwd, onCommand })
  callbacks.current = { onExit, onCwd, onCommand }

  // También por ref: es el valor INICIAL de la terminal. Los cambios en vivo los
  // aplica su propio efecto más abajo, sin recrear nada.
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize
  const fontRef = useRef(font)
  fontRef.current = font

  const paneId = pane.id

  // Por ref como los callbacks: el handler de teclas se arma una sola vez al
  // montar la terminal.
  const remoteRef = useRef(pane.remote !== undefined)
  remoteRef.current = pane.remote !== undefined
  const profileRef = useRef(pane.profileId)
  profileRef.current = pane.profileId
  // Un panel que se está yendo no muestra el cartel de shell muerta: la muerte
  // la pidió el cierre, y el cartel aparecería encima del fundido.
  const closingRef = useRef(pane.closing)
  closingRef.current = pane.closing

  useEffect(() => {
    const element = host.current
    if (!element) return

    const terminal = new Terminal({
      allowProposedApi: true,
      fontFamily: TERMINAL_FONTS[fontRef.current],
      fontSize: fontSizeRef.current,
      // Interlineado 1, y no se toca.
      //
      // Los caracteres de bloque y de box drawing (█ ▀ ▄ ─ │ ┌ ├) están dibujados
      // para llenar la celda ENTERA y así pegarse con sus vecinos. Cualquier
      // valor mayor a 1 estira la celda más allá del glifo y deja una franja de
      // fondo entre fila y fila: con 1.25 eran 17px de bloque y 4px de aire, o
      // sea que todo dibujo hecho con bloques salía rayado y todo marco de TUI
      // —btop, lazygit, el recuadro de bienvenida de Claude Code— salía cortado.
      lineHeight: 1,
      letterSpacing: 0,
      // Quieto si Windows pide movimiento reducido.
      cursorBlink: !reducedMotion(),
      // Bloque, como la maqueta. El glow y el parpadeo los termina de dar el CSS
      // (ver .xterm-cursor-block en base.css): xterm no tiene opción para la
      // aureola, pero con el renderer DOM el cursor es un elemento de verdad y se
      // puede estilar. Con WebGL sería un puñado de píxeles en una textura.
      cursorStyle: 'block',
      scrollback: 10_000,
      // Sin addon de WebGL a propósito. El WebGL rasteriza los glifos a un atlas
      // de textura y ahí recorta las itálicas: la sugerencia inline de PSReadLine
      // termina renderizada como un subíndice. El renderer DOM las dibuja bien.
      theme: xtermTheme(palette, accent),
      // El shell arranca con este tamaño y el primer fit lo corrige enseguida.
      cols: 80,
      rows: 24,
      // Todas las shells son ConPTY, y xterm tiene que saberlo. Sin esto, al
      // CRECER (maximizar, pasar de tres paneles a dos, achicar la letra) baja
      // líneas del scrollback para llenar las filas nuevas, ConPTY repinta su
      // pantalla encima, y esas líneas se pierden: medido en la 1.0.7, dos
      // vueltas de achicar y agrandar la ventana borraron 14 líneas para siempre.
      // Con esto, ninguna en tres vueltas.
      windowsPty: {
        backend: 'conpty',
        buildNumber: window.ntx.platform.windowsBuild ?? WINDOWS_BUILD_FALLBACK
      }
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    // Los links se abren con Ctrl+click, como en Windows Terminal: un click
    // pelado es para enfocar o seleccionar, y no puede abrir el navegador porque
    // justo caíste sobre una URL. Por defecto el addon hacía window.open() SIN
    // la URL (para asignarla después), y la ventana lo rechazaba: hasta la 1.0.7
    // los links no abrían nunca.
    // Los links con OSC 8 (texto que apunta a una URL) van por el mismo camino:
    // sin linkHandler, xterm pedía confirmación con un confirm() y después no
    // podía abrir la ventana.
    const openLink = window.ntx.openLink
    let overLink = false
    if (openLink) {
      const handler = {
        activate: (event: MouseEvent, uri: string) => {
          if (event.ctrlKey) openLink(uri)
        },
        hover: () => {
          overLink = true
        },
        leave: () => {
          overLink = false
        }
      }
      terminal.loadAddon(new WebLinksAddon(handler.activate, { hover: handler.hover, leave: handler.leave }))
      terminal.options.linkHandler = handler
    } else {
      terminal.loadAddon(new WebLinksAddon())
    }

    // La búsqueda del scrollback. El addon emite el contador (n/total) sólo
    // cuando las búsquedas piden decoraciones — y las nuestras siempre lo hacen.
    const searchAddon = new SearchAddon()
    terminal.loadAddon(searchAddon)
    searchAddon.onDidChangeResults(({ resultIndex, resultCount }) =>
      setSearchResults({ index: resultIndex, count: resultCount })
    )

    // Unicode 11: sin esto, los emojis y los glifos anchos que escupe una CLI
    // moderna se miden con el ancho equivocado y desalinean toda la columna.
    const unicode = new Unicode11Addon()
    terminal.loadAddon(unicode)
    terminal.unicode.activeVersion = '11'

    terminal.open(element)
    const stopCellBackgrounds = lowerCellBackgrounds(terminal)

    // OSC 7: el shell nos dice en qué directorio está parado en cada prompt.
    // Llega como file:///C:/Users/... y con los espacios en %20.
    //
    // Lo de WSL fuera de /mnt (file:////home/fran, ver ntx-init.sh) queda como
    // ruta Linux. Antes salía \home\fran: la barra mostraba eso y Ctrl+Shift+T
    // heredaba una carpeta que no existe. Y un UNC (file://///servidor/x, que
    // puede salir en cualquier `cat`) se ignora: el main busca el .git de la
    // carpeta, y en una ruta de red eso se queda esperando a otra máquina.
    terminal.parser.registerOscHandler(7, (payload) => {
      const match = /^file:\/\/[^/]*\/(.*)$/.exec(payload)
      if (match?.[1]) {
        try {
          const path = decodeURIComponent(match[1])
          if (/^[A-Za-z]:(\/|$)/.test(path)) callbacks.current.onCwd(path.replace(/\//g, '\\'))
          else if (!path.startsWith('//')) callbacks.current.onCwd(path.startsWith('/') ? path : `/${path}`)
        } catch {
          // Un payload mal escapado no puede tumbar el parser de la terminal.
        }
      }
      return true
    })

    // OSC 52: un programa de la terminal pide "copiá esto" por la terminal misma,
    // como `52;c;<base64>`. Es la única copia que cruza de máquina: Claude Code,
    // en un panel remoto, copia al portapapeles de la máquina donde CORRE (la
    // otra) y además emite este OSC — y esto lo deja en el de ESTA. Sólo
    // escritura: el `?` que pide LEER el portapapeles se ignora, porque le daría
    // a cualquier programa (de cualquier máquina) lo que copiaste.
    terminal.parser.registerOscHandler(52, (payload) => {
      const separator = payload.indexOf(';')
      const data = separator < 0 ? '' : payload.slice(separator + 1)
      if (!data || data === '?' || data.length > OSC52_MAX) return true
      try {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
        const text = new TextDecoder().decode(bytes)
        // Por el main si se puede: el navegador rechaza escribir el
        // portapapeles con la ventana sin foco, y la copia de un Claude Code
        // remoto llega cuando llega, también con NTX detrás de otra ventana.
        if (text) {
          if (window.ntx.copyText) window.ntx.copyText(text)
          else void navigator.clipboard.writeText(text)
        }
      } catch {
        // Base64 roto: se descarta sin tumbar el parser.
      }
      return true
    })

    // OSC 133: los init de shell marcan C al arrancar un comando y D;<code> al
    // terminar. Un D suelto (arranque, Enter en vacío) lo filtra App, que es
    // quien lleva la cuenta de qué panel tiene algo corriendo desde cuándo.
    terminal.parser.registerOscHandler(133, (payload) => {
      if (payload === 'C') {
        callbacks.current.onCommand(true, 0)
      } else if (payload === 'D' || payload.startsWith('D;')) {
        const code = Number(payload.slice(2))
        callbacks.current.onCommand(false, Number.isFinite(code) ? code : 0)
      }
      // Las demás marcas (A, B) no se usan, pero igual son nuestras: true evita
      // que xterm las siga ofreciendo a otros handlers.
      return true
    })

    // Copiar y pegar hay que cablearlos: en una terminal Ctrl+C es SIGINT, no
    // copiar, así que el par va con Shift. Y replicamos lo que hace Windows
    // Terminal: Ctrl+C copia SÓLO si hay algo seleccionado, y si no, sigue siendo
    // la interrupción de toda la vida.
    terminal.attachCustomKeyEventHandler((event) => {
      // Una tecla que la app ya usó (Ctrl 1–3, el zoom) no es para la shell.
      // App la frena en captura con preventDefault, pero xterm no lo mira: hasta
      // la 1.0.7, Ctrl+3 le mandaba un Esc a la shell que dejabas (interrumpía a
      // Claude Code, borraba la línea en pwsh) y Ctrl+4 un ^\.
      if (event.defaultPrevented) return false
      // Shift+Enter y Ctrl+Enter: salto de línea sin mandar. xterm los manda
      // como un Enter pelado (el modificador se pierde) y Claude Code enviaba
      // el mensaje. Salen como ESC CR (Alt+Enter), que CC toma como salto de
      // línea y que ConPTY entrega entero: lo mismo que hace NTX Mobile con su
      // Shift armado. Se frenan también el keypress y el keyup, o xterm
      // mandaría además su Enter.
      if (event.key === 'Enter' && (event.shiftKey || event.ctrlKey) && !event.altKey && !event.metaKey) {
        if (event.type === 'keydown') {
          event.preventDefault()
          terminal.input('\x1b\r', true)
        }
        return false
      }
      if (event.type !== 'keydown' || !event.ctrlKey) return true
      const key = event.key.toLowerCase()

      const copy = (): void => {
        const selection = terminal.getSelection()
        if (selection) void navigator.clipboard.writeText(selection)
        terminal.clearSelection()
      }

      if (event.shiftKey && key === 'c') {
        copy()
        return false
      }
      // Ctrl+Shift+V es "pegar como texto" para Chromium: al sacarle la tecla a
      // xterm, el navegador dispara su `paste` nativo y xterm lo pega solo. Hasta
      // la 0.17.0 acá además se pegaba a mano, y el texto salía DOS veces.
      if (event.shiftKey && key === 'v') {
        return false
      }
      // El Ctrl+V pelado NO lo pega NTX: xterm lo manda a la shell como ^V (y
      // con eso frena el pegado nativo del navegador), y lo resuelve PSReadLine
      // leyendo el portapapeles de la máquina donde CORRE. En una shell de acá
      // es el tuyo; en una de otra máquina es el de ella, donde no copiaste
      // nada, y el pegado salía vacío (en cmd, un "^V" literal).
      //
      // En los paneles remotos —y en las shells que no pegan solas, cmd, bash y
      // WSL, donde ^V no pega nada— la tecla se le saca a xterm y nada más: sin su
      // preventDefault, Chromium dispara su `paste` nativo con el portapapeles
      // de ESTA máquina, y xterm lo pega por su camino de siempre (bracketed
      // paste incluido). Pegar a mano además lo duplicaba — medido. El costo es
      // que ahí ^V ya no llega crudo (el bloque visual de vim, por ejemplo): lo
      // mismo que hace Windows Terminal.
      if (
        !event.shiftKey &&
        !event.altKey &&
        key === 'v' &&
        (remoteRef.current || !PASTES_ITSELF.has(profileRef.current))
      ) {
        return false
      }
      if (!event.shiftKey && key === 'c' && terminal.hasSelection()) {
        copy()
        return false
      }
      return true
    })

    // Un emoji tipeado (con el teclado, Win+. o Moji) llega en dos tandas:
    // Windows manda las dos mitades del par sustituto como dos teclas y xterm
    // emite cada una apenas la recibe. Mandada sola, la mitad no se puede pasar
    // a UTF-8 y la shell recibía dos «�»: la primera espera a la segunda.
    let half = ''
    terminal.onData((chunk) => {
      let data = half + chunk
      half = ''
      const last = data.charCodeAt(data.length - 1)
      if (last >= 0xd800 && last <= 0xdbff) {
        half = data.slice(-1)
        data = data.slice(0, -1)
        if (!data) return
      }
      // Ver lib/mouseLink: el Ctrl+click sobre un link ya lo abre NTX.
      if (overLink) data = withoutCtrlClick(data)
      window.ntx.write(paneId, data)
    })
    terminal.onResize(({ cols, rows }) => window.ntx.resize(paneId, cols, rows))

    const detach = attachPane(
      paneId,
      (data) => terminal.write(data),
      (code) => {
        if (!closingRef.current) setDead(code)
        callbacks.current.onExit(code)
      }
    )

    term.current = terminal
    fit.current = fitAddon
    search.current = searchAddon

    // El primer fit va en el siguiente frame: recién ahí el contenedor tiene su
    // tamaño real y xterm puede medir la celda.
    const first = requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch {
        // Contenedor todavía en cero: el ResizeObserver lo reintenta.
      }
    })

    // El fit espera a que el tamaño se quede quieto (ver FIT_SETTLE_MS).
    let settle = 0
    const observer = new ResizeObserver(() => {
      window.clearTimeout(settle)
      settle = window.setTimeout(() => {
        try {
          fitAddon.fit()
        } catch {
          // Pasa mientras el panel se está cerrando; el próximo tick no existe.
        }
      }, FIT_SETTLE_MS)
    })
    observer.observe(element)

    return () => {
      cancelAnimationFrame(first)
      window.clearTimeout(settle)
      observer.disconnect()
      stopCellBackgrounds()
      detach()
      // Dispose de la terminal se lleva también a sus addons cargados.
      terminal.dispose()
      term.current = null
      fit.current = null
      search.current = null
    }
    // Sólo el id: cambiar de tema o de acento NO debe recrear la terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  // Tema en caliente: se le pasa el objeto nuevo a la instancia viva.
  useEffect(() => {
    if (term.current) term.current.options.theme = xtermTheme(palette, accent)
  }, [palette, accent])

  // Zoom en caliente. El fit va a mano: la celda cambió de tamaño pero el
  // contenedor no, así que el ResizeObserver no se entera de nada.
  useEffect(() => {
    const terminal = term.current
    if (!terminal || terminal.options.fontSize === fontSize) return
    terminal.options.fontSize = fontSize
    try {
      fit.current?.fit()
    } catch {
      // Panel a mitad de cierre: no hay nada que ajustar.
    }
  }, [fontSize])

  // Cambio de letra en caliente, con un fundido de la pantalla para que no
  // salte de una a otra: se va (110), cambia sin que se vea y vuelve (180). La
  // que se aplica es la del momento de cambiar, así que dos Ctrl+Shift+L
  // seguidos no dejan una letra vieja. El fit va a mano como en el zoom: las
  // dos celdas miden casi lo mismo, pero no idéntico. Las animaciones no
  // dejan nada puesto al terminar, así que el tono del panel sin máquina
  // (opacity en base.css) sigue mandando.
  useEffect(() => {
    const terminal = term.current
    const element = host.current
    if (!terminal || !element || terminal.options.fontFamily === TERMINAL_FONTS[font]) return
    const apply = (): void => {
      const target = term.current
      if (!target) return
      target.options.fontFamily = TERMINAL_FONTS[fontRef.current]
      try {
        fit.current?.fit()
      } catch {
        // Panel a mitad de cierre: no hay nada que ajustar.
      }
    }
    if (reducedMotion()) {
      apply()
      return
    }
    // Si venía de otro cambio a medio fundido, sigue desde donde estaba.
    const from = getComputedStyle(element).opacity
    element.getAnimations().forEach((animation) => animation.cancel())
    const out = element.animate([{ opacity: from }, { opacity: 0 }], {
      duration: 110,
      easing: EASE_BOTH,
      fill: 'forwards'
    })
    out.finished
      .then(() => {
        apply()
        // Sin la salida puesta, lo que queda es el tono que manda el CSS.
        out.cancel()
        const to = getComputedStyle(element).opacity
        return element.animate([{ opacity: 0 }, { opacity: to }], { duration: 180, easing: EASE }).finished
      })
      .catch(() => {
        // Cancelada por un cambio más nuevo: ése se encarga.
      })
  }, [font])

  // Enfocar el panel enfoca su terminal, para que tipear vaya al shell correcto.
  // Y al cerrarse un overlay, keyboardFocus vuelve a true y el teclado regresa
  // solo a la terminal: sin esto habría que hacer click para seguir escribiendo.
  // (La búsqueda abierta también apaga keyboardFocus, así que cerrarla devuelve
  // el teclado por este mismo camino.)
  useEffect(() => {
    if (keyboardFocus && !dead) term.current?.focus()
  }, [keyboardFocus, dead])

  // Cerrada la búsqueda —da igual por qué puerta— se apagan los resaltados.
  useEffect(() => {
    if (searchOpen) return
    search.current?.clearDecorations()
    setSearchResults(null)
  }, [searchOpen])

  const onFind = useCallback(
    ({ term: needle, caseSensitive, incremental, previous }: SearchQuery): void => {
      const addon = search.current
      if (!addon) return
      const options = {
        caseSensitive,
        incremental,
        decorations: {
          // Aplanados contra la base porque el addon sólo acepta #RRGGBB. El
          // resaltado se pinta DEBAJO del texto, así que puede ser opaco sin
          // taparlo; el activo además se marca con el borde a acento pleno.
          matchBackground: mixHex(accent, palette.base, 0.28),
          matchOverviewRuler: accent,
          activeMatchBackground: mixHex(accent, palette.base, 0.55),
          activeMatchBorder: accent,
          activeMatchColorOverviewRuler: accent
        }
      }
      if (previous) addon.findPrevious(needle, options)
      else addon.findNext(needle, options)
    },
    [accent, palette]
  )

  const onSearchClear = useCallback((): void => {
    search.current?.clearDecorations()
    setSearchResults(null)
  }, [])

  // --- Soltar archivos: la ruta cae en el prompt --------------------------------
  //
  // Lo que se escribe no es la ruta cruda: pathForShell la traduce y la cita en
  // el idioma de ESTA shell (/mnt/c para WSL, barras para Git Bash, comillas de
  // PowerShell o cmd según toque). Va directo al pty, el mismo camino que el
  // pegado — y con un espacio al final, para seguir tipeando sin tocar nada.

  // Un panel de otra máquina no acepta archivos: la ruta de ESTE disco no existe
  // allá, y pegarla en su prompt sería mentirle. Sin preventDefault el cursor
  // dice "no se puede" solo, y el drop cae en el tragadero de App.
  const remote = pane.remote !== undefined

  const onDragEnter = (event: React.DragEvent): void => {
    if (dead !== null || remote || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDropping(true)
  }

  const onDragOver = (event: React.DragEvent): void => {
    if (dead !== null || remote || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropping(false)
  }

  const onDrop = (event: React.DragEvent): void => {
    dragDepth.current = 0
    setDropping(false)
    if (dead !== null || remote) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    event.preventDefault()
    const text = files
      .map((file) => pathForShell(window.ntx.pathForFile(file), pane.profileId))
      .join(' ')
    if (text) window.ntx.write(paneId, `${text} `)
    // Soltaste acá: este panel pasa a ser el tuyo, y con él vuelve el teclado.
    onFocus()
  }

  return (
    <section
      className="ntx-pane"
      // El grid lo usa para animar el reacomodo (FLIP, en App).
      data-pane={pane.id}
      data-focused={focused}
      data-closing={pane.closing}
      data-dropping={dropping}
      style={{ ['--accent' as string]: accent }}
      onMouseDown={onFocus}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="ntx-pane__head ntx-chrome">
        <span className="ntx-pane__num">
          <Swap value={String(index + 1).padStart(2, '0')} />
        </span>
        {/* La máquina, si no es ésta. Apagada mientras no se la alcanza: el panel
            sigue ahí y tipear se encola, pero tiene que verse que del otro lado
            ahora no hay nadie. */}
        {pane.remote && (
          <span
            className="ntx-pane__host"
            data-online={pane.remote.online}
            data-tip={pane.remote.online ? `Runs on ${pane.remote.host}` : `Waiting for ${pane.remote.host}…`}
          >
            <Icon name="machine" size={11} strokeWidth={1.6} />
            {pane.remote.host}
            {/* Siempre montado: se despliega y se pliega con el estado, no salta. */}
            <span className="ntx-pane__host-state">offline</span>
          </span>
        )}
        <Swap className="ntx-pane__title" value={paneTitle(pane)} />
        <Swap className="ntx-pane__pid ntx-copyable" value={dead === null ? `PID ${pane.pid}` : `exit ${dead}`} />
      </header>

      {/* Siempre montado: se despliega cuando la shell muere, y la terminal se
          achica de a poco en vez de saltar hacia abajo. */}
      <div className="ntx-reveal" data-open={dead !== null} aria-hidden={dead === null}>
        <div className="ntx-reveal__inner">
          <div className="ntx-pane__dead">
            <Icon name="skull" size={15} />
            <span>
              The shell exited with code <b>{dead ?? lastDead.current}</b>. Ctrl Shift W closes the pane.
            </span>
          </div>
        </div>
      </div>

      <div className="ntx-pane__term">
        <div ref={host} className="ntx-pane__screen" />
      </div>

      <SearchBar
        open={searchOpen}
        nonce={searchNonce}
        results={searchResults}
        onFind={onFind}
        onClear={onSearchClear}
        onClose={onSearchClose}
      />
    </section>
  )
}
