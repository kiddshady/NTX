/* ═══════════════════════════════════════════════════════════════════════════
   NTX — publicar un release entero, o no publicar nada
   `npm run release` corre esto. Compila, arma el instalador NSIS, lo sube a
   GitHub, verifica lo que quedó allá contra dist/ y recién entonces lo publica
   y lo marca como el último.

   Antes era un procedimiento a mano, con dos trampas que se repitieron:

   - electron-builder 26 tiene una carrera en PublishManager: el .exe y su
     .blockmap llegan casi juntos, cada uno crea su publicador y cada
     publicador crea SU borrador. Quedaban dos, con los archivos repartidos
     (0.17.0, 0.17.1, 0.18.2). El arreglo: el borrador lo creamos nosotros
     antes de compilar, y los dos publicadores lo reutilizan.
   - El `make_latest=true` que va en el mismo PATCH que `draft=false` no tiene
     efecto: GitHub seguía marcando la versión anterior como la última, y el
     updater no veía la nueva. Hace falta un segundo PATCH sólo con eso, y
     verificarlo contra /releases/latest.

   NTX no usa tags locales: el tag lo crea GitHub al publicar, sobre el commit
   que ya está en origin/main. Por eso se exige que HEAD sea origin/main y que
   no haya cambios sin commitear: el instalador tiene que ser de ese código.

   Uso:
     npm version <x.y.z> --no-git-tag-version, commit `chore(release): x.y.z`
     y push; después:
       npm run release                       publica la versión de package.json
       npm run release -- --notas notas.md   con esas notas
       npm run release -- --ensayo           todo el camino con una versión de
                                             prueba y al final borra el borrador:
                                             no publica nada

   El token sale de `gh auth token` si GH_TOKEN no está en el entorno.
   ═══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

// El destino sale de electron-builder.yml, que es lo que lee el updater de la
// app instalada: publicar en otro lado sería publicar para nadie.
const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')
const owner = /^\s*owner:\s*(\S+)/m.exec(yml)?.[1]
const repo = /^\s*repo:\s*(\S+)/m.exec(yml)?.[1]
const artifact = /^\s*artifactName:\s*(\S+)/m.exec(yml.split(/^nsis:/m)[1] ?? '')?.[1]
const REPO = `${owner}/${repo}`

const args = process.argv.slice(2)
const ensayo = args.includes('--ensayo')
const notasArg = args.indexOf('--notas')
const notasFile = notasArg > -1 ? args[notasArg + 1] : null

const version = ensayo ? `${pkg.version}-ensayo.${Date.now()}` : pkg.version
const tag = `v${version}`

const paso = (t) => console.log(`\n── ${t}`)
const falla = (t) => {
  console.error(`\nNO SE PUBLICÓ NADA: ${t}`)
  process.exit(1)
}

function run(cmd, cmdArgs, { input, env, quiet = false, shell = false } = {}) {
  // Sin shell salvo para npm/npx (.cmd): por cmd.exe, un argumento con saltos
  // de línea o comillas —las notas del release— llega roto.
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    input,
    env: env || process.env,
    encoding: 'utf8',
    stdio: quiet ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
    shell,
    maxBuffer: 64 * 1024 * 1024
  })
  if (r.status !== 0) {
    falla(`${cmd} ${cmdArgs.join(' ')} terminó con código ${r.status}${quiet ? `\n${r.stderr || r.stdout}` : ''}`)
  }
  return (r.stdout || '').trim()
}
const gh = (...a) => run('gh', a, { quiet: true })
const ghSend = (method, ruta, datos) =>
  JSON.parse(run('gh', ['api', '-X', method, ruta, '--input', '-'], { quiet: true, input: JSON.stringify(datos) }))
const ghJson = (...a) => JSON.parse(gh(...a) || 'null')

/** Todos los releases del tag, borradores incluidos: `gh release view` elige
 *  uno solo y así escondía al gemelo. */
function releasesDelTag() {
  return ghJson('api', `repos/${REPO}/releases?per_page=100`)
    .filter((r) => r.tag_name === tag)
    .map((r) => ({
      id: r.id,
      draft: r.draft,
      assets: r.assets.map((a) => ({ name: a.name, size: a.size, state: a.state }))
    }))
}

// ── 1. Precondiciones ──────────────────────────────────────────────────────
paso(`${ensayo ? 'ENSAYO' : 'Release'} ${tag} → ${REPO}`)
if (!owner || !repo || !artifact) falla('no pude leer owner, repo o nsis.artifactName de electron-builder.yml.')
const token = process.env.GH_TOKEN || gh('auth', 'token')
if (!token) falla('no hay GH_TOKEN ni sesión de `gh auth`.')
if (notasFile && !fs.existsSync(notasFile)) falla(`no existe el archivo de notas ${notasFile}.`)

const sucio = run('git', ['status', '--porcelain', '--untracked-files=no'], { quiet: true })
if (sucio) falla(`hay cambios sin commitear:\n${sucio}`)
run('git', ['fetch', '--quiet', 'origin', 'main'], { quiet: true })
const head = run('git', ['rev-parse', 'HEAD'], { quiet: true })
const remoto = run('git', ['rev-parse', 'origin/main'], { quiet: true })
if (head !== remoto) falla('HEAD no es origin/main: pusheá primero (o traé lo que falta).')
if (!ensayo && !/^chore\(release\): /.test(run('git', ['log', '-1', '--format=%s'], { quiet: true }))) {
  console.log(`(aviso: el último commit no es «chore(release): ${version}»)`)
}

