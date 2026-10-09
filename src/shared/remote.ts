/**
 * El contrato entre dos NTX: el que maneja las shells de otra máquina (el
 * cliente, la UCX) y el que las corre (el host, la UCK1).
 *
 * Es el mismo protocolo que NTX Mobile habla con su agente (versión 1, mismos
 * mensajes y mismas reglas): lo que en un solo NTX viaja por IPC, entre dos
 * viaja por un WebSocket. Lo único que se suma es el emparejamiento con PIN,
 * que va ANTES del hello y no lo cambia.
 *
 * ── Sesiones ────────────────────────────────────────────────────────────────
 *
 * Las shells son de la SESIÓN, no del socket. El cliente se presenta con un id
 * de sesión que guarda en su config; si el socket se cae, las shells siguen
 * vivas en el host un rato largo (la "gracia"), y al volver con el mismo id el
 * cliente las retoma donde estaban.
 *
 * ── Offsets de salida ───────────────────────────────────────────────────────
 *
 * Cada panel numera su salida: `at` es la posición, en unidades de string de
 * JS, del primer carácter de cada chunk dentro de todo lo que ese panel escupió
 * desde que nació. El cliente lleva la cuenta de hasta dónde vio, y al
 * reconectar pide `attach` desde ahí: recibe exactamente lo que se perdió, ni un
 * carácter repetido ni uno de menos. El host guarda los últimos ~512 KB por
 * panel.
 *
 * Un panel no recibe salida en vivo hasta que el cliente lo engancha con
 * `attach` (o lo crea con `spawn`, que engancha solo). Sin esa regla, lo que el
 * panel escupiera entre el `ready` y el `attach` llegaría antes que el backlog
 * y quedaría fuera de orden.
 *
 * ── Emparejamiento ──────────────────────────────────────────────────────────
 *
 * El token es largo a propósito (64 hex): es una llave de shell. Tipearlo de
 * una pantalla a la otra sería un castigo, así que el host abre una ventana de
 * emparejamiento con un PIN de 6 dígitos que muestra en SU pantalla; el cliente
 * lo manda en un `pair` y recibe el token de vuelta. La ventana dura poco y
 * aguanta pocos intentos: adivinar un PIN no puede ser una estrategia.
 */

import type { PaneSnapshot, SavedSession, ShellProfile, SpawnOptions, SystemStats } from './types'

export const PROTOCOL_VERSION = 1

/**
 * El puerto del host de NTX. NTX Mobile usa el 8723 y Console Mobile el 8722:
 * en la misma máquina conviven los tres.
 */
export const DEFAULT_PORT = 8724

/** Un panel vivo (o muerto sin cerrar) tal como lo anuncia el `ready`. */
export interface LivePane extends PaneSnapshot {
  /** Cuánta salida lleva escupida en total: el `at` del próximo chunk. */
  seq: number
  /** El exit code si la shell ya terminó y el cliente todavía no cerró el panel. */
  exited: number | null
}

/** Pedidos con respuesta. Cada uno viaja con un `id` que vuelve en el `res`. */
export type Request =
  | { op: 'profiles' }
  /** `nonce` hace al spawn idempotente: si el socket se cae con el pedido en
   *  vuelo y el cliente lo reenvía, el host devuelve el MISMO panel en vez de
   *  abrir una segunda shell. */
  | { op: 'spawn'; nonce: string; options: SpawnOptions }
  | { op: 'session.load' }

export type ClientMessage =
  | { t: 'hello'; token: string; session: string; protocol: number; client: string }
  /** En vez del hello: "tengo un PIN, dame el token". El host contesta
   *  `paired` o cierra con `pairRejected`. */
  | { t: 'pair'; pin: string; protocol: number; client: string }
  | ({ t: 'req'; id: number } & Request)
  | { t: 'write'; pane: string; data: string }
  | { t: 'resize'; pane: string; cols: number; rows: number }
  | { t: 'kill'; pane: string }
  /** El cwd que el renderer vio por OSC 7. El host resuelve el branch. */
  | { t: 'cwd'; pane: string; cwd: string }
  /** Enganchar un panel: mandame su salida desde `from` y seguí en vivo. */
  | { t: 'attach'; pane: string; from: number }
  | { t: 'session.save'; session: SavedSession }
  | { t: 'ping' }

