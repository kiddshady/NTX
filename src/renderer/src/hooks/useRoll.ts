import { useEffect, useRef, useState } from 'react'

/** Lo que tarda en llegar al valor nuevo. Menos que el segundo entre datos:
 *  cada número llega, se asienta, y recién después viene el próximo. */
const ROLL_MS = 420

/**
 * Un número que corre hasta su valor nuevo desde el que se VE, en vez de saltar.
 * Si llega otro dato a mitad de carrera, la retoma desde donde iba.
 *
 * El primer valor se muestra tal cual: el primer llenado no es un cambio.
 */
export function useRoll(target: number): number {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  shownRef.current = shown

  useEffect(() => {
    const from = shownRef.current
    if (from === target) return
    const start = performance.now()
    let frame = 0
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / ROLL_MS)
      // cubic-out: arranca rápido y se asienta.
      const eased = 1 - (1 - t) ** 3
      setShown(Math.round(from + (target - from) * eased))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])

  return shown
}
