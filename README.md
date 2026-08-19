# NTX

Terminal multi-shell para Windows: una grilla adaptable de hasta cuatro shells
conviviendo en una sola ventana de vidrio oscuro.

- **Multi-shell de verdad** — PowerShell 7, Windows PowerShell, Git Bash, WSL y
  cmd, detectados solos; cada panel corre el suyo con su cwd y su branch de git
  a la vista.
- **Grilla adaptable** — de 1 a 4 paneles que se reacomodan solos, cada uno con
  su acento (cian, magenta, amarillo) que se enciende únicamente con el foco.
- **Estética acromática** — grises de verdad, superficies de vidrio, y el color
  reservado para significar, no para decorar. Sin modo claro, a mucha honra.
- **Paleta de comandos** — `Ctrl K` para abrir shells, saltar entre paneles y
  todo lo demás, tipeando iniciales.
- **Vive en el tray** — cerrar esconde, `Ctrl Alt X` la trae de vuelta al
  instante con los shells intactos.
- **Se actualiza sola** — escanea estos releases, descarga en silencio y avisa
  recién cuando sólo falta reiniciar.

## Instalación

Bajá `NTX-Setup-x.y.z.exe` del [último release](https://github.com/kiddshady/NTX/releases/latest)
y listo: de ahí en adelante se mantiene al día sola. También hay un
`NTX-x.y.z-portable.exe` sin instalador (ese no se auto-actualiza).

## Desarrollo

```
npm install
npm run dev        # electron-vite con hot reload
npm run dist:nsis  # instalador NSIS en dist/
```

Electron 40 · React 19 · xterm 6 · node-pty · TypeScript

## Licencia

[MIT](LICENSE) © 2026 Kidd Shady · Umbrovex Systems
