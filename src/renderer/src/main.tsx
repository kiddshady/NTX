import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PALETTE, applyPalette } from './term/themes'
import { TERMINAL_FAMILIES, loadTerminalFont } from './term/fonts'
import { initUiFont } from './term/uiFont'
// La piel Opal: sus tokens antes de base.css, y la piel después, que repinta
// las clases ntx-* sin tocar los componentes.
import './styles/opal-tokens.css'
import './styles/base.css'
import './styles/opal-skin.css'

// La paleta se aplica ANTES del primer render, de forma síncrona. Si esperáramos
// al efecto de App, habría un frame pintado con las variables CSS vacías — o sea
// un destello de chrome sin color justo en el arranque.
applyPalette(PALETTE)
// Y la letra mono de la interfaz, por lo mismo: con Roboto elegida, el
// primer cuadro no puede salir en JetBrains (ver term/uiFont.ts).
initUiFont(loadTerminalFont())

const root = document.getElementById('root')
if (!root) throw new Error('Falta #root en index.html')

// Todas las caras de la terminal se cargan antes de que exista la primera. xterm
// mide el ancho de cada carácter la primera vez que lo ve y lo cachea hasta que
// cambie la fuente: si lo mide mientras su cara todavía está cargando, lo mide
// con el respaldo y le corrige el ancho con letter-spacing para siempre. Pasó
// con el ⏵⏵ del modo auto de Claude Code: sale de Noto Sans Symbols 2 (586/1000
// em), se medía con Segoe UI Symbol (1 em) y le tocaban -5px por glifo, así que
// los dos triángulos quedaban uno encima del otro y el texto de al lado corrido.
// Sólo en el panel que lo mostraba primero, y el zoom lo arreglaba porque limpia
// esa caché. Lo mismo valía para el emoji, los bloques y las itálicas: por eso
// van todas las caras y no un carácter de muestra. Son archivos locales: tarda
// milisegundos. Las dos letras de la terminal, también la que no está elegida:
// cambiar con Ctrl+Shift+L no tiene que medir nada a medio cargar.
const families = new Set(TERMINAL_FAMILIES)
const fontsReady = Promise.all(
  [...document.fonts]
    .filter((face) => families.has(face.family.replace(/["']/g, '')))
    // Una cara que falte (Segoe UI Emoji en el celu) no frena a las demás.
    .map((face) => face.load().catch(() => {}))
)

void fontsReady.then(() => {
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
