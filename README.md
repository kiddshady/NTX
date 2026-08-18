# NTX

Terminal multi-shell para Windows, con grid adaptativo y estética neón.
Electron + xterm.js + node-pty, escrita desde cero a partir de la maqueta en
[`mockup/`](mockup).

## Qué hace

- **Hasta cuatro shells a la vez, en un grid que se acomoda solo.** Una ocupa
  toda la ventana; dos van lado a lado; con tres, la última toma el ancho
  completo abajo; cuatro caen en 2×2. Nunca queda un hueco vacío.
- **Un perfil por panel.** Detecta lo que hay instalado en la máquina —
  PowerShell 7, Windows PowerShell, cmd, Git Bash y WSL — y ofrece sólo eso: un
  perfil cuyo ejecutable no existe es peor que no ofrecerlo.
- **Paleta de comandos** (`Ctrl K`) con filtro por subsecuencia: `nps` encuentra
  «Nueva shell · PowerShell». Abre shells, cierra la activa y regula el CRT.
- **Una sola paleta de color**, no un sistema de temas. Los colores viven en
  `term/themes.ts` y de ahí salen tanto las variables CSS del chrome como el
  `ITheme` de xterm, para que el borde de un panel y el texto de la terminal no
  puedan irse separando de a un commit por vez.
- **Status bar con datos reales**: CPU y memoria del sistema, el directorio de la
  shell activa y su branch de git.
- **Overlay CRT** regulable: scanlines, viñeta, una cuadrícula de 34px y la
  aberración cromática que tiñe la app de magenta a cian, por encima de todo lo
  demás. La intensidad se recuerda.

## Atajos

| Atajo | Qué hace |
|---|---|
| `Ctrl K` | Abre y cierra la paleta de comandos |
| `Ctrl 1`–`Ctrl 4` | Enfoca esa shell |
| `Ctrl Shift T` | Nueva shell |
| `Ctrl Shift W` | Cierra la shell activa |
| `Ctrl Shift C` / `Ctrl Shift V` | Copiar y pegar |
| `Ctrl C` | Copia si hay selección; si no, sigue siendo la interrupción |

Los atajos de la app van con `Shift` justamente para no pisarle a PSReadLine los
suyos: `Ctrl+T` y `Ctrl+W` ya están tomados del lado del shell.

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
    shell-init/          Lo que se le inyecta a cada shell
      ntx-init.ps1       UTF-8 + OSC 7 para PowerShell
      ntx-init.sh        OSC 7 para bash (Git Bash y WSL)
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
`--ntx-base` tengan que ser el mismo `#06060a`.

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
