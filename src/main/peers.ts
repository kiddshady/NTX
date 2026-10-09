/**
 * El cliente: las shells de OTRAS máquinas, mezcladas en el grid de ésta.
 *
 * El renderer no se entera de la diferencia. Pide un spawn con un perfil
 * remoto (`@<peer>/pwsh`), recibe un panel con un id como cualquier otro, y le
 * escribe, lo redimensiona y lo mata por el mismo IPC de siempre. El main ve
 * que ese id es de acá y lo manda por el WebSocket de su máquina.
 *
 * El id que ve el renderer es LOCAL y nace en el acto, aunque la máquina esté
 * apagada: el panel existe desde el primer momento y su shell remota se abre
 * cuando la conexión lo permita. Así una escena guardada con paneles de la
 * UCK1 se remonta igual con la laptop cerrada, y esos paneles arrancan solos
 * cuando ella aparece. El id remoto se conoce recién con la respuesta del spawn.
 *
 * Lo que aguanta la red (sesiones, offsets, nonce del spawn) es el protocolo de
 * NTX Mobile, ver shared/remote.ts. Esto es la parte de su shim que no tiene
 * que ver con el celu, pasada a Node.
 */
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import WebSocket from 'ws'
import type { PairResult, PaneSnapshot, ShellProfile, SpawnOptions, SystemStats } from '../shared/types.js'
import {
  CLOSE,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  type ClientMessage,
  type LivePane,
  type PeerPhase,
  type PeerState,
  type ReadyInfo,
  type RemotePaneInfo,
  type Request,
  type ServerMessage
} from '../shared/remote.js'
import { newId, type PeerConfig, type RemoteConfig } from './remoteConfig.js'

export interface PeerEvents {
  data(paneId: string, data: string): void
  exit(paneId: string, code: number): void
  cwd(paneId: string, cwd: string, branch: string | null): void
  info(paneId: string, info: RemotePaneInfo): void
  stats(peerId: string, stats: SystemStats): void
  peers(peers: PeerState[]): void
  profiles(): void
}

/** Lo que se escribe en un panel cuando su shell remota ya no está. En el gris
 *  del ghost de la paleta, como un comentario: es NTX hablando, no la shell. */
const note = (text: string): string => `\r\n\x1b[38;2;110;110;122m[NTX · ${text}]\x1b[0m\r\n`

/** Un corte breve no merece decir "offline": el estado cambia recién si el
 *  socket no volvió en este rato. */
const OFFLINE_GRACE_MS = 1_500
const RETRY_MIN_MS = 500
/** Con la máquina apagada se reintenta para siempre, pero sin apuro. */
const RETRY_MAX_MS = 10_000
const PING_MS = 15_000

// ---------------------------------------------------------------------------
// Ids de perfil remotos: `@<peer>/<perfil del host>`.
// ---------------------------------------------------------------------------

export function remoteProfileId(peerId: string, profileId: string): string {
  return `@${peerId}/${profileId}`
}

export function parseRemoteProfileId(id: string): { peerId: string; profileId: string } | null {
  const match = /^@([^/]+)\/(.*)$/.exec(id)
  return match ? { peerId: match[1]!, profileId: match[2]! } : null
}

