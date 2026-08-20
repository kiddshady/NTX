# NTX

Terminal multi-shell para Windows, con grid adaptativo y estética acromática
mate, oscura y plana. Electron + xterm.js + node-pty.

## Qué hace

- **Hasta cuatro shells a la vez, en un grid que se acomoda solo.** Una ocupa
  toda la ventana; dos van lado a lado; con tres, la última toma el ancho
  completo abajo; cuatro caen en 2×2. Nunca queda un hueco vacío.
- **Un perfil por panel.** Detecta lo que hay instalado en la máquina —
  PowerShell 7, Windows PowerShell, cmd, Git Bash y WSL — y ofrece sólo eso: un
  perfil cuyo ejecutable no existe es peor que no ofrecerlo.
- **Tres acentos con rol fijo** —cian, magenta, amarillo— sobre grises de
  verdad. Cada panel tiene el suyo y lo enciende únicamente cuando tiene el
  foco: nunca hay dos colores prendidos a la vez.
- **Paleta de comandos** (el botón de la lista, arriba a la izquierda) con
  filtro por subsecuencia: `nsp` encuentra «New shell · PowerShell». Abre
  shells, salta entre paneles y muestra el About. Sin atajo, a propósito: es un
  menú, y las teclas son del shell.
- **Búsqueda en el scrollback** (`Ctrl Shift F`, o desde la paleta). La barra
  flota en el panel activo y resalta todos los matches con su acento: filtra
  mientras tipeás, Enter y Shift Enter saltan entre resultados, `Aa` exige
  mayúsculas exactas, y Esc la cierra devolviéndole el teclado al shell.
- **Status bar con datos reales**: CPU y memoria del sistema, el directorio de la
  shell activa y su branch de git.
- **Vive en el tray.** Cerrar esconde en vez de matar, y `Ctrl Alt X` la trae de
  vuelta al instante con los shells intactos.
- **La escena sobrevive al reinicio.** NTX recuerda qué paneles había, con qué
  shell y paradas en qué carpeta, y al arrancar vuelve a montar exactamente ese
  grid — foco incluido. Lo único que no vuelve es el contenido: esos procesos
  murieron con el reboot.
- **Avisa cuando un comando largo termina.** Si tardó más de seis segundos y no
  estabas mirando ese panel, su tab late con su acento hasta que vuelvas; y si
  la ventana está en el tray o detrás de otra, llega además una notificación de
  Windows —silenciosa— cuyo click te deja parado en ese panel. Funciona en
  PowerShell, Git Bash y WSL vía OSC 133; cmd no tiene dónde colgar la marca.
- **Se actualiza sola.** Escanea los releases de este repo, descarga en silencio
  y avisa recién cuando sólo falta reiniciar. La versión y el escaneo manual
  viven en el About (el ícono de info de la titlebar).

## Instalación

