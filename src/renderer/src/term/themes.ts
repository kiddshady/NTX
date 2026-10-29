import type { ITheme } from '@xterm/xterm'

/**
 * La paleta de NTX.
 *
 * Vive en TypeScript y no en CSS a propósito: los mismos colores los necesitan
 * el CSS del chrome Y el objeto `ITheme` de xterm. Teniéndolos en un solo lugar
 * no puede pasar que el borde del panel y el texto de la terminal se vayan
 * separando de a un commit por vez.
 *
 * ── La clave visual ─────────────────────────────────────────────────────────
 *
 * NTX es ACROMÁTICA: los grises son grises de verdad, sin un grado de tinte. El
 * color lo ponen tres acentos y nada más, y cada uno tiene un ROL FIJO — nunca
 * decoran:
 *
 *   accent (cian)     → el foco, la acción primaria, lo que salió bien.
 *   alt    (magenta)  → la marca, y lo destructivo (cerrar, error).
 *   warn   (amarillo) → la atención: cambios sin commitear, avisos, carga alta.
 *
 * Tres acentos chillones sobre gris sólo conviven si nunca hay más de uno
 * prendido a la vez. De eso se encarga `paneAccent()`: cada panel se queda con
 * uno según su posición en el grid y lo enciende únicamente cuando tiene el
 * foco; los demás quedan apagados en gris.
 *
 * El magenta es el mismo `#ff2e88` del ícono de la app, a propósito.
 *
 * ── Las superficies ─────────────────────────────────────────────────────────
 *
 * Desde la 1.8.0 (29 oct 2026) NTX lleva la piel de Opal: una sola superficie
 * opaca (`base`) con la niebla, y encima hojas de vidrio en alfa. La nota de
 * PALETTE dice cómo; opal-skin.css hace el resto. Lo que sigue es la historia
 * de la etapa mate (ago–oct 2026): queda porque explica qué se probó.
 *
 * Llegó en dos pasos, los dos a pedido de Fran. El 20 ago 2026 el velo se fue de
 * la interfaz: `surface`, `sunk` y `chrome` pasaron de alfa a OPACOS porque la
 * cuadrícula del sustrato se veía a través de paneles y chrome, y la quería sólo
 * en el fondo desnudo (los gaps del grid). Son el mismo blanco al 1.9%/0.9%/1.4%
 * de siempre, aplanado sobre la base. Ese día el vidrio se replegó a los
 * overlays, que quedaron como último reducto.
 *
 * El 21 ago cayó el reducto: paleta, modales, búsqueda y tooltip, en ese orden.
 * `elevated` siguió el camino de los otros tres y además BAJÓ, porque mate no
 * alcanzaba si encima seguía siendo lo más claro de la pantalla — hoy vale lo
 * mismo que `surface` y la paleta se apoya al nivel del panel enfocado en vez de
 * flotar arriba de la escalera.
 *
 * ── Cómo se despega un overlay sin ser más claro ────────────────────────────
 *
 * Sin blur, un overlay se recorta con SOMBRA Y HAIRLINE. Los cuatro —paleta,
 * modales, búsqueda y tooltip— se apoyan en `elevated`, o sea al nivel del
 * panel, y ninguno se aclara ni se oscurece respecto de su fondo.
 *
 * Ese "ninguno" corrige una regla que vivió unas horas el mismo 21 ago: decía
 * que los overlays SIN scrim (búsqueda, tooltip) tenían que irse a `base`, un
 * peldaño por DEBAJO, porque nada les hundía el fondo y si se igualaban al panel
 * iban a desaparecer. No se sostuvo por dos lados. El peldaño eran 1,2 de L*,
 * apenas el umbral de discriminación — nunca fue el relleno lo que los separaba,
 * fue el contorno que los encierra y la sombra que empoza debajo. Y pedía un
 * relleno hundido abajo de una sombra proyectada hacia abajo, o sea pedirle a la
 * misma ficha que diga "floto" y "estoy enterrada" al mismo tiempo.
 *
 * Así que el scrim no elige peldaño. Elige otra cosa, y por eso sigue estando:
 * atenuar lo que el overlay tapa, para que el ojo no vuelva ahí.
 *
 * `hover` es el único que sigue en alfa, y no por vidrio: siempre pinta encima
 * de superficies ya opacas, así que necesita ser un realce y no un color.
 */
