/**
 * El tamaño de entrada de la ventana (src/main/window.ts): que entre en el área
 * útil de la pantalla. Es la cuenta pura; la ventana real la midió Coqui en la
 * UCK1 con DWMWA_EXTENDED_FRAME_BOUNDS.
 *
 *   npm test
 */
import { enAreaUtil } from '../src/main/window'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

console.log('\nVentana: entra en el área útil')

// La UCK1: 1366×768 con la barra de tareas abajo. Antes nacía en y = −40.
let r = enAreaUtil({ x: 0, y: 0, width: 1366, height: 720 })
check('en la UCK1 el alto se achica al área útil', r.height === 720, JSON.stringify(r))
check('y la barra de título queda adentro', r.y === 0, JSON.stringify(r))
check('el ancho entra y se centra', r.width === 1200 && r.x === 83, JSON.stringify(r))

// La UCX: entra de sobra, así que no cambia nada.
r = enAreaUtil({ x: 0, y: 0, width: 1920, height: 1032 })
check('en la UCX sigue siendo 1200×800', r.width === 1200 && r.height === 800, JSON.stringify(r))
check('centrada', r.x === 360 && r.y === 116, JSON.stringify(r))

// Un área útil corrida: la barra de tareas arriba, o un segundo monitor.
r = enAreaUtil({ x: 1920, y: 40, width: 1366, height: 728 })
check('respeta el origen del área útil', r.x === 1920 + 83 && r.y === 40 && r.height === 728, JSON.stringify(r))

// Más chica que todo: el ancho también se achica.
r = enAreaUtil({ x: 0, y: 0, width: 1024, height: 728 })
check('una pantalla angosta también achica el ancho', r.width === 1024 && r.x === 0, JSON.stringify(r))

console.log(`\n${checks - failures}/${checks} ok`)
if (failures) process.exit(1)
