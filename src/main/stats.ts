import { cpus, totalmem, freemem } from 'node:os'

interface CpuSample {
  idle: number
  total: number
}

function sample(): CpuSample {
  let idle = 0
  let total = 0
  for (const cpu of cpus()) {
    for (const value of Object.values(cpu.times)) total += value
    idle += cpu.times.idle
  }
  return { idle, total }
}

let previous = sample()
/** La última lectura, y cuándo se hizo. */
let last = { cpu: 0, mem: 0 }
let lastAt = 0

/** Dos lecturas más juntas que esto devuelven la misma. Con una máquina
 *  conectada la piden dos timers de 1 s (el de la ventana y el del host), y a
 *  milisegundos de distancia el delta de CPU es puro ruido: salía 0 y 100. */
const MIN_INTERVAL_MS = 500

/**
 * Uso de CPU y memoria del sistema, en porcentaje.
 *
 * `os.cpus()` da contadores ACUMULADOS desde el booteo, así que el valor
 * instantáneo no dice nada: hay que medir el delta contra la lectura anterior.
 * La primera llamada tras el arranque compara contra el momento de carga del
 * módulo, o sea que puede salir rara — se corrige sola en el segundo tick.
 */
export function readStats(): { cpu: number; mem: number } {
  if (Date.now() - lastAt < MIN_INTERVAL_MS) return last
  const current = sample()
  const idleDelta = current.idle - previous.idle
  const totalDelta = current.total - previous.total
  previous = current

  const cpu = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0
  const mem = Math.round(((totalmem() - freemem()) / totalmem()) * 100)

  last = { cpu: Math.max(0, Math.min(100, cpu)), mem }
  lastAt = Date.now()
  return last
}
