/**
 * El host: ESTA máquina compartiendo sus shells con otro NTX de la LAN.
 *
 * Es el agente de NTX Mobile metido adentro de NTX: mismo protocolo, mismas
 * sesiones con gracia, mismo anillo de salida. La diferencia es que no hace
 * falta Node ni una tarea programada en la máquina que comparte — alcanza con
 * NTX abierto (en el tray), que ya trae node-pty compilado para sí mismo.
 *
 * Las shells que se abren desde afuera NO aparecen en el grid de esta ventana:
 * viven en su propio PtyManager y sólo las ve el cliente. Lo que sí se ve acá
 * es que alguien está conectado (HostState.clients), porque una shell de esta
 * máquina manejada desde otra no puede pasar desapercibida.
 *
 * Seguridad, en tres capas:
 *   1. Escucha sólo en loopback y en las IP privadas de la máquina (LAN y
 *      Tailscale). Nunca 0.0.0.0, y nunca una IP pública.
 *   2. Todo socket tiene que presentar el token (64 hex) en 5 segundos.
 *   3. El token se obtiene sólo con un PIN que se ve en ESTA pantalla, dentro
 *      de una ventana corta y con pocos intentos.
 */
import { createServer, type Server } from 'node:http'
import { hostname, homedir, networkInterfaces } from 'node:os'
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { IPty } from 'node-pty'
import { PtyManager } from './pty.js'
import { branchFor } from './git.js'
import { readStats } from './stats.js'
import { OutputRing } from './ring.js'
import type { ShellProfile, SpawnOptions } from '../shared/types.js'
import {
  CLOSE,
  PROTOCOL_VERSION,
  type ClientMessage,
  type HostState,
  type LivePane,
  type ServerMessage
} from '../shared/remote.js'

/** Lo que se guarda de cada panel para repintarlo: varias pantallas de scrollback. */
const RING_CAP = 512 * 1024
/** Cuánto siguen vivas las shells de un cliente que se cortó sin despedirse. */
const GRACE_MS = 8 * 60 * 60_000
/** La ventana de emparejamiento: lo justo para ir de una máquina a la otra. */
const PAIR_WINDOW_MS = 120_000
/** Intentos de PIN por ventana. Al quinto error la ventana se cierra sola. */
const PAIR_ATTEMPTS = 5
/** Cada cuánto se miran las interfaces: la wifi de una laptop levanta su IP
 *  después de que NTX arrancó con Windows, y cambia al moverse de red. */
const RESCAN_MS = 20_000

export interface HostOptions {
  token: string
  port: number
  version: string
  profiles: () => ShellProfile[]
  onState: (state: HostState) => void
}

interface PaneRec {
  id: string
  profile: ShellProfile
  proc: IPty
  cwd: string
  branch: string | null
  ring: OutputRing
  exited: number | null
  /** Si el socket actual pidió su salida en vivo (ver `attach` en el protocolo). */
  attached: boolean
  session: Session
}

interface Session {
  id: string
  ws: WebSocket | null
  /** Quién es, para mostrarlo en la ventana del host. */
  client: string
  panes: Map<string, PaneRec>
  /** nonce del spawn → panel, para que un spawn reenviado no abra otra shell. */
  nonces: Map<string, string>
  graceTimer: NodeJS.Timeout | null
}

interface Live extends WebSocket {
  alive?: boolean
}

const short = (id: string): string => id.slice(0, 8)

/**
 * ¿Es una IPv4 en la que tiene sentido escuchar? Loopback, los tres rangos
 * privados de la LAN y el CGNAT de Tailscale. Nada más: una IP pública en la
 * lista sería abrir la shell a internet.
 */
export function isShareableAddress(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

function shareableAddresses(): string[] {
  const found = new Set<string>(['127.0.0.1'])
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && isShareableAddress(info.address)) found.add(info.address)
    }
  }
  return [...found]
}

