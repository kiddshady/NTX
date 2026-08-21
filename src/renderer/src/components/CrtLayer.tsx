import { useLayoutEffect, useRef, type JSX } from 'react'

/**
 * El vidrio CRT: scanlines sobre la ventana COMPLETA, modales incluidos.
 *
 * El div es todo el efecto (el look vive en `.ntx-crt`, en base.css); lo que
 * este componente aporta es el calce a píxel físico. Un período de 3px CSS cae
 * fraccionario en device pixels con el escalado de Windows (125% → 3.75), el
 * antialiasing reparte ese resto en líneas gordas y finas alternadas, y cada
 * tantas se percibe una banda — moiré. Acá se redondea el período al entero
 * físico más cercano y se publica en px CSS vía custom properties: el gradiente
 * pisa siempre píxeles enteros y todas las líneas salen idénticas.
 *
 * Se recalcula al cambiar de monitor: el matchMedia de resolución deja de
 * matchear cuando el DPR cambia, avisa una vez, y se rearma contra el nuevo.
 */
export function CrtLayer(): JSX.Element {
  const node = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = node.current
    if (!el) return

    let cleanup: (() => void) | undefined

    const arm = (): void => {
      const dpr = window.devicePixelRatio || 1
      // ~3px CSS de período y ~un tercio de línea, los dos en enteros físicos.
      const periodDp = Math.max(2, Math.round(3 * dpr))
      const lineDp = Math.max(1, Math.round(periodDp / 3))
      el.style.setProperty('--ntx-crt-period', `${periodDp / dpr}px`)
      el.style.setProperty('--ntx-crt-line', `${lineDp / dpr}px`)

      const media = window.matchMedia(`(resolution: ${dpr}dppx)`)
      const onChange = (): void => {
        media.removeEventListener('change', onChange)
        arm()
      }
      media.addEventListener('change', onChange)
      cleanup = () => media.removeEventListener('change', onChange)
    }

    arm()
    return () => cleanup?.()
  }, [])

  return <div ref={node} className="ntx-crt" aria-hidden="true" />
}