/** "192.168.0.7", "uck1:8724", "ws://uck1/" → "host:puerto". */
export function normalizeAddress(input: string): string {
  const bare = input.trim().replace(/^[a-z][\w+.-]*:\/\//i, '').replace(/\/+$/, '')
  if (!bare) return ''
  return /:\d+$/.test(bare) ? bare : `${bare}:${DEFAULT_PORT}`
}

/** Por qué no se pudo hablar con un host, dicho para una persona. */
function explain(err: Error & { code?: string }, address: string): string {
  switch (err.code) {
    case 'ECONNREFUSED':
      return `Nothing is listening at ${address}. Is sharing on there?`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `The name ${address.replace(/:\d+$/, '')} doesn't resolve on this network. Try its IP.`
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `${address} is unreachable from here.`
    case 'ETIMEDOUT':
      return `${address} didn't answer.`
    default:
      return /timed out/i.test(err.message) ? `${address} didn't answer.` : err.message
  }
}

// ---------------------------------------------------------------------------
// Un panel remoto, visto desde acá.
// ---------------------------------------------------------------------------

interface Alias {
  /** El id que conoce el renderer. */
  id: string
  link: PeerLink
  /** El id en el host, cuando el spawn ya respondió. */
  remoteId: string | null
  killed: boolean
  /** Lo último que pidió el renderer, para el spawn que todavía no salió. */
  size: { cols: number; rows: number }
  /** Lo tipeado antes de que la shell exista del otro lado. */
  early: string[]
}

interface Pending {
  body: Request
  /** Corren en el mismo tick que la respuesta: el spawn tiene que quedar
   *  registrado ANTES de que se procese el primer chunk de su salida, que
   *  puede venir en el mismo paquete TCP. Una promesa llegaría tarde. */
  ok: (value: unknown) => void
  fail: (error: string) => void
}

// ---------------------------------------------------------------------------
// La conexión con una máquina.
// ---------------------------------------------------------------------------

class PeerLink {
  private ws: WebSocket | null = null
  phase: PeerPhase = 'connecting'
  message = ''
  private everReady = false
  private stopped = false

  private seen = new Map<string, number>()
  private pending = new Map<number, Pending>()
  private requestSeq = 0
  private queue: ClientMessage[] = []

  readonly aliases = new Map<string, Alias>()
  private byRemote = new Map<string, Alias>()
  /** Shells del host que nadie de acá reclama: huérfanas de una corrida
   *  anterior que no se despidió. Se cierran cuando ya no hay spawns en vuelo
   *  que puedan estar reclamándolas. */
  private orphans = new Set<string>()

  private retryTimer: NodeJS.Timeout | null = null
  private retryDelay = RETRY_MIN_MS
  private offlineTimer: NodeJS.Timeout | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private orphanTimer: NodeJS.Timeout | null = null
  private alive = true

  constructor(
    readonly config: PeerConfig,
    private readonly manager: Peers
  ) {}

  state(): PeerState {
    return {
      id: this.config.id,
      name: this.config.name,
      address: this.config.address,
      phase: this.phase,
      message: this.message
    }
  }

  get online(): boolean {
    return this.phase === 'online'
  }

  paneInfo(pid?: number): RemotePaneInfo {
    return { peer: this.config.id, host: this.config.name, home: this.config.home, online: this.online, pid }
  }

  private setPhase(phase: PeerPhase, message = ''): void {
    const changed = phase !== this.phase || message !== this.message
    const onlineChanged = (phase === 'online') !== this.online
    this.phase = phase
    this.message = message
    if (!changed) return
    this.manager.emitPeers()
    if (onlineChanged) for (const alias of this.aliases.values()) this.manager.events.info(alias.id, this.paneInfo())
  }

  // --- Salida -----------------------------------------------------------------

  private isReady(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.online
  }

  private transmit(message: ClientMessage): void {
    this.ws?.send(JSON.stringify(message))
  }

  private post(message: ClientMessage): void {
    if (this.isReady()) {
      this.transmit(message)
      return
    }
    // Un resize viejo no le sirve a nadie: en la cola vive sólo el último.
    if (message.t === 'resize') this.queue = this.queue.filter((m) => !(m.t === 'resize' && m.pane === message.pane))
    this.queue.push(message)
  }

  private request(body: Request, ok: (value: unknown) => void, fail: (error: string) => void): void {
    const id = ++this.requestSeq
    this.pending.set(id, { body, ok, fail })
    // Sin red sale con el próximo `ready`.
    if (this.isReady()) this.transmit({ t: 'req', id, ...body })
  }

  // --- Paneles ----------------------------------------------------------------

  spawn(options: SpawnOptions, profileId: string): Alias {
    const alias: Alias = {
      id: randomUUID(),
      link: this,
      remoteId: null,
      killed: false,
      size: { cols: options.cols, rows: options.rows },
      early: []
    }
    this.aliases.set(alias.id, alias)

    const nonce = newId(12)
    this.request(
      { op: 'spawn', nonce, options: { ...options, profileId } },
      (value) => this.onSpawned(alias, value as LivePane),
      (error) => {
        if (alias.killed) return
        this.manager.events.data(alias.id, note(`${this.config.name} couldn't open the shell: ${error}`))
        this.manager.events.exit(alias.id, 1)
      }
    )
    return alias
  }

  private onSpawned(alias: Alias, pane: LivePane): void {
    this.orphans.delete(pane.id)
    if (alias.killed) {
      // Se cerró mientras se abría: la shell nace y muere acá mismo.
      this.post({ t: 'kill', pane: pane.id })
      return
    }
    alias.remoteId = pane.id
    this.byRemote.set(pane.id, alias)
    // Lo que el host manda después de esta respuesta es la salida desde 0.
    this.seen.set(pane.id, 0)

    this.manager.events.cwd(alias.id, pane.cwd, pane.branch)
    this.manager.events.info(alias.id, this.paneInfo(pane.pid))

    for (const data of alias.early.splice(0)) this.post({ t: 'write', pane: pane.id, data })
    // El host la abrió con el tamaño del pedido; si el panel se midió después,
    // le llega ahora.
    this.post({ t: 'resize', pane: pane.id, cols: alias.size.cols, rows: alias.size.rows })
    this.sweepOrphansSoon()
  }

  write(alias: Alias, data: string): void {
    if (alias.remoteId) this.post({ t: 'write', pane: alias.remoteId, data })
    else alias.early.push(data)
  }

  resize(alias: Alias, cols: number, rows: number): void {
    if (cols < 1 || rows < 1) return
    alias.size = { cols, rows }
    if (alias.remoteId) this.post({ t: 'resize', pane: alias.remoteId, cols, rows })
  }

  reportCwd(alias: Alias, cwd: string): void {
    if (alias.remoteId) this.post({ t: 'cwd', pane: alias.remoteId, cwd })
  }

  kill(alias: Alias): void {
    alias.killed = true
    this.aliases.delete(alias.id)
    if (alias.remoteId) {
      this.byRemote.delete(alias.remoteId)
      this.seen.delete(alias.remoteId)
      this.post({ t: 'kill', pane: alias.remoteId })
    }
    // Sin remoteId el spawn sigue en vuelo: su respuesta ve `killed` y la mata.
  }

  // --- Entrada ----------------------------------------------------------------

  private onData(remoteId: string, at: number, data: string): void {
    const alias = this.byRemote.get(remoteId)
    if (!alias || alias.killed) return
    const already = this.seen.get(remoteId) ?? 0
    let chunk = data
    if (at < already) {
      // Lo que se re-envía por un attach repetido: sólo lo nuevo.
      chunk = data.slice(already - at)
    } else if (at > already && already > 0) {
      // El corte duró más de lo que el host guarda.
      chunk = note('part of the output was lost while offline') + data
    }
    this.seen.set(remoteId, Math.max(already, at + data.length))
    if (chunk) this.manager.events.data(alias.id, chunk)
  }

  private onReady(info: ReadyInfo): void {
    this.everReady = true
    this.retryDelay = RETRY_MIN_MS
    if (this.offlineTimer) clearTimeout(this.offlineTimer)
    this.offlineTimer = null

    // El nombre y el home pueden haber cambiado del otro lado; la sesión, si el
    // host no conocía la nuestra y nos dio otra.
    if (info.host !== this.config.name || info.home !== this.config.home || info.session !== this.config.session) {
      this.config.name = info.host || this.config.name
      this.config.home = info.home
      this.config.session = info.session
      this.manager.save()
    }

    const alive = new Set(info.panes.map((pane) => pane.id))

    // Online ANTES de dar de baja a los perdidos: el aviso de "la máquina está"
    // les tiene que llegar a ellos también, o se quedarían diciendo "offline"
    // con la máquina ahí.
    this.setPhase('online')

    // Paneles nuestros que el host ya no tiene: NTX se reinició del otro lado,
    // o pasó la gracia. La shell se perdió y el panel lo tiene que decir.
    for (const alias of [...this.byRemote.values()]) {
      if (alive.has(alias.remoteId!)) continue
      this.byRemote.delete(alias.remoteId!)
      this.seen.delete(alias.remoteId!)
      alias.remoteId = null
      alias.killed = true
      this.aliases.delete(alias.id)
      this.manager.forgetAlias(alias.id)
      this.manager.events.data(alias.id, note(`${this.config.name} no longer has this shell`))
      this.manager.events.exit(alias.id, -1)
    }

    // 1. Engancharse a lo nuestro desde donde lo dejamos. Lo que no es nuestro
    //    queda en observación: puede ser un spawn en vuelo cuya respuesta se
    //    perdió con el corte, que el reenvío de abajo va a reclamar.
    this.orphans.clear()
    for (const pane of info.panes) {
      if (this.byRemote.has(pane.id)) this.transmit({ t: 'attach', pane: pane.id, from: this.seen.get(pane.id) ?? 0 })
      else this.orphans.add(pane.id)
    }

    // 2. Los pedidos sin respuesta. El spawn es idempotente por su nonce.
    for (const [id, pending] of this.pending) this.transmit({ t: 'req', id, ...pending.body })

    // 3. Lo que se tipeó, redimensionó o cerró durante el corte.
    const backlog = this.queue
    this.queue = []
    for (const message of backlog) {
      if ('pane' in message && message.t !== 'kill' && !alive.has(message.pane)) continue
      this.transmit(message)
    }

    // 4. Los perfiles del host, por si instalaron o sacaron una shell.
    this.request(
      { op: 'profiles' },
      (value) => this.manager.setProfiles(this.config, value as ShellProfile[]),
      () => {}
    )

    this.sweepOrphansSoon()
  }

  /** Cierra las huérfanas cuando ya no queda ningún spawn que las reclame. Con
   *  tope de tiempo: un spawn que no responde nunca no puede salvarlas. */
  private sweepOrphansSoon(): void {
    if (this.orphanTimer) clearTimeout(this.orphanTimer)
    const sweep = (): void => {
      this.orphanTimer = null
      if (!this.isReady()) return
      for (const id of this.orphans) this.transmit({ t: 'kill', pane: id })
      if (this.orphans.size > 0) console.log(`[peers] ${this.config.name}: cerré ${this.orphans.size} shell(s) huérfana(s)`)
      this.orphans.clear()
    }
    const spawning = [...this.pending.values()].some((p) => p.body.op === 'spawn')
    if (this.orphans.size === 0) return
    this.orphanTimer = setTimeout(sweep, spawning ? 5_000 : 0)
  }

  private onMessage(raw: string): void {
    let message: ServerMessage
    try {
      message = JSON.parse(raw) as ServerMessage
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return

    switch (message.t) {
      case 'ready':
        this.onReady(message)
        return
      case 'res': {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.ok) entry.ok(message.value)
        else entry.fail(message.error)
        return
      }
      case 'data':
        this.onData(message.pane, message.at, message.data)
        return
      case 'exit': {
        const alias = this.byRemote.get(message.pane)
        if (alias && !alias.killed) this.manager.events.exit(alias.id, message.code)
        return
      }
      case 'cwd': {
        const alias = this.byRemote.get(message.pane)
        if (alias && !alias.killed) this.manager.events.cwd(alias.id, message.cwd, message.branch)
        return
      }
      case 'stats':
        this.manager.events.stats(this.config.id, { cpu: message.cpu, mem: message.mem })
        return
      default:
        return
    }
  }

  // --- El socket --------------------------------------------------------------

  start(): void {
    this.stopped = false
    this.open()
  }

  /** Vuelve a conectar con lo que diga el config (otra dirección, otro token),
   *  sin soltar los paneles: los que estaban se re-enganchan con el `ready`. */
  restart(): void {
    this.stop(false)
    this.retryDelay = RETRY_MIN_MS
    this.setPhase('connecting')
    this.start()
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.orphanTimer) clearTimeout(this.orphanTimer)
    this.retryTimer = this.pingTimer = this.orphanTimer = null
  }

  private open(): void {
    this.clearTimers()
    this.drop()

    const socket = new WebSocket(`ws://${this.config.address}`, {
      // IPv4 a propósito: el host escucha sólo en IPv4, y en esta red IPv6
      // resuelve primero y se cuelga un minuto antes de caer al 4.
      family: 4,
      handshakeTimeout: 5_000,
      perMessageDeflate: false
    })
    this.ws = socket
    this.alive = true

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          t: 'hello',
          token: this.config.token,
          session: this.config.session,
          protocol: PROTOCOL_VERSION,
          client: `NTX ${this.manager.version} · ${hostname()}`
        } satisfies ClientMessage)
      )
      // El latido propio: un host que se durmió no cierra el socket, sólo deja
      // de contestar.
      this.pingTimer = setInterval(() => {
        if (!this.alive) {
          socket.terminate()
          return
        }
        this.alive = false
        socket.ping()
      }, PING_MS)
    })
    socket.on('pong', () => {
      this.alive = true
    })
    socket.on('message', (raw) => {
      this.alive = true
      this.onMessage(raw.toString())
    })
    socket.on('error', (err) => {
      // El close viene atrás; acá sólo se guarda el porqué.
      if (socket === this.ws && !this.everReady) this.message = explain(err, this.config.address)
    })
    socket.on('close', (code) => {
      if (socket !== this.ws) return
      this.ws = null
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      if (this.stopped) return

      if (code === CLOSE.unauthorized) {
        this.setPhase('failed', `${this.config.name} no longer accepts this machine. Pair it again.`)
        return
      }
      if (code === CLOSE.protocol) {
        this.setPhase('failed', `${this.config.name} runs an NTX that speaks another protocol. Update both.`)
        return
      }
      if (code === CLOSE.superseded) {
        // Otra conexión con nuestra misma sesión: un NTX duplicado. No se pelea.
        this.setPhase('failed', `Another NTX took over this session on ${this.config.name}.`)
        return
      }

      const why = code === CLOSE.hostStopped ? `${this.config.name} stopped sharing.` : this.message
      if (!this.everReady) {
        this.setPhase('connecting', why)
      } else if (!this.offlineTimer && this.online) {
        this.offlineTimer = setTimeout(() => {
          this.offlineTimer = null
          if (!this.isReady()) this.setPhase('offline', why || `Lost ${this.config.name}. Reconnecting…`)
        }, OFFLINE_GRACE_MS)
      }

      this.retryTimer = setTimeout(() => this.open(), this.retryDelay)
      this.retryDelay = Math.min(RETRY_MAX_MS, this.retryDelay * 2)
    })
  }

  private drop(): void {
    const old = this.ws
    this.ws = null
    if (!old) return
    old.removeAllListeners()
    old.on('error', () => {})
    try {
      old.terminate()
    } catch {
      // Ya estaba muerto.
    }
  }

  /** Corta. Con `bye`, el host suelta las shells ya en vez de esperar la gracia. */
  stop(bye: boolean): void {
    this.stopped = true
    this.clearTimers()
    if (this.offlineTimer) clearTimeout(this.offlineTimer)
    this.offlineTimer = null
    const socket = this.ws
    this.ws = null
    if (socket && socket.readyState === WebSocket.OPEN && bye) {
      socket.close(CLOSE.bye, 'bye')
    } else if (socket) {
      socket.removeAllListeners()
      socket.on('error', () => {})
      socket.terminate()
    }
  }
}

