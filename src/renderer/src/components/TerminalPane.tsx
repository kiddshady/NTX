import { useEffect, useRef, useState, type JSX } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Icon } from './Icon'
import { attachPane } from '../lib/ptyBus'
import { xtermTheme, type Palette } from '../term/themes'
import { paneTitle, type PaneState } from '../lib/panes'

/** Las TUIs conocidas: mientras una corre en primer plano, los atajos de la
 *  app le ceden el paso. */
const TUI_COMMANDS = new Set([
  'nano', 'pico', 'vim', 'vi', 'nvim', 'micro', 'emacs', 'helix', 'hx',
  'less', 'more', 'man', 'htop', 'btop', 'top', 'tmux', 'screen',
  'fzf', 'lazygit', 'gitui', 'tig', 'ranger', 'mc', 'yazi', 'ssh', 'mosh', 'claude'
])

/**
 * ¿La línea lanza una TUI? Busca la primera palabra que parece el programa —
 * salteando prefijos de transporte y flags— y la normaliza: `sudo nano x`,
 * `wsl vim` y `& 'C:\tools\nano.exe'` cuentan igual que `nano`.
 */
function isTuiCommand(line: string): boolean {
  for (const word of line.trim().toLowerCase().split(/\s+/)) {
    if (word === 'sudo' || word === 'wsl' || word === 'winpty' || word === '&') continue
    if (word.startsWith('-')) continue
    const base = word.replace(/^["']+|["']+$/g, '').split(/[\\/]/).pop() ?? ''
    return TUI_COMMANDS.has(base.replace(/\.exe$/, ''))
  }
  return false
}

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
  onFocus: () => void
  onExit: (code: number) => void
  onCwd: (cwd: string) => void
  /** Avisa cuando una app a pantalla completa (nano, vim, btop) toma o suelta
   *  el panel, se entere por donde se entere. */
  onFullscreenApp: (active: boolean) => void
}

export function TerminalPane({
  pane,
  index,
  accent,
  palette,
  fontSize,
  focused,
  keyboardFocus,
  onFocus,
  onExit,
  onCwd,
  onFullscreenApp
}: TerminalPaneProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const [dead, setDead] = useState<number | null>(null)

  // Los callbacks van por ref para que el efecto de montaje no dependa de ellos:
  // si dependiera, cada render de App destruiría y recrearía la terminal entera,
  // scrollback incluido.
  const callbacks = useRef({ onExit, onCwd, onFullscreenApp })
  callbacks.current = { onExit, onCwd, onFullscreenApp }

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

    // ¿Hay una app a pantalla completa en el panel? Dos señales, OR-eadas:
    //
    //   · El alternate buffer: la vía VT clásica. Alcanza para todo lo que corre
    //     en WSL y Git Bash — su nano manda smcup y ConPTY lo reenvía.
    //   · La integración de shell (OSC 7771, de los ntx-init): imprescindible
    //     para las TUIs win32. El nano de Windows en PowerShell pinta por
    //     Console API y ConPTY NO traduce eso a ?1049h, así que el buffer jamás
    //     cambia. Medido con sonda (19 ago 2026): pwsh+nano = cero 1049h en el
    //     stream; el mismo nano en wsl y gitbash sí lo manda.
    //
    // App usa el aviso para cederle al programa los atajos de la app (hoy: el
    // de la paleta).
    let altBuffer = false
    let tuiRunning = false
    const reportFullscreen = (): void => {
      callbacks.current.onFullscreenApp(altBuffer || tuiRunning)
    }

    terminal.buffer.onBufferChange((buffer) => {
      altBuffer = buffer.type === 'alternate'
      reportFullscreen()
    })

    terminal.parser.registerOscHandler(7771, (payload) => {
      if (payload === 'prompt') tuiRunning = false
      else if (payload.startsWith('run;')) tuiRunning = isTuiCommand(payload.slice(4))
      reportFullscreen()
      return true
    })

    const detach = attachPane(
      paneId,
      (data) => terminal.write(data),
      (code) => {
        setDead(code)
        callbacks.current.onExit(code)
      }
    )

    term.current = terminal
    fit.current = fitAddon

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
      terminal.dispose()
      term.current = null
      fit.current = null
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
  useEffect(() => {
    if (keyboardFocus && !dead) term.current?.focus()
  }, [keyboardFocus, dead])

  return (
    <section
      className="ntx-pane"
      data-focused={focused}
      data-closing={pane.closing}
      style={{ ['--accent' as string]: accent }}
      onMouseDown={onFocus}
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
    </section>
  )
}