export class Host {
  private sessions = new Map<string, Session>()
  private paneIndex = new Map<string, PaneRec>()
  private servers = new Map<string, Server>()
  private pairing: { pin: string; until: number; attempts: number; timer: NodeJS.Timeout } | null = null
  private wss: WebSocketServer
  private ptys: PtyManager
  private heartbeat: NodeJS.Timeout
  private statsTimer: NodeJS.Timeout
  private rescanTimer: NodeJS.Timeout
  private stopped = false

  constructor(private options: HostOptions) {
    this.ptys = new PtyManager({
      onData: (paneId, data) => {
        const rec = this.paneIndex.get(paneId)
        if (!rec) return
        const at = rec.ring.end
        rec.ring.push(data)
        if (rec.attached) this.send(rec.session.ws, { t: 'data', pane: paneId, at, data })
      },
      onExit: (paneId, code) => {
        const rec = this.paneIndex.get(paneId)
        // Sin registro = lo mató un `kill` del cliente, que ya lo dio de baja.
        if (!rec) return
        rec.exited = code
        if (rec.attached) this.send(rec.session.ws, { t: 'exit', pane: paneId, code })
      }
    })

    this.wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 })
    this.wss.on('connection', (ws: Live, peer: string) => this.onConnection(ws, peer))

    // Las conexiones se mueren sin avisar (la otra máquina se durmió, se fue
    // la wifi). Ping cada 30 s; la que no contestó el anterior se termina, y
    // su sesión pasa a gracia sin perder nada.
    this.heartbeat = setInterval(() => {
      for (const client of this.wss.clients as Set<Live>) {
        if (client.alive === false) {
          client.terminate()
          continue
        }
        client.alive = false
        client.ping()
      }
    }, 30_000)

    // Las estadísticas de ESTA máquina, una vez por segundo, sólo si alguien mira.
    this.statsTimer = setInterval(() => {
      const watching = [...this.sessions.values()].filter((s) => s.ws)
      if (watching.length === 0) return
      const stats = readStats()
      for (const s of watching) this.send(s.ws, { t: 'stats', ...stats })
    }, 1_000)

    this.rescan()
    this.rescanTimer = setInterval(() => this.rescan(), RESCAN_MS)
    console.log(`[host] compartiendo esta máquina en el puerto ${options.port}`)
  }

  // --- Estado hacia la ventana ------------------------------------------------

  state(): HostState {
    return {
      enabled: !this.stopped,
      addresses: [...this.servers.keys()].filter((a) => a !== '127.0.0.1'),
      port: this.options.port,
      name: hostname(),
      clients: [...this.sessions.values()].filter((s) => s.ws).map((s) => s.client),
      pairing: this.pairing ? { pin: this.pairing.pin, until: this.pairing.until } : null
    }
  }

  private emit(): void {
    if (!this.stopped) this.options.onState(this.state())
  }

  // --- Emparejamiento ---------------------------------------------------------

  /** Abre (o renueva) la ventana de emparejamiento con un PIN nuevo. */
  openPairing(): void {
    this.closePairing(false)
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const until = Date.now() + PAIR_WINDOW_MS
    const timer = setTimeout(() => this.closePairing(), PAIR_WINDOW_MS)
    this.pairing = { pin, until, attempts: 0, timer }
    this.emit()
  }

  closePairing(emit = true): void {
    if (this.pairing) clearTimeout(this.pairing.timer)
    this.pairing = null
    if (emit) this.emit()
  }

  private tryPair(pin: unknown): boolean {
    const open = this.pairing
    if (!open || Date.now() > open.until || typeof pin !== 'string') return false
    const given = Buffer.from(pin.padEnd(6).slice(0, 6))
    const ok = given.length === 6 && timingSafeEqual(given, Buffer.from(open.pin))
    if (ok) {
      // Un PIN, un emparejamiento.
      this.closePairing()
      return true
    }
    open.attempts += 1
    if (open.attempts >= PAIR_ATTEMPTS) {
      console.warn('[host] demasiados PIN equivocados: cierro la ventana de emparejamiento')
      this.closePairing()
    }
    return false
  }

  // --- Paneles y sesiones -----------------------------------------------------

  private send(ws: WebSocket | null, message: ServerMessage): void {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }

  private snapshot(rec: PaneRec): LivePane {
    return {
      id: rec.id,
      profileId: rec.profile.id,
      title: rec.profile.label,
      cwd: rec.cwd,
      branch: rec.branch,
      pid: rec.proc.pid,
      seq: rec.ring.end,
      exited: rec.exited
    }
  }

  /** Manda la salida de un panel desde `from` y lo deja enganchado en vivo. Si la
   *  shell ya había muerto, el exit va después del backlog, como pasó. */
  private attach(rec: PaneRec, from: number): void {
    const ws = rec.session.ws
    const { at, data } = rec.ring.since(Math.max(0, Math.min(from, rec.ring.end)))
    if (data) this.send(ws, { t: 'data', pane: rec.id, at, data })
    rec.attached = true
    if (rec.exited !== null) this.send(ws, { t: 'exit', pane: rec.id, code: rec.exited })
  }

  private dropPane(rec: PaneRec): void {
    this.paneIndex.delete(rec.id)
    rec.session.panes.delete(rec.id)
    for (const [nonce, paneId] of rec.session.nonces) {
      if (paneId === rec.id) rec.session.nonces.delete(nonce)
    }
    this.ptys.kill(rec.id)
  }

  private dropSession(session: Session, why: string): void {
    if (session.graceTimer) clearTimeout(session.graceTimer)
    for (const rec of [...session.panes.values()]) this.dropPane(rec)
    this.sessions.delete(session.id)
    console.log(`[host] sesión ${short(session.id)} cerrada (${why})`)
  }

  private detach(session: Session, code: number): void {
    session.ws = null
    for (const rec of session.panes.values()) rec.attached = false
    if (code === CLOSE.bye) {
      this.dropSession(session, 'el cliente se despidió')
    } else if (session.panes.size === 0) {
      this.dropSession(session, 'sin shells')
    } else {
      session.graceTimer = setTimeout(() => this.dropSession(session, 'gracia vencida'), GRACE_MS)
      console.log(`[host] sesión ${short(session.id)} desconectada: ${session.panes.size} shell(s) esperando`)
    }
    this.emit()
  }

  /**
   * El pid de la shell. En node-pty no siempre está al volver de spawn(): ConPTY
   * lo informa cuando conecta su pipe, milisegundos después. Se espera a
   * tenerlo, con tope: un pid que no llega no puede frenar la shell.
   */
  private async waitForPid(proc: IPty): Promise<void> {
    for (let waited = 0; proc.pid <= 0 && waited < 2_000; waited += 25) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  private async spawnPane(session: Session, nonce: string, options: SpawnOptions): Promise<PaneRec> {
    const known = session.nonces.get(nonce)
    const existing = known ? session.panes.get(known) : undefined
    if (existing) return existing

    const profiles = this.options.profiles()
    const profile = profiles.find((p) => p.id === options.profileId) ?? profiles[0]
    if (!profile) throw new Error('No shell available on this machine')

    const cols = Math.max(1, Math.floor(Number(options.cols)) || 80)
    const rows = Math.max(1, Math.floor(Number(options.rows)) || 24)
    const accent = typeof options.accent === 'string' && /^#[0-9a-f]{6}$/i.test(options.accent) ? options.accent : undefined
    const pane = this.ptys.spawn(profile, options.cwd, cols, rows, accent)
    const rec: PaneRec = {
      id: pane.id,
      profile,
      proc: pane.proc,
      cwd: pane.cwd,
      branch: null,
      ring: new OutputRing(RING_CAP),
      exited: null,
      attached: false,
      session
    }
    this.paneIndex.set(rec.id, rec)
    session.panes.set(rec.id, rec)
    session.nonces.set(nonce, rec.id)
    const [branch] = await Promise.all([branchFor(rec.cwd), this.waitForPid(rec.proc)])
    rec.branch = branch
    console.log(`[host] shell ${short(rec.id)} · ${profile.label} · ${rec.cwd} (${session.client})`)
    return rec
  }

  // --- Conexiones -------------------------------------------------------------

  private tokenMatches(given: unknown): boolean {
    if (typeof given !== 'string') return false
    const a = Buffer.from(given)
    const b = Buffer.from(this.options.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private onConnection(ws: Live, peer: string): void {
    let session: Session | null = null
    ws.alive = true
    ws.on('pong', () => {
      ws.alive = true
    })

    const helloTimer = setTimeout(() => {
      if (!session) ws.close(CLOSE.helloTimeout, 'hello timeout')
    }, 5_000)

    const handle = async (message: ClientMessage): Promise<void> => {
      // --- Handshake --------------------------------------------------------
      if (!session) {
        if (message.t === 'pair') {
          clearTimeout(helloTimer)
          if (message.protocol !== PROTOCOL_VERSION) {
            ws.close(CLOSE.protocol, `protocol ${PROTOCOL_VERSION} expected`)
          } else if (this.tryPair(message.pin)) {
            console.log(`[host] emparejado con ${String(message.client)} desde ${peer}`)
            this.send(ws, { t: 'paired', token: this.options.token, host: hostname() })
            ws.close(1000, 'paired')
          } else {
            console.warn(`[host] PIN rechazado desde ${peer}`)
            ws.close(CLOSE.pairRejected, 'pairing rejected')
          }
          return
        }
        if (message.t !== 'hello') return
        if (!this.tokenMatches(message.token)) {
          console.warn(`[host] token rechazado desde ${peer}`)
          ws.close(CLOSE.unauthorized, 'unauthorized')
          return
        }
        if (message.protocol !== PROTOCOL_VERSION) {
          ws.close(CLOSE.protocol, `protocol ${PROTOCOL_VERSION} expected`)
          return
        }
        clearTimeout(helloTimer)

        const id = /^[A-Za-z0-9_-]{8,64}$/.test(message.session) ? message.session : randomBytes(12).toString('hex')
        let current = this.sessions.get(id)
        const resumed = current !== undefined
        const client = String(message.client || peer).slice(0, 80)
        if (current) {
          // La conexión nueva gana: la vieja suele ser un socket zombi del mismo
          // cliente que todavía no se enteró de que murió.
          if (current.ws && current.ws !== ws) current.ws.close(CLOSE.superseded, 'superseded')
          if (current.graceTimer) clearTimeout(current.graceTimer)
          current.graceTimer = null
          for (const rec of current.panes.values()) rec.attached = false
          current.ws = ws
          current.client = client
        } else {
          current = { id, ws, client, panes: new Map(), nonces: new Map(), graceTimer: null }
          this.sessions.set(id, current)
        }
        session = current

        this.send(ws, {
          t: 'ready',
          session: id,
          host: hostname(),
          home: homedir(),
          version: this.options.version,
          resumed,
          panes: [...current.panes.values()].map((rec) => this.snapshot(rec))
        })
        console.log(
          `[host] ${client} conectado desde ${peer} · sesión ${short(id)}` +
            (resumed ? ` retomada con ${current.panes.size} shell(s)` : ' nueva')
        )
        this.emit()
        return
      }

      // --- Sesión establecida -------------------------------------------------
      switch (message.t) {
        case 'req': {
          try {
            let value: unknown
            if (message.op === 'profiles') {
              value = this.options.profiles()
            } else if (message.op === 'spawn') {
              const rec = await this.spawnPane(session, String(message.nonce), message.options)
              this.send(ws, { t: 'res', id: message.id, ok: true, value: this.snapshot(rec) })
              // El backlog sale DESPUÉS de la respuesta: el cliente tiene que
              // saber que el panel existe antes de recibirle salida.
              if (session.ws === ws) this.attach(rec, 0)
              return
            } else if (message.op === 'session.load') {
              // La escena del cliente la guarda el cliente: el host no tiene nada.
              value = null
            } else {
              throw new Error('unknown op')
            }
            this.send(ws, { t: 'res', id: message.id, ok: true, value })
          } catch (err) {
            this.send(ws, { t: 'res', id: message.id, ok: false, error: (err as Error).message })
          }
          return
        }
        case 'write': {
          const rec = session.panes.get(message.pane)
          if (rec && rec.exited === null && typeof message.data === 'string') this.ptys.write(rec.id, message.data)
          return
        }
        case 'resize': {
          const rec = session.panes.get(message.pane)
          const cols = Math.floor(Number(message.cols))
          const rows = Math.floor(Number(message.rows))
          if (rec && rec.exited === null && cols > 0 && rows > 0) this.ptys.resize(rec.id, cols, rows)
          return
        }
        case 'kill': {
          const rec = session.panes.get(message.pane)
          if (rec) this.dropPane(rec)
          return
        }
        case 'attach': {
          const rec = session.panes.get(message.pane)
          if (rec) this.attach(rec, Number(message.from) || 0)
          return
        }
        case 'cwd': {
          const rec = session.panes.get(message.pane)
          if (!rec || typeof message.cwd !== 'string' || rec.cwd === message.cwd) return
          rec.cwd = message.cwd
          this.ptys.setCwd(rec.id, message.cwd)
          const branch = await branchFor(message.cwd)
          // Si mientras git pensaba el panel ya se fue a otra carpeta, esta
          // respuesta llega tarde y no se manda.
          if (rec.cwd !== message.cwd) return
          rec.branch = branch
          this.send(session.ws, { t: 'cwd', pane: rec.id, cwd: message.cwd, branch })
          return
        }
        case 'ping':
          this.send(ws, { t: 'pong' })
          return
        default:
          return
      }
    }

    ws.on('message', (raw) => {
      let message: ClientMessage
      try {
        message = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        return
      }
      // JSON válido que no es objeto ("null", "3"): tocarle .t tiraría.
      if (!message || typeof message !== 'object') return
      handle(message).catch((err: Error) => console.error('[host] error atendiendo', message.t, err.stack))
    })

    ws.on('close', (code) => {
      clearTimeout(helloTimer)
      // Si otra conexión ya tomó la sesión, no hay nada que soltar.
      if (session && session.ws === ws) this.detach(session, code)
    })
    ws.on('error', () => {
      // El close se encarga.
    })
  }

  // --- Escucha ----------------------------------------------------------------

  /** Escucha en las direcciones que aparecieron y suelta las que se fueron. */
  private rescan(): void {
    if (this.stopped) return
    const wanted = new Set(shareableAddresses())
    let changed = false
    for (const [address, server] of this.servers) {
      if (wanted.has(address)) continue
      server.close()
      this.servers.delete(address)
      changed = true
    }
    for (const address of wanted) {
      if (!this.servers.has(address)) this.listen(address)
    }
    if (changed) this.emit()
  }

  private listen(address: string): void {
    const server = createServer((_req, res) => {
      res.writeHead(426, { 'content-type': 'text/plain' })
      res.end('NTX host: WebSocket only\n')
    })
    server.on('upgrade', (req, socket, head) => {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, `${req.socket.remoteAddress}:${req.socket.remotePort}`)
      })
    })
    // Se reserva el lugar ANTES de escuchar: si el bind falla, el próximo
    // rescan lo vuelve a intentar al sacarlo de acá.
    this.servers.set(address, server)
    server.on('listening', () => {
      console.log(`[host] escuchando en ws://${address}:${this.options.port}`)
      this.emit()
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      console.warn(`[host] no pude escuchar en ${address}:${this.options.port}: ${err.code ?? err.message}`)
      if (this.servers.get(address) === server) this.servers.delete(address)
      this.emit()
    })
    server.listen(this.options.port, address)
  }

  /** Deja de compartir: corta a todos, mata las shells remotas y suelta los puertos. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.closePairing(false)
    clearInterval(this.heartbeat)
    clearInterval(this.statsTimer)
    clearInterval(this.rescanTimer)
    for (const session of [...this.sessions.values()]) {
      const ws = session.ws
      // Sin socket antes de cerrarlo: así su `close` no la manda a la gracia.
      session.ws = null
      ws?.close(CLOSE.hostStopped, 'host stopped')
      this.dropSession(session, 'el host dejó de compartir')
    }
    this.ptys.killAll()
    for (const server of this.servers.values()) server.close()
    this.servers.clear()
    console.log('[host] ya no comparto esta máquina')
  }
}
