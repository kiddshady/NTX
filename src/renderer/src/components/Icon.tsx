import type { JSX } from 'react'

/**
 * El único lugar donde NTX dibuja símbolos.
 *
 * Ni un emoji ni un glifo unicode decorativo en toda la interfaz: cada uno se
 * renderiza distinto según el sistema y la fuente, no se le puede controlar el
 * peso ni la alineación, y rompe el trazo del resto. Un SVG propio se tiñe con
 * `currentColor`, se alinea al pixel y es idéntico en cualquier máquina.
 *
 * (Adentro de la terminal es otra cosa: ahí los glifos son la SALIDA del shell,
 * contenido real que no nos toca tocar.)
 */

export type IconName =
  | 'grid'
  | 'plus'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'chevron'
  | 'branch'
  | 'terminal'
  | 'caret'
  | 'swatch'
  | 'eraser'
  | 'shell'
  | 'duplicate'
  | 'folder'
  | 'skull'
  | 'search'
  | 'arrowUp'
  | 'arrowDown'
  | 'list'
  | 'info'
  | 'clipboard'
  | 'download'

/** Trazos de 24×24, todos con el mismo grosor para que convivan. */
const PATHS: Record<IconName, JSX.Element> = {
  // Los cuatro cuadraditos: la marca de la paleta de comandos.
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // Los tres de la ventana, con los símbolos de siempre: la raya, el cuadrado y
  // la cruz. Dibujados y no tomados de una fuente de íconos, como todo el resto.
  minimize: <path d="M5 12h14" />,
  maximize: <rect x="5" y="5" width="14" height="14" rx="2" />,
  // Restaurar: dos cuadrados encimados. El de atrás se dibuja incompleto a
  // propósito — las dos líneas que le faltan son justo las que taparía el de
  // adelante, y así no queda un cruce de trazos en el medio.
  restore: (
    <>
      <rect x="4" y="9" width="11" height="11" rx="2" />
      <path d="M8 4.5h9.5a2.5 2.5 0 0 1 2.5 2.5V16" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  // Git: dos commits y una rama que sale del tronco.
  branch: (
    <>
      <circle cx="6" cy="5" r="2.4" />
      <circle cx="6" cy="19" r="2.4" />
      <circle cx="18" cy="7" r="2.4" />
      <path d="M6 7.4v9.2M18 9.4c0 5-12 2.4-12 7.2" />
    </>
  ),
  // El prompt clásico: el corner y el chevron.
  terminal: (
    <>
      <path d="M4 6l6 6-6 6" />
      <path d="M13 18h7" />
    </>
  ),
  caret: <path d="M9 5l8 7-8 7z" fill="currentColor" stroke="none" />,
  swatch: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </>
  ),
  eraser: (
    <>
      <path d="M8 18l-4-4 9-9 4 4-9 9z" />
      <path d="M10 20h10" />
    </>
  ),
  shell: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 10l3 2.5L7 15" />
    </>
  ),
  // Duplicar shell: dos ventanas encimadas, la de adelante con su prompt. El
  // truco de la de atrás es el mismo de `restore`: se dibuja incompleta a
  // propósito — le faltan justo los trazos que la de adelante taparía, y así
  // no queda ningún cruce en el medio.
  duplicate: (
    <>
      <rect x="4" y="9" width="13" height="11" rx="2" />
      <path d="M7.5 12.5l2.8 2.2-2.8 2.2" />
      <path d="M8.5 4.5H19a2.5 2.5 0 0 1 2.5 2.5V15.5" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  // El shell que se murió.
  skull: (
    <>
      <path d="M5 11a7 7 0 1 1 14 0v3.5a2 2 0 0 1-1.3 1.9L17 17v2a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2l-.7-.6A2 2 0 0 1 5 14.5z" />
      <circle cx="9.3" cy="11.2" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="11.2" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  // La lupa del campo de la paleta.
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4 21 21" />
    </>
  ),
  // Las dos flechas del pie de la paleta. Van como SVG y no como ↑↓ por la
  // misma razón que todo el resto: un glifo unicode se renderiza distinto en
  // cada máquina y no se le puede controlar el trazo.
  arrowUp: (
    <>
      <path d="M12 19V6" />
      <path d="M6.5 11.5 12 5.5l5.5 6" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 5v13" />
      <path d="M6.5 12.5 12 18.5l5.5-6" />
    </>
  ),
  // La lista de comandos con sus bullets: el chip de la paleta. Le ganó al rayo,
  // a la tecla y al slash porque es literalmente lo que la paleta ES.
  list: (
    <>
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 7H20M9.5 12H20M9.5 17H20" />
    </>
  ),
  // El punto de la i va relleno: a 13px un circulito de trazo se empasta.
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.2v4.6" />
      <circle cx="12" cy="7.9" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  // Copiar scrollback: la tablita con su clip. El borde de arriba se dibuja con
  // un hueco donde se apoya el clip — mismo criterio que `restore`: ningún
  // trazo cruza a otro.
  clipboard: (
    <>
      <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="2.5" width="6" height="3.5" rx="1.2" />
      <path d="M9 11h6M9 15h6" />
    </>
  ),
  // Guardar scrollback: la flecha que baja a la bandeja.
  download: (
    <>
      <path d="M12 3.5V14" />
      <path d="M7.5 9.5 12 14l4.5-4.5" />
      <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>
  )
}

interface IconProps {
  name: IconName
  /** Lado del cuadrado, en px. */
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 14, strokeWidth = 1.7, className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Es decoración: el nombre accesible lo pone el control que lo contiene.
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  )
}
