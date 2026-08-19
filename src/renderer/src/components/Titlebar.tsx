import { useEffect, useState, type JSX } from 'react'
import { Icon } from './Icon'

interface TitlebarProps {
  onOpenPalette: () => void
  onOpenAbout: () => void
}

export function Titlebar({ onOpenPalette, onOpenAbout }: TitlebarProps): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  // El main avisa cuando la ventana cambia de estado, y no sólo cuando el cambio
  // salió de este botón: maximizar arrastrando contra el borde, con Win+flecha o
  // con doble click en la barra tiene que dejar el ícono igual de al día.
  useEffect(() => window.ntx.window.onMaximizeChange(setMaximized), [])

  return (
    <header className="ntx-titlebar ntx-chrome">
      {/* La paleta va del lado opuesto a los botones de ventana: pegada a ellos
          quedaría un click de distancia del de cerrar. */}
      <button className="ntx-chip" onClick={onOpenPalette} data-tip="Command palette">
        <Icon name="list" size={12} strokeWidth={1.8} />
        <span>Palette</span>
        <span className="ntx-chip__key">Ctrl K</span>
      </button>

      {/* El about vive acá y no en la status bar: es chrome de la app, no estado
          de la sesión. Y lejos del trío de ventana, como el chip. */}
      <button className="ntx-winbtn" data-tip="About NTX" aria-label="About NTX" onClick={onOpenAbout}>
        <Icon name="info" size={13} strokeWidth={1.6} />
      </button>

      {/* Los de ventana, a la derecha y en el orden de Windows: minimizar,
          maximizar/restaurar, cerrar. */}
      <div className="ntx-titlebar__controls">
        <button
          className="ntx-winbtn"
          data-tip="Minimize"
          aria-label="Minimize"
          onClick={() => window.ntx.window.minimize()}
        >
          <Icon name="minimize" size={13} strokeWidth={1.6} />
        </button>

        <button
          className="ntx-winbtn"
          data-tip={maximized ? 'Restore' : 'Maximize'}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => window.ntx.window.toggleMaximize()}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={13} strokeWidth={1.6} />
        </button>

        {/* El único destructivo del trío, y el único que se tiñe: en hover toma el
            color de alerta para que no se confunda con sus vecinos. */}
        <button
          className="ntx-winbtn"
          data-danger="true"
          data-tip="Close"
          aria-label="Close"
          onClick={() => window.ntx.window.close()}
        >
          <Icon name="close" size={13} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  )
}
