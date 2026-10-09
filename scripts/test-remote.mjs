/**
 * Arma y corre test/remote.test.ts.
 *
 *   npm test
 *
 * Se bundlea con esbuild (`electron` → un stub) y se corre con el electron.exe
 * del proyecto como Node, porque el node-pty de NTX está compilado para el ABI
 * de Electron.
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

await build({
  entryPoints: [join(ROOT, 'test', 'remote.test.ts')],
  outfile: join(OUT, 'remote.test.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: { electron: join(ROOT, 'test', 'electron-stub.ts') },
  external: ['node-pty', 'ws', 'bufferutil', 'utf-8-validate'],
  logLevel: 'warning'
})

const electron = createRequire(import.meta.url)('electron')
const run = spawnSync(electron, [join(OUT, 'remote.test.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(run.status ?? 1)
