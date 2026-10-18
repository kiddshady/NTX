import { useRef } from 'react'

/**
 * Los mismos ítems, pero en el orden en que fueron llegando: los que siguen
 * quedan donde estaban, los nuevos van al final y los que se fueron salen.
 *
 * Es para renderizar una lista que se puede reordenar SIN mover sus nodos. React
 * reordena con `insertBefore`, que saca el nodo y lo vuelve a poner: eso le
 * reinicia las animaciones de CSS (la tab se volvía a desplegar desde ancho cero)
 * y a un xterm le resetea el scroll. Con esto el DOM queda quieto y el orden que
 * se ve lo pone el CSS (`order` en un flex).
 */
export function useStableOrder<T extends { id: string }>(items: T[]): T[] {
  const order = useRef<string[]>([])
  const byId = new Map(items.map((item) => [item.id, item]))
  const kept = order.current.filter((id) => byId.has(id))
  for (const item of items) if (!kept.includes(item.id)) kept.push(item.id)
  order.current = kept
  return kept.map((id) => byId.get(id)!)
}