Bajá `NTX-Setup-x.y.z.exe` del
[último release](https://github.com/kiddshady/NTX/releases/latest): de ahí en
adelante se mantiene al día sola. También sale un `NTX-x.y.z-portable.exe` sin
instalador — ese no se auto-actualiza.

## Atajos

| Atajo | Qué hace |
|---|---|
| `Ctrl 1`–`Ctrl 4` | Enfoca esa shell |
| `Ctrl Shift T` | Nueva shell |
| `Ctrl Shift W` | Cierra la shell activa |
| `Ctrl Shift F` | Busca en el scrollback de la shell activa |
| `Ctrl Shift C` / `Ctrl Shift V` | Copiar y pegar |
| `Ctrl C` | Copia si hay selección; si no, sigue siendo la interrupción |
| `Ctrl +` / `Ctrl -` / `Ctrl 0` | Zoom del texto (también `Ctrl` + rueda); se recuerda |
| `Ctrl Alt X` | Global: muestra y esconde la ventana desde cualquier lado |

Los atajos de la app van con `Shift` justamente para no pisarle nada al shell:
`Ctrl+T` y `Ctrl+W` son de PSReadLine, y `Ctrl+K` es kill-line en nano, bash y
el propio prompt — por eso la paleta ni siquiera tiene atajo: se abre con su
botón y las teclas quedan para la terminal, que para eso es una.

## Arrancar

```bash
npm install
npm run dev
```

`npm install` compila `node-pty` contra Electron, así que necesita **Visual
Studio Build Tools** (workload «Desarrollo de escritorio con C++») y **Python**.
El postinstall se encarga de dos trampas conocidas de Windows — están explicadas
en [`scripts/postinstall.cjs`](scripts/postinstall.cjs).

## Empaquetar

```bash
npm run dist
```

Salen un instalador NSIS y un portable en `dist/`.

## Cómo está armado

```
src/
  main/                  Proceso principal: ventana, ptys, perfiles, git, stats
    index.ts             Arranque, IPC y CSP de producción
    window.ts            La ventana, con el método anti-flash
    pty.ts               Los ptys vivos (node-pty sobre ConPTY)
    profiles.ts          Detección de shells instaladas
    git.ts               Branch del cwd, cacheado
    stats.ts             CPU y memoria del sistema
    session.ts           La escena que se recuerda entre arranques
    updater.ts           Auto-update desde los releases de GitHub
    shell-init/          Lo que se le inyecta a cada shell
      ntx-init.ps1       UTF-8 + OSC 7 y 133 para PowerShell
      ntx-init.sh        OSC 7 y 133 para bash (Git Bash y WSL)
  preload/               El puente al renderer, con contextIsolation
  shared/types.ts        Los tipos que cruzan los tres lados
  renderer/src/
    App.tsx              Estado de paneles, atajos y comandos
    components/          Titlebar, TabStrip, TerminalPane, StatusBar, paleta…
    term/themes.ts       La paleta — fuente única para el CSS y para xterm
    lib/                 ptyBus, estado de paneles, preferencias
    styles/base.css      El sistema visual
```

### Tres decisiones que conviene no deshacer

**El renderer DOM de xterm, no el de WebGL.** El WebGL rasteriza los glifos a un
atlas de textura y ahí recorta las itálicas: la sugerencia inline de PSReadLine
termina renderizada como un subíndice.

**JetBrains Mono en TTF completo, no en un woff2 subseteado.** El subset se come
box drawing y block elements, y sin esos glifos cualquier TUI —btop, lazygit,
fzf— se dibuja con los marcos rotos. Va junto a Noto Sans Symbols 2, que aporta
los spinners braille.

**Electron pineado en 40.10.2.** Al restaurar la ventana, el compositor de
Windows pinta un frame fantasma. Electron 33 y anteriores lo pintan blanco y no
hay CSS que lo tape; Electron 40 lo tiñe con el `backgroundColor` de la ventana.
De ahí también que ese color, el del `<style>` inline de `index.html` y
`--ntx-base` tengan que ser el mismo `#050507`.

## Licencia

NTX es MIT — ver [LICENSE](LICENSE).

Las tipografías **no** son MIT: las tres van bajo la
[SIL Open Font License 1.1](https://scripts.sil.org/OFL), cuyos términos viajan
con los archivos en `src/renderer/src/assets/fonts/`.

| Fuente | Copyright | Licencia |
|---|---|---|
| JetBrains Mono | 2020 The JetBrains Mono Project Authors | [OFL-JetBrainsMono.txt](src/renderer/src/assets/fonts/OFL-JetBrainsMono.txt) |
| Inter | 2016 The Inter Project Authors | [OFL-Inter.txt](src/renderer/src/assets/fonts/OFL-Inter.txt) |
| Noto Sans Symbols 2 | 2022 The Noto Project Authors | [OFL-NotoSansSymbols2.txt](src/renderer/src/assets/fonts/OFL-NotoSansSymbols2.txt) |
