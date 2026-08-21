import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { Icon } from './Icon'
import { SearchBar, type SearchQuery, type SearchResults } from './SearchBar'
import { attachPane, attachReader } from '../lib/ptyBus'
import { mixHex, xtermTheme, type Palette } from '../term/themes'
import { paneTitle, pathForShell, type PaneState } from '../lib/panes'

interface TerminalPaneProps {
  pane: PaneState
  index: number
  accent: string
  palette: Palette
  /** El tamaño de letra del momento: lo gobierna App, es uno solo para todas. */
  fontSize: number
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

  const paneId = pane.id

  useEffect(() => {
    const element = host.current
    if (!element) return

    const terminal = new Terminal({
      allowProposedApi: true,
      fontFamily: "'JetBrains Mono', 'Noto Sans Symbols 2', monospace",
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
      cursorBlink: true,
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
      rows: 24
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

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

    // OSC 7: el shell nos dice en qué directorio está parado en cada prompt.
    // Llega como file:///C:/Users/... y con los espacios en %20.
    terminal.parser.registerOscHandler(7, (payload) => {
      const match = /^file:\/\/[^/]*\/?(.*)$/.exec(payload)
      if (match?.[1]) {
        try {
          callbacks.current.onCwd(decodeURIComponent(match[1]).replace(/\//g, '\\'))
        } catch {
          // Un payload mal escapado no puede tumbar el parser de la terminal.
        }
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
      if (event.shiftKey && key === 'v') {
        void navigator.clipboard.readText().then((text) => {
          if (text) window.ntx.write(paneId, text)
        })
        return false
      }
      if (!event.shiftKey && key === 'c' && terminal.hasSelection()) {
        copy()
        return false
      }
      return true
    })

    terminal.onData((data) => window.ntx.write(paneId, data))
    terminal.onResize(({ cols, rows }) => window.ntx.resize(paneId, cols, rows))

    const detach = attachPane(
      paneId,
      (data) => terminal.write(data),
      (code) => {
        setDead(code)
        callbacks.current.onExit(code)
      }
    )

    // El scrollback, para los comandos de copiar/guardar de la paleta. Lee el
    // buffer NORMAL a propósito: es el que tiene la historia — el alterno es la
    // pantalla de una TUI (btop, lazygit), que no es lo que uno quiere llevarse.
    // Las filas envueltas se recosen a su línea lógica: un renglón largo vuelve
    // a ser UN renglón, no tantos como cortes hizo el ancho del panel.
    const detachReader = attachReader(paneId, () => {
      const buffer = terminal.buffer.normal
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (!line) continue
        const text = line.translateToString(true)
        if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
        else lines.push(text)
      }
      // El vacío del final no es historia: es el resto del viewport.
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      return lines.join('\n')
    })

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

    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        // Pasa mientras el panel se está cerrando; el próximo tick no existe.
      }
    })
    observer.observe(element)

    return () => {
      cancelAnimationFrame(first)
      observer.disconnect()
      detach()
      detachReader()
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

  const onDragEnter = (event: React.DragEvent): void => {
    if (dead !== null || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDropping(true)
  }

  const onDragOver = (event: React.DragEvent): void => {
    if (dead !== null || !event.dataTransfer.types.includes('Files')) return
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
    if (dead !== null) return
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
          <Icon name="caret" size={9} />
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="ntx-pane__title">{paneTitle(pane)}</span>
        <span className="ntx-pane__pid ntx-copyable">
          {dead === null ? `PID ${pane.pid}` : `exit ${dead}`}
        </span>
      </header>

      {dead !== null && (
        <div className="ntx-pane__dead">
          <Icon name="skull" size={15} />
          <span>
            The shell exited with code <b>{dead}</b>. Ctrl Shift W closes the pane.
          </span>
        </div>
      )}

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
