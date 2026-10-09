import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ShellProfile } from '../shared/types.js'
import { DEFAULT_PORT } from '../shared/remote.js'

/**
 * Lo que NTX recuerda de las otras máquinas, en los dos papeles:
 *
 * - `host`: si ESTA máquina comparte sus shells, en qué puerto y con qué token.
 * - `peers`: las máquinas cuyas shells maneja ésta, con el token que cada una
 *   le dio al emparejar.
 *
 * Vive en userData/remote.json. Los tokens son llaves de shell: el archivo no
 * sale de la máquina y no viaja con nada.
 */

export interface HostConfig {
  enabled: boolean
  /** 64 hex. Se regenera con "Unpair all": todos los clientes quedan afuera. */
  token: string
  port: number
}

export interface PeerConfig {
  /** Id corto y propio de este lado. Va adentro de los profileId remotos
   *  (`@<id>/pwsh`), así que no cambia aunque cambien el nombre o la IP. */
  id: string
  /** El hostname que dio el host al emparejar: "UCK1". */
  name: string
  /** host:puerto, tal como se tipeó. Puede ser un nombre ("UCK1:8724"): así un
   *  cambio de IP por DHCP no rompe nada si la red resuelve nombres. */
  address: string
  token: string
  /** La sesión de este cliente en ese host. Persistida para que, si NTX muere
   *  sin despedirse, el próximo arranque encuentre las shells huérfanas y las
   *  cierre en vez de dejarlas 8 horas colgadas. */
  session: string
  /** Los perfiles del host la última vez que se lo vio. Con esto la escena
   *  guardada se puede remontar aunque la máquina esté apagada al arrancar. */
  profiles: ShellProfile[]
  /** El home del host, por lo mismo. */
  home: string
}

export interface RemoteConfig {
  host: HostConfig
  peers: PeerConfig[]
}

const file = (): string => join(app.getPath('userData'), 'remote.json')

export const newToken = (): string => randomBytes(32).toString('hex')
export const newId = (bytes = 6): string => randomBytes(bytes).toString('hex')

function defaults(): RemoteConfig {
  return { host: { enabled: false, token: newToken(), port: DEFAULT_PORT }, peers: [] }
}

/** Lee el config, rellenando lo que falte. Un archivo roto no tumba nada: se
 *  arranca de cero, que en el peor caso es volver a emparejar. */
export function loadRemoteConfig(): RemoteConfig {
  const base = defaults()
  let raw: Partial<RemoteConfig>
  try {
    raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<RemoteConfig>
  } catch {
    return base
  }

  const host = (raw.host ?? {}) as Partial<HostConfig>
  const config: RemoteConfig = {
    host: {
      enabled: host.enabled === true,
      token: typeof host.token === 'string' && /^[0-9a-f]{64}$/.test(host.token) ? host.token : base.host.token,
      port: Number.isInteger(host.port) && host.port! > 0 && host.port! < 65536 ? host.port! : DEFAULT_PORT
    },
    peers: []
  }
  for (const peer of Array.isArray(raw.peers) ? raw.peers : []) {
    if (!peer || typeof peer !== 'object') continue
    const p = peer as Partial<PeerConfig>
    if (typeof p.id !== 'string' || typeof p.address !== 'string' || typeof p.token !== 'string') continue
    config.peers.push({
      id: p.id,
      name: typeof p.name === 'string' && p.name ? p.name : p.address,
      address: p.address,
      token: p.token,
      session: typeof p.session === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(p.session) ? p.session : newId(12),
      profiles: Array.isArray(p.profiles) ? p.profiles : [],
      home: typeof p.home === 'string' ? p.home : ''
    })
  }
  return config
}

/**
 * Escritura atómica: tmp y rename. El tmp lleva un sufijo único — con un nombre
 * fijo, dos escrituras seguidas pueden pisarse el temporal y perder una.
 * Síncrona a propósito: el archivo es chico y se escribe en momentos raros
 * (emparejar, prender el host), y así nadie lee una versión a medias.
 */
export function saveRemoteConfig(config: RemoteConfig): void {
  const target = file()
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    renameSync(tmp, target)
  } catch (err) {
    console.error('[ntx] no pude guardar remote.json:', (err as Error).message)
  }
}
