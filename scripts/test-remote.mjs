/**
 * Arma y corre los tests de test/: remote.test.ts (host y cliente por LAN) y
 * autostart.test.ts (el arranque con Windows al compartir).
 *
 *   npm test
 *
 * Se bundlean con esbuild (`electron` → un stub) y se corren con el
 * electron.exe del proyecto como Node, porque el node-pty de NTX está
 * compilado para el ABI de Electron.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'out-test')
mkdirSync(OUT, { recursive: true })
const electron = createRequire(import.meta.url)('electron')

let failed = false
for (const name of ['remote', 'autostart']) {
  await build({
    entryPoints: [join(ROOT, 'test', `${name}.test.ts`)],
    outfile: join(OUT, `${name}.test.mjs`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: { electron: join(ROOT, 'test', 'electron-stub.ts') },
    external: ['node-pty', 'ws', 'bufferutil', 'utf-8-validate'],
    logLevel: 'warning'
  })
  const run = spawnSync(electron, [join(OUT, `${name}.test.mjs`)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  if (run.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
