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
 * TODAS las superficies de NTX son mate y opacas. No queda vidrio en la app.
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

export const PALETTE: Palette = {
  /* Bajó de #08080a el 19 ago 2026, a pedido: el conjunto un paso más hundido.
     La niebla del sustrato bajó con él (ver .ntx-bg) — son las dos mitades del
     mismo movimiento. */
  base: '#050507',

  /* Opacos (20 ago 2026): blanco al 1.9% / 0.9% / 1.4% aplanado sobre #050507.
     Si la base cambia, estos tres se recalculan con ella. */
  surface: '#0a0a0c',
  sunk: '#070709',
  chrome: '#09090a',
  /* Opaco desde el 21 ago 2026, y ese mismo día bajado hasta acá: es el MISMO
     valor que `surface`, a propósito. Primero salió opaco en #0f0f11 (blanco al
     4%, el alfa que tenía de vidrio, aplanado sobre la base), pero eso lo dejaba
     como un escalón nuevo arriba de todo y la paleta seguía leyéndose como una
     tarjeta clara flotando. El pedido fue lo contrario: que esté al nivel de la
     terminal. Así que se apoya donde el panel enfocado y no inventa peldaño.

     Que duplique a `surface` no es un descuido — es la definición. Sigue siendo
     un token aparte porque el ROL es otro (la superficie de los overlays, no la
     del panel) y porque es la perilla única para moverla sin tocar los paneles.
     Si la base cambia, se recalcula igual que `surface`. */
  elevated: '#0a0a0c',
  hover: 'rgba(255,255,255,0.035)',
  hairline: 'rgba(255,255,255,0.058)',
  hairlineSoft: 'rgba(255,255,255,0.034)',
  /* El filo es lo que más delata al vidrio, así que es lo primero que baja
     cuando el efecto se quiere discreto: 0.22 → 0.14 → 0.105. Ese 0.105 era el
     piso para que la superficie se leyera COMO VIDRIO — pero el 19 ago 2026 el
     look pidió justamente menos vidrio (Fran: "bajale el efecto de luz"), así
     que bajó a propósito por debajo de aquel piso, junto con la niebla y el
     grano. La profundidad la siguen dando las sombras, que son la opción
     primaria de la casa; el canto quedó como un aliento, no como reflejo. */
  edgeLit: 'rgba(255,255,255,0.07)',

  /**
   * La escalera de énfasis.
   *
   * Los cuatro escalones de abajo se subieron el 18 ago 2026 porque no se leían:
   * medidos contra `base`, `faint` daba 2,3:1 y `ghost` 1,4:1, cuando el mínimo
   * de WCAG AA para texto chico es 4,5:1.
   *
   * Ahora, contra `base`: muted 9,7:1 · dim 6,6:1 · faint 5,1:1 · ghost 4,0:1.
   * `ghost` es el único que no llega a AA y es a propósito — sólo lo usan cosas
   * de las que uno no necesita enterarse (PIDs, contadores, atajos ya sabidos).
   *
   * Esos números son los REALES desde el 21 ago 2026. Antes acá había un caveat
   * —"el número real es peor todavía, porque este texto no se apoya sobre `base`
   * pelado sino sobre el vidrio, que aclara el fondo"— que murió con el vidrio.
   * Hoy el peor fondo posible para este texto es `surface`/`elevated` (#0a0a0c),
   * apenas por encima de `base`, y ahí la escalera baja una décima: faint 5,0:1
   * y ghost 3,9:1. Ese peor caso es además el caso NORMAL desde la tarde del 21
   * ago: con la búsqueda y el tooltip mudados a `elevated`, ya no queda texto de
   * chrome apoyado sobre `base` pelado. Tomá la línea de arriba como el techo y
   * estas dos cifras como lo que se mide en pantalla.
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
   *
   * El par azul (4 y 12) es el único bright que NO es pastel, desde el 19 ago
   * 2026: el 12 es el color de los directorios en `ls` (bold+azul, y xterm manda
   * bold a bright), y en lavanda claro se veía lavado. Se fueron los dos a
   * índigo profundo — el piso lo pone AA contra `base` (4,6:1 y 5,7:1), así que
   * más oscuros que esto no pueden ir.
   */
  ansi: [
    // El 0 y el 8 también subieron por legibilidad. El 8 (brightBlack) es el que
    // más se nota: es con el que casi toda CLI pinta comentarios, hashes cortos
    // y archivos ocultos, así que a 2,3:1 media salida quedaba ilegible.
    '#3d3d46', '#ff4d6a', '#2ff2a6', '#ffe14d',
    '#5569ff', '#ff2e88', '#00e5ff', '#c8c8cf',
    '#70707c', '#ff7d90', '#6ff7c2', '#ffec8f',
    '#6d7dff', '#ff6cad', '#7ff2ff', '#ececef'
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
    foreground: palette.fg,
    // El cursor toma el acento del panel: es la señal más directa de cuál está
    // enfocado, sin tener que buscar el borde.
    cursor: paneAccent,
    // Es el color del texto TAPADO por el bloque del cursor, o sea que se dibuja
    // ENCIMA del acento. Va contra el acento, entonces, y no contra la superficie
    // del panel: tiene que ser oscuro porque el cursor es un cian o un magenta
    // prendido, no porque atrás haya tal o cual gris.
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
