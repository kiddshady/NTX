import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PALETTE, applyPalette } from './term/themes'
import './styles/base.css'

// La paleta se aplica ANTES del primer render, de forma síncrona. Si esperáramos
// al efecto de App, habría un frame pintado con las variables CSS vacías — o sea
// un destello de chrome sin color justo en el arranque.
applyPalette(PALETTE)

const root = document.getElementById('root')
if (!root) throw new Error('Falta #root en index.html')

// Los emojis se cargan antes de que exista la primera terminal. xterm mide el
// ancho de cada carácter la primera vez que lo ve y lo cachea: si el primer
// emoji se midiera con el respaldo (Segoe a tamaño completo, ver fonts.css),
// quedaría corrido para siempre. Son fuentes locales: tarda milisegundos.
const emojiReady = Promise.all([
  document.fonts.load(`13px 'JetBrains Mono'`, '😀'),
  document.fonts.load(`700 13px 'JetBrains Mono'`, '😀')
]).catch(() => {})

void emojiReady.then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )

  // El div de arranque se va recién cuando React ya pintó. El doble rAF garantiza
  // eso: el primero corre antes del paint del commit, el segundo después.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const boot = document.getElementById('boot')
      if (!boot) return
      boot.style.opacity = '0'
      boot.addEventListener('transitionend', () => boot.remove(), { once: true })
      // Red de seguridad por si la transición no dispara (ventana en background).
      window.setTimeout(() => boot.remove(), 500)
    })
  )
})
