/** Si Windows pide movimiento reducido (Configuración → Accesibilidad → Efectos
 *  visuales → Efectos de animación). Se consulta en el momento: el usuario
 *  puede cambiarlo con la app abierta. */
export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