export interface Palette {
  /**
   * Fondo de la app: el piso de la escalera de superficies. Desde el 21 ago 2026
   * es sólo eso — ningún componente se apoya acá, ni siquiera los overlays sin
   * scrim, que hasta esa tarde lo usaban (ver la nota de arriba).
   *
   * Este valor está replicado en otros DOS lugares y los tres tienen que
   * coincidir: el `backgroundColor` de la BrowserWindow (src/main/window.ts) y el
   * `<style>` inline de src/renderer/index.html. Es lo que hace que el arranque no
   * tenga un solo frame claro, así que si cambia acá, cambia en los tres.
   */
  base: string
  /** El panel enfocado. */
  surface: string
  /** El panel SIN foco: un peldaño más abajo. */
  sunk: string
  /**
   * El chrome: titlebar, tab strip y status bar.
   *
   * Un peldaño entre `sunk` y `surface`: más claro que la base para despegarse
   * de ella, más callado que el panel enfocado para no competirle.
   */
  chrome: string
  /**
   * La superficie de TODOS los overlays: paleta, modales, búsqueda y tooltip.
   *
   * El nombre quedó de cuando era el vidrio más alto de la app. Hoy "elevado"
   * es la POSICIÓN, no el color: vale lo mismo que `surface`, y lo que separa un
   * overlay de su fondo son la sombra y el hairline, no ser más claro. Ni más
   * oscuro — la búsqueda y el tooltip lo intentaron unas horas el 21 ago 2026.
   *
   * No lo usa nada que se apoye en el chrome —la tab activa lo hacía y dejó de
   * hacerlo el 21 ago 2026, ver .ntx-tab[data-active]—: esto está aplanado sobre
   * la base, y sobre el chrome daría un color más oscuro que su propio hover.
   */
  elevated: string
  /** El realce de un elemento bajo el cursor. */
  hover: string
  /** Contorno de una superficie: el borde de los overlays y de la tab activa. */
  hairline: string
  /** Divisor interno, más callado. */
  hairlineSoft: string
  /**
   * El filo iluminado de arriba.
   *
   * Va bastante más alto que `hairline` porque no es un borde: es el filo de
   * arriba agarrando luz. Lo llevan los CUATRO overlays y nada más (paleta,
   * modales, búsqueda, tooltip) — la interfaz permanente lo perdió el 20 ago
   * 2026 junto con el blur.
   *
   * Sobrevivió al pase a mate del 21 ago, y ahí cambió de rol: era lo que hacía
   * leer la superficie como un canto de vidrio, y hoy es sencillamente el borde
   * superior del panel. Sin él un overlay no tiene techo — el hairline al 5,8%
   * no alcanza contra un scrim oscuro y difuso. Un realce de 1px al 7% es un
   * bisel, no un reflejo; lo que delataba al vidrio era el ver a través.
   */
  edgeLit: string

  fg: string
  muted: string
  dim: string
  faint: string
  ghost: string

  accent: string
  alt: string
  warn: string

  /** Los 16 ANSI, en el orden que espera xterm. */
  ansi: [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string
  ]
}

/* ── La piel Opal (1.8.0, 29 oct 2026) ───────────────────────────────────────
   La misma estructura de paleta de NTX, con los valores de la piel Opal
   (S:\tools\Opal\renderer\css\tokens.css) y, para la terminal, los de la
   terminal de Fran en UmbroSys (S:\tools\UmbroSys\renderer\js\piso\terminal.js).

   · base = --op-bg (#0a0a0a). Es la ÚNICA superficie opaca, como en Opal.
   · surface/sunk/chrome/elevated pasan a ALFAS de blanco (las hojas de Opal):
     surface = --op-s1 (la hoja de la shell, como .us-shells en UmbroSys),
     sunk = --op-s0, chrome = transparente (la titlebar, las pestañas y la status
     bar son aire sobre la niebla), elevated = --op-s3 (menú, modal, tooltip).
   · La escalera de texto de NTX tiene cinco peldaños y la de Opal cuatro:
     fg = --op-text, muted y dim = --op-text-2, faint y ghost = --op-text-3
     (el gris más bajo que todavía se lee; --op-text-4 queda para placeholders,
     en opal-skin.css).
   · Los tres acentos se quedan: son de cada SHELL (el prompt los recibe en
     NTX_ACCENT) y son los mismos de las shells de UmbroSys (cian, magenta,
     amarillo). El cromo, en cambio, no usa acento de color: eso lo resuelve
     opal-skin.css con el acento luz de Opal.
   · Los 16 ANSI son los de la terminal de UmbroSys (la paleta de Prism). */
