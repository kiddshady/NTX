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
 * ── Las superficies son VIDRIO ──────────────────────────────────────────────
 *
 * `surface`, `sunk`, `chrome`, `elevated` y `hover` NO son colores opacos: son
 * blancos con alfa que se apoyan sobre el sustrato y se completan con el
 * `backdrop-filter` que les pone base.css. En clave oscura el vidrio se define
 * por el canto iluminado (`edgeLit`) y la sombra, no por el relleno — si se
 * sube el relleno para "verlo mejor", se aclara a gris y deja de ser vidrio.
 */
export interface Palette {
  /**
   * Fondo de la app: el sustrato sobre el que se apoya todo el vidrio.
   *
   * Este valor está replicado en otros DOS lugares y los tres tienen que
   * coincidir: el `backgroundColor` de la BrowserWindow (src/main/window.ts) y el
   * `<style>` inline de src/renderer/index.html. Es lo que hace que el arranque no
   * tenga un solo frame claro, así que si cambia acá, cambia en los tres.
   */
  base: string
  /** Vidrio del panel enfocado. */
  surface: string
  /** Vidrio del panel SIN foco: un peldaño más abajo. */
  sunk: string
  /**
   * Vidrio del chrome: titlebar, tab strip y status bar.
   *
   * Más tenue que `surface`, no más oscuro. Con superficies opacas el chrome se
   * despegaba hundiéndose por debajo del `base`; con vidrio se despega dejando
   * pasar más sustrato, y los paneles quedan flotando por encima igual.
   */
  chrome: string
  /** Vidrio elevado: paleta de comandos, tab activa. */
  elevated: string
  /** El realce de un elemento bajo el cursor. */
  hover: string
  /** Contorno del vidrio. */
  hairline: string
  /** Divisor interno, más callado. */
  hairlineSoft: string
  /**
   * El filo iluminado de arriba.
   *
   * Es lo que hace que una superficie se lea como un canto de vidrio y no como
   * un rectángulo gris con opacidad. Va bastante más alto que `hairline`: es un
   * reflejo, no un borde.
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

export const PALETTE: Palette = {
  base: '#08080a',

  surface: 'rgba(255,255,255,0.019)',
  sunk: 'rgba(255,255,255,0.009)',
  chrome: 'rgba(255,255,255,0.014)',
  elevated: 'rgba(255,255,255,0.04)',
  hover: 'rgba(255,255,255,0.035)',
  hairline: 'rgba(255,255,255,0.058)',
  hairlineSoft: 'rgba(255,255,255,0.034)',
  /* El filo es lo que más delata al vidrio, así que es lo primero que baja
     cuando el efecto se quiere discreto: venía de 0.22, pasó por 0.14 y quedó
     acá. Éste es el PISO — por debajo de ~0.10 la superficie deja de leerse
     como canto y vuelve a ser un rectángulo gris con opacidad, que es
     exactamente el anti-patrón del que veníamos. Si hace falta atenuar más,
     bajar la niebla del sustrato, no esto. */
  edgeLit: 'rgba(255,255,255,0.105)',

  /**
   * La escalera de énfasis.
   *
   * Los cuatro escalones de abajo se subieron el 18 ago 2026 porque no se leían:
   * medidos contra `base`, `faint` daba 2,3:1 y `ghost` 1,4:1, cuando el mínimo
   * de WCAG AA para texto chico es 4,5:1. Y el número real es peor todavía,
   * porque este texto no se apoya sobre `base` pelado sino sobre el vidrio, que
   * aclara el fondo y achica la diferencia.
   *
   * Ahora, contra `base`: muted 9,7:1 · dim 6,6:1 · faint 5,1:1 · ghost 4,0:1.
   * `ghost` es el único que no llega a AA y es a propósito — sólo lo usan cosas
   * de las que uno no necesita enterarse (PIDs, contadores, atajos ya sabidos).
   *
   * Subir estos NO es lo mismo que aclarar la app: el fondo sigue casi negro y
   * el blanco pleno sigue reservado para `fg`.
   */
  fg: '#ececef',
  muted: '#b4b4be',
  dim: '#93939e',
  faint: '#7f7f8a',
  ghost: '#6e6e7a',

  accent: '#00e5ff',
  alt: '#ff2e88',
  warn: '#ffe14d',

  /**
   * Los 16 ANSI.
   *
   * Acá la disciplina de "sólo tres colores" NO aplica: estos los pide el
   * programa que corre adentro de la shell, no los elegimos nosotros. `ls`
   * quiere su verde y `git` su rojo, y negárselos rompe la salida.
   *
   * Lo que sí hacemos es traerlos a la misma temperatura fría que el resto y
   * anclar en su valor exacto los tres que son de la terna:
   *
   *   3 yellow = warn      5 magenta = alt      6 cyan = accent
   *
   * El rojo (1) se separa a propósito del magenta hacia el coral: si fueran
   * vecinos, en un `git status` no se distinguiría un archivo borrado de uno
   * modificado. El azul (4) tira a violeta por lo mismo, para no pisarse con el
   * cian.
   */
  ansi: [
    // El 0 y el 8 también subieron por legibilidad. El 8 (brightBlack) es el que
    // más se nota: es con el que casi toda CLI pinta comentarios, hashes cortos
    // y archivos ocultos, así que a 2,3:1 media salida quedaba ilegible.
    '#3d3d46', '#ff4d6a', '#2ff2a6', '#ffe14d',
    '#5b7cff', '#ff2e88', '#00e5ff', '#c8c8cf',
    '#70707c', '#ff7d90', '#6ff7c2', '#ffec8f',
    '#8fa4ff', '#ff6cad', '#7ff2ff', '#ececef'
  ]
}

/** El objeto de tema que espera xterm, derivado de la paleta. */
export function xtermTheme(palette: Palette, paneAccent: string): ITheme {
  return {
    /**
     * TRANSPARENTE, y no `palette.surface`.
     *
     * El panel ya es una superficie de vidrio con su `backdrop-filter`. Si xterm
     * pintara su propio fondo encima —aunque fuese el mismo rgba— lo estaría
     * duplicando: el alfa se aplicaría dos veces y el interior del panel
     * quedaría más claro que su propio borde. El terminal no aporta fondo; lo
     * pone el panel que lo contiene.
     */
    background: '#00000000',
    foreground: palette.fg,
    // El cursor toma el acento del panel: es la señal más directa de cuál está
    // enfocado, sin tener que buscar el borde.
    cursor: paneAccent,
    // Es el color del texto TAPADO por el cursor, así que va contra el acento y
    // no contra la superficie: sobre vidrio transparente, `surface` no tapa nada.
    cursorAccent: palette.base,
    // El resaltado de selección es el mismo tinte que el `::selection` del resto
    // de la app, para que marcar texto se sienta igual adentro y afuera.
    selectionBackground: `${palette.accent}44`,
    selectionForeground: palette.fg,
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
}

/**
 * El acento que le toca a un panel según su posición en el grid.
 *
 * Es lo que permite tener tres acentos chillones sin que se peleen: el panel
 * sólo enciende el suyo cuando tiene el foco, así que nunca hay más de uno
 * prendido. De paso responde "¿en cuál estaba escribiendo?" sin leer nada.
 *
 * Con cuatro paneles, el primero y el cuarto comparten el cian. Es a propósito:
 * son tres colores para cuatro lugares, y sumar un cuarto acento para tapar eso
 * rompería justamente la regla que hace que el sistema funcione.
 */
export function paneAccent(palette: Palette, index: number): string {
  return [palette.accent, palette.alt, palette.warn][index % 3]!
}