// ---------------------------------------------------------------------------
// Todas las máquinas.
// ---------------------------------------------------------------------------

export class Peers {
  private links = new Map<string, PeerLink>()
  /** id local de panel → su panel remoto. */
  private index = new Map<string, Alias>()

  constructor(
    private readonly config: RemoteConfig,
    readonly save: () => void,
    readonly events: PeerEvents,
    readonly version: string
  ) {}

  start(): void {
    for (const peer of this.config.peers) this.connect(peer)
  }

  private connect(peer: PeerConfig): PeerLink {
    const link = new PeerLink(peer, this)
    this.links.set(peer.id, link)
    link.start()
    return link
  }

  states(): PeerState[] {
    return [...this.links.values()].map((link) => link.state())
  }

  emitPeers(): void {
    this.events.peers(this.states())
  }

  /** Los perfiles de todas las máquinas, con id y etiqueta de remotos. */
  profiles(): ShellProfile[] {
    return this.config.peers.flatMap((peer) =>
      peer.profiles.map((profile) => ({
        id: remoteProfileId(peer.id, profile.id),
        label: profile.label,
        kind: profile.kind,
        exec: '',
        args: [],
        host: peer.name
      }))
    )
  }

  setProfiles(peer: PeerConfig, profiles: ShellProfile[]): void {
    if (!Array.isArray(profiles)) return
    // Se guarda lo justo para remontar: la ruta del exe de otra máquina no le
    // sirve de nada a ésta.
    const slim = profiles.map((p) => ({ id: String(p.id), label: String(p.label), kind: p.kind, exec: '', args: [] }))
    if (JSON.stringify(slim) === JSON.stringify(peer.profiles)) return
    peer.profiles = slim
    this.save()
    this.events.profiles()
  }