export const PALETTE: Palette = {
  base: '#0a0a0a',
  surface: 'rgba(255,255,255,0.035)',
  sunk: 'rgba(255,255,255,0.022)',
  chrome: 'transparent',
  elevated: 'rgba(255,255,255,0.085)',
  hover: 'rgba(240,243,247,0.05)',
  hairline: 'rgba(255,255,255,0.055)',
  hairlineSoft: 'rgba(255,255,255,0.055)',
  edgeLit: 'rgba(255,255,255,0.10)',

  fg: '#ebebeb',
  muted: '#a8a8a8',
  dim: '#a8a8a8',
  faint: '#898989',
  ghost: '#898989',

  accent: '#00e5ff',
  alt: '#ff2e88',
  warn: '#ffe14d',

  ansi: [
    '#3a3a3e', '#ef6567', '#66d37a', '#f0c551',
    '#67a6fb', '#ce81e5', '#40d0df', '#cdcdd1',
    '#84848c', '#fe9b98', '#93e9a0', '#fcda86',
    '#9ec7fe', '#e5abf7', '#7de8f3', '#f4f4f6'
  ]
}

/** El objeto de tema que espera xterm, derivado de la paleta. */
export function xtermTheme(palette: Palette, paneAccent: string): ITheme {
  return {
    /**
     * TRANSPARENTE, y no `palette.surface`.
     *
     * El terminal no aporta fondo: lo pone el panel que lo contiene, que es
     * quien sabe si está enfocado (`surface`) o no (`sunk`). Si xterm pintara
     * el suyo encima, el interior del panel se quedaría clavado en un color
     * mientras el borde cambia con el foco.
     *
     * Cuando los paneles eran alfa el motivo era todavía más duro —el mismo
     * rgba aplicado dos veces aclaraba el interior contra su propio borde— y
     * eso se terminó el 20 ago 2026 con las superficies opacas. Pero la
     * conclusión no cambió, así que esto se queda.
     */
    background: '#00000000',
    // El texto de la terminal de UmbroSys (THEME.foreground).
    foreground: '#e8e8ea',
    // El cursor toma el acento del panel: es la señal más directa de cuál está
    // enfocado, sin tener que buscar el borde.
    cursor: paneAccent,
    // Es el color del texto TAPADO por el bloque del cursor, o sea que se dibuja
    // ENCIMA del acento. Va contra el acento, entonces, y no contra la superficie
    // del panel: tiene que ser oscuro porque el cursor es un cian o un magenta
    // prendido, no porque atrás haya tal o cual gris.
    // El de UmbroSys, como el texto de arriba y la selección de abajo.
    cursorAccent: '#161618',
    // La selección y la barra de scroll de la terminal de UmbroSys. El blanco
    // de la selección es el --op-select de Opal, el mismo `::selection` del
    // resto de la app: marcar texto se siente igual adentro y afuera.
    selectionBackground: 'rgba(240, 243, 247, 0.22)',
    selectionInactiveBackground: 'rgba(240, 243, 247, 0.12)',
    scrollbarSliderBackground: 'rgba(255, 255, 255, 0.10)',
    scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.20)',
    scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.28)',
    black: palette.ansi[0],
    red: palette.ansi[1],
    green: palette.ansi[2],
    yellow: palette.ansi[3],
    blue: palette.ansi[4],
    magenta: palette.ansi[5],
    cyan: palette.ansi[6],
    white: palette.ansi[7],
    brightBlack: palette.ansi[8],
    brightRed: palette.ansi[9],
    brightGreen: palette.ansi[10],
    brightYellow: palette.ansi[11],
    brightBlue: palette.ansi[12],
    brightMagenta: palette.ansi[13],
    brightCyan: palette.ansi[14],
    brightWhite: palette.ansi[15]
  }
}

/**
 * Mezcla dos hex #rrggbb: `t` es cuánto pesa `over` (0 = puro `under`).
 *
 * Existe porque las decoraciones de búsqueda de xterm exigen #RRGGBB opaco — no
 * aceptan rgba ni color-mix — así que el "acento con alfa sobre la base" hay que
 * dárselo ya aplanado. Vive acá por la misma regla que todo: los colores se
 * derivan de la paleta en un solo lugar.
 */
