import { useEffect, useRef, useState } from 'react'

interface Presence {
  /** Si hay que renderizar el nodo (incluye el rato en que se está yendo). */
  mounted: boolean
  /** Si está corriendo la animación de salida. */
  closing: boolean
}

/**
 * Mantiene un nodo montado hasta que termina su animación de salida.
 *
 * En React lo más fácil de olvidar es justamente esto: entrar con animación sale
 * gratis, pero al desmontar el nodo se va del DOM en el mismo frame y la salida
 * nunca llega a verse. Un overlay que se cierra de golpe se siente roto aunque
 * haya entrado con la transición más linda del mundo.
 */
export function usePresence(open: boolean, exitMs: number): Presence {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)

    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }

    if (!mounted) return

    setClosing(true)
    timer.current = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, exitMs)

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [open, exitMs, mounted])

  return { mounted, closing }
}