  // --- Paneles ----------------------------------------------------------------

  isRemoteProfile(profileId: string): boolean {
    return parseRemoteProfileId(profileId) !== null
  }

  owns(paneId: string): boolean {
    return this.index.has(paneId)
  }

  forgetAlias(paneId: string): void {
    this.index.delete(paneId)
  }

  spawn(options: SpawnOptions): PaneSnapshot {
    const parsed = parseRemoteProfileId(options.profileId)
    const link = parsed ? this.links.get(parsed.peerId) : undefined
    if (!parsed || !link) throw new Error('That machine is no longer paired')

    const alias = link.spawn(options, parsed.profileId)
    this.index.set(alias.id, alias)
    const profile = link.config.profiles.find((p) => p.id === parsed.profileId)
    return {
      id: alias.id,
      profileId: options.profileId,
      title: profile?.label ?? parsed.profileId,
      // La carpeta real llega con la respuesta del host; mientras tanto, su home.
      cwd: link.config.home,
      branch: null,
      pid: 0,
      remote: link.paneInfo()
    }
  }

  write(paneId: string, data: string): void {
    const alias = this.index.get(paneId)
    if (alias) alias.link.write(alias, data)
  }

  resize(paneId: string, cols: number, rows: number): void {
    const alias = this.index.get(paneId)
    if (alias) alias.link.resize(alias, cols, rows)
  }