export function mixHex(over: string, under: string, t: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const mix = (i: number): string =>
    Math.round(channel(over, i) * t + channel(under, i) * (1 - t))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(0)}${mix(1)}${mix(2)}`
}

/**
 * Vuelca la paleta a variables CSS.
 *
 * Se llama de forma síncrona ANTES del primer render, así el chrome nunca se
 * pinta con colores a medio aplicar.
 */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement
  const vars: Record<string, string> = {
    base: palette.base,
    surface: palette.surface,
    sunk: palette.sunk,
    chrome: palette.chrome,
    elevated: palette.elevated,
    hover: palette.hover,
    hairline: palette.hairline,
    'hairline-soft': palette.hairlineSoft,
    'edge-lit': palette.edgeLit,
    fg: palette.fg,
    muted: palette.muted,
    dim: palette.dim,
    faint: palette.faint,
    ghost: palette.ghost,
    accent: palette.accent,
    alt: palette.alt,
    warn: palette.warn
  }
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(`--ntx-${name}`, value)
  }
  applyInk(palette)
}

/**
 * Le da a cada clase de color de xterm (`.xterm-fg-N`) su color también como
 * variable, `--ntx-ink`.
 *
 * Existe por el cursor. Con el bloque apagado, la letra de abajo tiene que
 * volver a SU color — el amarillo del prompt, el cian de una ruta — y no al
 * blanco genérico. Pero xterm le pisa el color a la celda del cursor con una
 * regla propia (`cursorAccent`), más fuerte que la de `.xterm-fg-N`, y desde
 * CSS no hay forma de pedir "el color que esta clase te habría dado". La
 * variable es esa forma: base.css la lee en la celda del cursor.
 *
 * Los colores truecolor no pasan por acá: xterm los pone como `style` inline,
 * que ya le gana a la regla del cursor sin ayuda.
 *
 * Son las 256 porque xterm usa clase para toda la paleta indexada: las 16 de
 * la paleta y las 240 restantes (16-255), que son fijas en todas las terminales
 * — el cubo 6×6×6 y la rampa de grises — y xterm las calcula igual.
 */
function applyInk(palette: Palette): void {
  const hex = (r: number, g: number, b: number): string =>
    '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
  const colors = [...palette.ansi]
  const levels = [0, 95, 135, 175, 215, 255]
  for (let i = 0; i < 216; i++) {
    colors.push(hex(levels[Math.floor(i / 36)]!, levels[Math.floor(i / 6) % 6]!, levels[i % 6]!))
  }
  for (let i = 0; i < 24; i++) {
    const c = 8 + i * 10
    colors.push(hex(c, c, c))
  }
  let style = document.getElementById('ntx-ink')
  if (!style) {
    style = document.createElement('style')
    style.id = 'ntx-ink'
    document.head.append(style)
  }
  style.textContent = colors.map((c, i) => `.xterm-fg-${i}{--ntx-ink:${c}}`).join('')
}

/**
 * El acento que le toca a un panel según su posición en el grid.
 *
 * Es lo que permite tener tres acentos chillones sin que se peleen: el panel
 * sólo enciende el suyo cuando tiene el foco, así que nunca hay más de uno
 * prendido. De paso responde "¿en cuál estaba escribiendo?" sin leer nada.
 *
 * Hoy sólo decide el color de una shell que llega sin uno propio (la sesión de
 * un agente viejo que no lo recuerda): las que nacen acá usan `freeAccent`.
 */
export function paneAccent(palette: Palette, index: number): string {
  return [palette.accent, palette.alt, palette.warn][index % 3]!
}

/**
 * El acento de una shell que nace: el primero de la terna que nadie tiene.
 *
 * El color es de la shell, no del lugar, porque el prompt lo recibe en
 * `NTX_ACCENT` al arrancar y no se puede cambiar después. Hasta la 1.6.1 salía
 * de la posición: cerrar la del medio corría la de la derecha un lugar, su
 * pestaña se volvía magenta y su prompt seguía amarillo.
 */
export function freeAccent(palette: Palette, taken: readonly string[]): string {
  const terna = [palette.accent, palette.alt, palette.warn]
  return terna.find((color) => !taken.includes(color)) ?? terna[taken.length % 3]!
}
