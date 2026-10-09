/**
 * El host y el cliente de NTX hablando de verdad, en la misma máquina, contra
 * shells reales. Corre adentro de Electron como Node (ELECTRON_RUN_AS_NODE):
 * el node-pty de NTX está compilado para Electron y Node a secas no lo carga.
 *
 *   npm test
 *
 * Cubre lo que tiene que aguantar una LAN de verdad: emparejar con PIN (y que
 * uno malo no pase), abrir una shell remota, tipearle, que un corte no pierda
 * ni repita un carácter, que un panel pedido con el host apagado arranque
 * cuando el host vuelve, y que al despedirse el host suelte las shells.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Host } from '../src/main/host'
import { Peers } from '../src/main/peers'
import { detectProfiles } from '../src/main/profiles'
import { newToken, type RemoteConfig } from '../src/main/remoteConfig'
import type { PeerState } from '../src/shared/remote'

const PORT = 18724
const ADDRESS = `127.0.0.1:${PORT}`
const TOKEN = newToken()
process.env.NTX_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'ntx-remote-test-'))

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function until(what: () => boolean, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (what()) return true
    await sleep(50)
  }
  return what()
}

// --- El host ----------------------------------------------------------------

const profiles = detectProfiles()
const shell = profiles.find((p) => p.id === 'pwsh') ?? profiles.find((p) => p.id === 'powershell') ?? profiles[0]!
let hostClients: string[] = []
let hostPin = ''
function startHost(): Host {
  return new Host({
    token: TOKEN,
    port: PORT,
    version: 'test',
    profiles: () => profiles,
    onState: (state) => {
      hostClients = state.clients
      hostPin = state.pairing?.pin ?? ''
    }
  })
}
let host = startHost()
await sleep(300)

// --- El cliente -------------------------------------------------------------

const config: RemoteConfig = { host: { enabled: false, token: newToken(), port: PORT }, peers: [] }
const output = new Map<string, string>()
const exits = new Map<string, number>()
const cwds = new Map<string, { cwd: string; branch: string | null }>()
const online = new Map<string, boolean>()
let peerStates: PeerState[] = []
let profilesChanged = 0
let statsSeen = 0

const peers = new Peers(
  config,
  () => {},
  {
    data: (id, data) => output.set(id, (output.get(id) ?? '') + data),
    exit: (id, code) => exits.set(id, code),
    cwd: (id, cwd, branch) => cwds.set(id, { cwd, branch }),
    info: (id, info) => online.set(id, info.online),
    stats: () => (statsSeen += 1),
    peers: (states) => (peerStates = states),
    profiles: () => (profilesChanged += 1)
  },
  'test'
)

console.log(`\nNTX remoto · host y cliente en ${ADDRESS} · shell: ${shell.label}\n`)

// 1. Emparejar ----------------------------------------------------------------

let result = await peers.pair(ADDRESS, '123456')
check('sin ventana abierta, un PIN no empareja', !result.ok)

host.openPairing()
check('la ventana muestra un PIN de 6 dígitos', /^\d{6}$/.test(hostPin), hostPin)
const wrong = hostPin === '000000' ? '000001' : '000000'
result = await peers.pair(ADDRESS, wrong)
check('un PIN equivocado no empareja', !result.ok)
result = await peers.pair(ADDRESS, hostPin)
check('el PIN correcto empareja', result.ok, result.ok ? '' : result.error)
check('el PIN no sirve dos veces', hostPin === '')
check('el token llegó al config del cliente', config.peers[0]?.token === TOKEN)

const peerId = config.peers[0]!.id
check('la conexión queda online', await until(() => peerStates[0]?.phase === 'online'), JSON.stringify(peerStates))
check('el host ve al cliente', await until(() => hostClients.length === 1), JSON.stringify(hostClients))
check('llegan los perfiles del host', await until(() => profilesChanged > 0 && peers.profiles().length > 0))
check('llegan las estadísticas del host', await until(() => statsSeen > 1, 3_000))

// 2. Una shell remota ---------------------------------------------------------

const remoteProfile = `@${peerId}/${shell.id}`
const pane = peers.spawn({ profileId: remoteProfile, cols: 100, rows: 30, cwd: process.cwd() })
check('el panel nace al instante y marcado como remoto', pane.remote?.host !== undefined && pane.pid === 0)
check('la shell escupe su prompt', await until(() => (output.get(pane.id) ?? '').length > 0))
check('llega el pid real', await until(() => cwds.has(pane.id)))

peers.write(pane.id, 'echo hola-ntx-remoto\r')
check('lo tipeado vuelve', await until(() => (output.get(pane.id) ?? '').includes('hola-ntx-remoto')))
peers.resize(pane.id, 120, 40)

peers.reportCwd(pane.id, process.cwd())
await sleep(300)

// 3. Un corte -----------------------------------------------------------------

const before = output.get(pane.id) ?? ''
const echoesBefore = before.split('hola-ntx-remoto').length - 1
// Se corta el socket por debajo, como una wifi que se va.
const link = (peers as unknown as { links: Map<string, { ws: { terminate(): void } | null }> }).links.get(peerId)!
link.ws?.terminate()
// Y se tipea en el medio: tiene que salir cuando vuelva.
peers.write(pane.id, 'echo despues-del-corte\r')
check('vuelve a estar online solo', await until(() => peerStates[0]?.phase === 'online' && (output.get(pane.id) ?? '').includes('despues-del-corte')))
const after = output.get(pane.id) ?? ''
check('nada se repitió al reconectar', after.split('hola-ntx-remoto').length - 1 === echoesBefore, `${echoesBefore} → ${after.split('hola-ntx-remoto').length - 1}`)
check('lo de antes del corte sigue intacto', after.startsWith(before))

// 4. Cerrar un panel ----------------------------------------------------------

const sessions = (): Map<string, { panes: Map<string, unknown> }> =>
  (host as unknown as { sessions: Map<string, { panes: Map<string, unknown> }> }).sessions
peers.kill(pane.id)
check('cerrar el panel mata la shell del host', await until(() => [...sessions().values()].every((s) => s.panes.size === 0)))

// 5. Host apagado -------------------------------------------------------------

// Una shell abierta cuando el host se apaga: muere con él, y al volver el
// panel lo tiene que decir — con la máquina marcada como presente otra vez.
const doomed = peers.spawn({ profileId: remoteProfile, cols: 80, rows: 24 })
await until(() => (output.get(doomed.id) ?? '').length > 0)
host.stop()
check('el cliente nota que el host se fue', await until(() => peerStates[0]?.phase !== 'online', 5_000), JSON.stringify(peerStates))
const waiting = peers.spawn({ profileId: remoteProfile, cols: 80, rows: 24 })
peers.write(waiting.id, 'echo tipeado-sin-host\r')
check('el panel existe aunque el host no', waiting.id.length > 0 && online.get(waiting.id) !== true)
await sleep(500)
host = startHost()
check('cuando el host vuelve, la shell arranca', await until(() => (output.get(waiting.id) ?? '').length > 0, 15_000))
check('y le llega lo tipeado mientras tanto', await until(() => (output.get(waiting.id) ?? '').includes('tipeado-sin-host')))
check('la shell que murió con el host avisa que se perdió', exits.get(doomed.id) === -1, String(exits.get(doomed.id)))
check('y su panel ve la máquina presente, no offline', online.get(doomed.id) === true)

// 6. Despedirse ---------------------------------------------------------------

peers.shutdown()
check('al despedirse, el host suelta la sesión ya', await until(() => sessions().size === 0, 3_000))

// 7. Un token que el host no conoce --------------------------------------------

const intruder: RemoteConfig = {
  host: config.host,
  peers: [{ ...config.peers[0]!, token: newToken() }]
}
let intruderState: PeerState[] = []
const other = new Peers(
  intruder,
  () => {},
  {
    data: () => {},
    exit: () => {},
    cwd: () => {},
    info: () => {},
    stats: () => {},
    peers: (states) => (intruderState = states),
    profiles: () => {}
  },
  'test'
)
other.start()
check('un token equivocado queda afuera y no reintenta', await until(() => intruderState[0]?.phase === 'failed'))
other.shutdown()

host.stop()
console.log(`\n${checks - failures}/${checks} checks${failures ? ` · ${failures} FALLARON` : ''}\n`)
process.exit(failures ? 1 : 0)
