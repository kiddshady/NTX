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

/**
 * Uso de CPU y memoria del sistema, en porcentaje.
 *
 * `os.cpus()` da contadores ACUMULADOS desde el booteo, así que el valor
 * instantáneo no dice nada: hay que medir el delta contra la lectura anterior.
 * La primera llamada tras el arranque compara contra el momento de carga del
 * módulo, o sea que puede salir rara — se corrige sola en el segundo tick.
 */
export function readStats(): { cpu: number; mem: number } {
  const current = sample()
  const idleDelta = current.idle - previous.idle
  const totalDelta = current.total - previous.total
  previous = current

  const cpu = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0
  const mem = Math.round(((totalmem() - freemem()) / totalmem()) * 100)

  return { cpu: Math.max(0, Math.min(100, cpu)), mem }
}