  reportCwd(paneId: string, cwd: string): void {
    const alias = this.index.get(paneId)
    if (alias) alias.link.reportCwd(alias, cwd)
  }

  kill(paneId: string): void {
    const alias = this.index.get(paneId)
    if (!alias) return
    this.index.delete(paneId)
    alias.link.kill(alias)
  }

  // --- Emparejar y olvidar -----------------------------------------------------

  /**
   * Habla con el host UNA vez, con el PIN, y se queda con el token. Si esa
   * máquina ya estaba emparejada (mismo nombre), se actualiza en el lugar: su
   * id no cambia, así la escena guardada sigue apuntándole.
   */
  pair(input: string, pin: string): Promise<PairResult> {
    const address = normalizeAddress(input)
    if (!address) return Promise.resolve({ ok: false, error: 'Type the address of the other machine.' })
    if (!/^\d{6}$/.test(pin.trim())) return Promise.resolve({ ok: false, error: 'The PIN has six digits.' })

    return new Promise((resolve) => {
      let settled = false
      const finish = (result: PairResult): void => {
        if (settled) return
        settled = true
        resolve(result)
      }

      const socket = new WebSocket(`ws://${address}`, { family: 4, handshakeTimeout: 5_000, perMessageDeflate: false })
      let failure = ''
      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            t: 'pair',
            pin: pin.trim(),
            protocol: PROTOCOL_VERSION,
            client: `NTX ${this.version} · ${hostname()}`
          } satisfies ClientMessage)
        )
      })
      socket.on('message', (raw) => {
        let message: ServerMessage
        try {
          message = JSON.parse(raw.toString()) as ServerMessage
        } catch {
          return
        }
        if (message.t !== 'paired') return
        finish({ ok: true, peer: this.adopt(address, message.host, message.token) })
      })
      socket.on('error', (err) => {
        failure = explain(err, address)
      })
      socket.on('close', (code) => {
        if (code === CLOSE.pairRejected) finish({ ok: false, error: 'Wrong or expired PIN. Ask for a new one there.' })
        else if (code === CLOSE.protocol) finish({ ok: false, error: 'That NTX speaks another protocol. Update both.' })
        else finish({ ok: false, error: failure || `Couldn't pair with ${address}.` })
      })
    })
  }

  private adopt(address: string, name: string, token: string): PeerState {
    const existing = this.config.peers.find((p) => p.name.toLowerCase() === name.toLowerCase())
    let peer: PeerConfig
    if (existing) {
      existing.address = address
      existing.token = token
      peer = existing
    } else {
      peer = { id: newId(), name, address, token, session: newId(12), profiles: [], home: '' }
      this.config.peers.push(peer)
    }
    this.save()
    const current = this.links.get(peer.id)
    if (current) current.restart()
    const link = current ?? this.connect(peer)
    this.emitPeers()
    return link.state()
  }

  forget(peerId: string): void {
    const link = this.links.get(peerId)
    if (!link) return
    // Sus paneles se quedan en el grid, muertos y diciendo por qué: cerrarlos
    // en silencio se llevaría lo que mostraban.
    for (const alias of [...link.aliases.values()]) {
      this.index.delete(alias.id)
      this.events.data(alias.id, note(`${link.config.name} was forgotten`))
      this.events.exit(alias.id, -1)
    }
    link.stop(true)
    this.links.delete(peerId)
    this.config.peers = this.config.peers.filter((p) => p.id !== peerId)
    this.save()
    this.emitPeers()
    this.events.profiles()
  }

  /** NTX se cierra: cada host suelta nuestras shells ya. */
  shutdown(): void {
    for (const link of this.links.values()) link.stop(true)
  }
}
