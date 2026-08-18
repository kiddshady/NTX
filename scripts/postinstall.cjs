/**
 * Postinstall de NTX: deja a node-pty en condiciones de compilar contra Electron,
 * sorteando dos trampas de Windows.
 *
 *   1. Spectre. node-pty pide `SpectreMitigation: Spectre` en sus gyp, pero las
 *      libs con mitigación son un componente OPCIONAL de Visual Studio: una
 *      instalación normal trae el compilador de C++ y no las trae. MSBuild corta
 *      con MSB8040. Le sacamos el flag — el binario anda igual, y lo que se
 *      pierde es una mitigación de canal lateral que no aplica a un pty local.
 *
 *   2. NoDefaultCurrentDirectoryInExePath. winpty.gyp corre
 *      `cmd /c "cd shared && GetCommitHash.bat"`, o sea que invoca un .bat por
 *      nombre pelado contando con que cmd busque en el directorio actual. Git
 *      Bash exporta esa variable justamente para que cmd NO lo haga, y entonces
 *      el build muere con "GetCommitHash.bat no se reconoce como un comando".
 *      El síntoma es desconcertante porque el archivo está ahí. La limpiamos del
 *      entorno del hijo: así `npm install` anda igual desde Git Bash, PowerShell
 *      o cmd.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// --- 1. Spectre -------------------------------------------------------------

const ptyRoot = path.join(__dirname, '..', 'node_modules', 'node-pty')
const gypFiles = ['binding.gyp', path.join('deps', 'winpty', 'src', 'winpty.gyp')]

// El bloque tal como lo escribe node-pty:
//     'msvs_configuration_attributes': { 'SpectreMitigation': 'Spectre' },
const SPECTRE_BLOCK =
  /['"]msvs_configuration_attributes['"]\s*:\s*\{\s*['"]SpectreMitigation['"]\s*:\s*['"]Spectre['"]\s*\},?\s*\n?/g

let patched = 0
for (const rel of gypFiles) {
  const file = path.join(ptyRoot, rel)
  if (!fs.existsSync(file)) continue

  const source = fs.readFileSync(file, 'utf8')
  SPECTRE_BLOCK.lastIndex = 0
  if (!SPECTRE_BLOCK.test(source)) continue

  SPECTRE_BLOCK.lastIndex = 0
  fs.writeFileSync(file, source.replace(SPECTRE_BLOCK, ''), 'utf8')
  patched++
  console.log(`[ntx] spectre: parcheado ${rel}`)
}
if (!patched) console.log('[ntx] spectre: nada que parchear')

// --- 2. Rebuild de nativos con el entorno limpio ----------------------------

const env = { ...process.env }
delete env.NoDefaultCurrentDirectoryInExePath

console.log('[ntx] rebuild de módulos nativos contra Electron…')
const result = spawnSync('electron-builder', ['install-app-deps'], {
  stdio: 'inherit',
  env,
  shell: true
})

process.exit(result.status ?? 1)
