/** Si Windows pide movimiento reducido (Configuración → Accesibilidad → Efectos
 *  visuales → Efectos de animación). Se consulta en el momento: el usuario
 *  puede cambiarlo con la app abierta. */
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Lee un token de tiempo del CSS en el momento, ya resuelto (los var() de un
 *  custom property se sustituyen al computarlo). Así el movimiento que va por
 *  JS usa la misma curva que el CSS de la piel que esté puesta. */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** La curva de las entradas (--ntx-ease). */
export function ease(): string {
  return token('--ntx-ease', 'cubic-bezier(0.16, 1, 0.3, 1)')
}

/** La curva de los relevos y lo que va y vuelve (--ntx-ease-both). */
export function easeBoth(): string {
  return token('--ntx-ease-both', 'cubic-bezier(0.65, 0, 0.35, 1)')
}