export interface ReadyInfo {
  session: string
  /** El nombre de la máquina, para decir a dónde está conectado. */
  host: string
  /** El home del usuario en esa máquina: el renderer acorta rutas contra `~`. */
  home: string
  /** La versión del host. */
  version: string
  /** true si la sesión ya existía (reconexión), false si nació ahora. */
  resumed: boolean
  panes: LivePane[]
}

export type ServerMessage =
  | ({ t: 'ready' } & ReadyInfo)
  | { t: 'paired'; token: string; host: string }
  | { t: 'res'; id: number; ok: true; value: unknown }
  | { t: 'res'; id: number; ok: false; error: string }
  | { t: 'data'; pane: string; at: number; data: string }
  | { t: 'exit'; pane: string; code: number }
  | { t: 'cwd'; pane: string; cwd: string; branch: string | null }
  | ({ t: 'stats' } & SystemStats)
  | { t: 'pong' }
  | { t: 'error'; message: string }

/** Lo que devuelve cada op, para tipar el `res` del lado del cliente. */
export interface Responses {
  profiles: ShellProfile[]
  spawn: LivePane
  'session.load': SavedSession | null
}

/**
 * Los códigos de cierre propios. Van en el rango 4000–4999, que el estándar
 * reserva para la aplicación.
 */
export const CLOSE = {
  /** Otra conexión tomó esta sesión (el mismo cliente reconectando, u otro). */
  superseded: 4000,
  /** No mandó el hello a tiempo. */
  helloTimeout: 4001,
  /** Token equivocado. Reintentar con el mismo no tiene sentido. */
  unauthorized: 4003,
  /** Cliente de otra versión del protocolo. */
  protocol: 4005,
  /** PIN equivocado, vencido o sin ventana de emparejamiento abierta. */
  pairRejected: 4006,
  /** El host dejó de compartir la máquina. */
  hostStopped: 4007,
  /** El cliente se va de verdad (cerró NTX): el host suelta sus shells ya, sin
   *  esperar la gracia. Un corte de red NUNCA llega con este código. */
  bye: 4100
} as const

// ---------------------------------------------------------------------------
// Lo que el main le cuenta al renderer de todo esto.
// ---------------------------------------------------------------------------

/**
 * Una máquina emparejada, vista desde el cliente.
 *
 * - `connecting`: primer intento, o reintentando sin haber llegado nunca.
 * - `online`: conectado, con la sesión en mano.
 * - `offline`: estuvo online y se cortó; reintenta solo.
 * - `failed`: el host dijo que no (token, versión). No reintenta: hace falta
 *   volver a emparejar.
 */
export type PeerPhase = 'connecting' | 'online' | 'offline' | 'failed'

export interface PeerState {
  id: string
  /** El nombre que dio el host (su hostname): "UCK1". */
  name: string
  address: string
  phase: PeerPhase
  /** Por qué falló o a dónde está intentando. */
  message: string
}

/** El lado host, visto desde su propia ventana. */
export interface HostState {
  enabled: boolean
  /** Dónde escucha de verdad (sin loopback): lo que hay que tipear del otro lado. */
  addresses: string[]
  port: number
  /** El nombre de esta máquina. */
  name: string
  /** Quiénes están conectados ahora, por nombre de cliente. */
  clients: string[]
  /** El PIN vigente y hasta cuándo, si hay una ventana de emparejamiento abierta. */
  pairing: { pin: string; until: number } | null
}

/** Lo que el main sabe de un panel remoto y el renderer necesita mostrar. */
export interface RemotePaneInfo {
  /** El id de la máquina en este cliente (PeerState.id). */
  peer: string
  /** El nombre de la máquina: "UCK1". */
  host: string
  /** El home de ESA máquina, para acortar sus rutas. */
  home: string
  /** Si la conexión con esa máquina está viva. */
  online: boolean
  pid?: number
}