// ── 2. El borrador, antes de compilar ─────────────────────────────────────
paso('Borrador en GitHub')
let existentes = releasesDelTag()
if (existentes.some((r) => !r.draft)) falla(`${tag} ya está publicado.`)
if (existentes.length > 1) {
  falla(`hay ${existentes.length} borradores para ${tag} (ids ${existentes.map((r) => r.id).join(', ')}). Borrá los que sobran y volvé a correr.`)
}

let draftId
if (existentes.length === 1) {
  draftId = existentes[0].id
  console.log(`Se reutiliza el borrador ${draftId} de una corrida anterior.`)
} else {
  const creado = ghSend('POST', `repos/${REPO}/releases`, {
    tag_name: tag,
    target_commitish: head,
    name: version,
    body: notasFile ? fs.readFileSync(notasFile, 'utf8').trim() : '',
    draft: true,
    prerelease: ensayo
  })
  draftId = creado.id
  console.log(`Borrador ${draftId} creado sobre ${head.slice(0, 7)}.`)
}

// ── 3. Compilar y subir ───────────────────────────────────────────────────
paso('Compilar')
run('npm', ['run', 'build'], { shell: process.platform === 'win32' })

paso('electron-builder')
// Sólo NSIS: el portable no se actualiza solo y no se publica.
const ebArgs = ['electron-builder', '--win', 'nsis', '--publish', 'always']
if (ensayo) ebArgs.push(`-c.extraMetadata.version=${version}`)
run('npx', ebArgs, {
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    GH_TOKEN: token,
    // En esta red el IPv6 está agujereado (cuelgues de ~63 s): que Node
    // resuelva primero IPv4 para la subida.
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--dns-result-order=ipv4first'].filter(Boolean).join(' ')
  }
})

// ── 4. Verificar contra dist/ ─────────────────────────────────────────────
paso('Verificación')
const dist = path.join(ROOT, 'dist')
const instalador = artifact
  .replace('${productName}', pkg.productName)
  .replace('${version}', version)
  .replace('${ext}', 'exe')
const esperados = [instalador, `${instalador}.blockmap`, 'latest.yml'].map((name) => {
  const f = path.join(dist, name)
  if (!fs.existsSync(f)) falla(`falta ${name} en dist/.`)
  return { name, size: fs.statSync(f).size }
})

existentes = releasesDelTag()
const problemas = []
if (existentes.length !== 1) {
  problemas.push(`hay ${existentes.length} releases para ${tag} y tiene que haber uno (ids ${existentes.map((r) => r.id).join(', ')}).`)
}
const nuestro = existentes.find((r) => r.id === draftId)
if (!nuestro) problemas.push(`el borrador ${draftId} desapareció.`)
for (const e of esperados) {
  const a = nuestro?.assets.find((x) => x.name === e.name)
  const estado = !a
    ? 'FALTA'
    : a.state !== 'uploaded'
      ? `estado ${a.state}`
      : a.size !== e.size
        ? `pesa ${a.size} y en dist/ ${e.size}`
        : 'ok'
  console.log(`  ${estado === 'ok' ? 'ok   ' : 'MAL  '} ${e.name} (${e.size} bytes)${estado === 'ok' ? '' : ` — ${estado}`}`)
  if (estado !== 'ok') problemas.push(`${e.name}: ${estado}.`)
}
if (problemas.length) {
  falla(`el borrador quedó incompleto; sigue siendo borrador y nadie lo ve.\n  - ${problemas.join('\n  - ')}`)
}

// ── 5. Publicar (o, en ensayo, limpiar) ───────────────────────────────────
if (ensayo) {
  paso('Ensayo: se borra el borrador')
  gh('api', '-X', 'DELETE', `repos/${REPO}/releases/${draftId}`)
  for (const e of esperados.slice(0, 2)) fs.rmSync(path.join(dist, e.name), { force: true })
  console.log(`Borrador ${draftId} borrado. El camino completo anduvo; no se publicó nada.`)
  process.exit(0)
}

paso('Publicar')
ghSend('PATCH', `repos/${REPO}/releases/${draftId}`, { draft: false })
// Aparte, a propósito: junto con draft=false no tiene efecto (ver arriba).
ghSend('PATCH', `repos/${REPO}/releases/${draftId}`, { make_latest: 'true' })

const final = ghJson('api', `repos/${REPO}/releases/${draftId}`)
if (final.draft) falla('GitHub no lo sacó de borrador.')
const latest = ghJson('api', `repos/${REPO}/releases/latest`)
if (latest?.tag_name !== tag) {
  // Acá ya está publicado: no es «no se publicó nada».
  console.error(
    `\nPUBLICADO, PERO /releases/latest sigue diciendo ${latest?.tag_name}: el updater no lo va a ver. ` +
      `Repetí el PATCH con make_latest sobre el release ${draftId}.`
  )
  process.exit(1)
}
console.log(`Publicado y marcado como el último: ${final.html_url}`)
