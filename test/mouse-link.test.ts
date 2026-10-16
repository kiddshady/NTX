/**
 * El Ctrl+click sobre un link le llega a la app sin el Ctrl (src/renderer/src/lib/mouseLink.ts),
 * para que Claude Code no abra otra vez el link que ya abre NTX.
 *
 *   npm test
 */
import { withoutCtrlClick } from '../src/renderer/src/lib/mouseLink'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}
function same(name: string, got: string, want: string): void {
  check(name, got === want, `${JSON.stringify(got)} en vez de ${JSON.stringify(want)}`)
}

console.log('\nCtrl+click sobre un link')
same('apretar con Ctrl pierde el Ctrl', withoutCtrlClick('\x1b[<16;12;5M'), '\x1b[<0;12;5M')
same('soltar con Ctrl pierde el Ctrl', withoutCtrlClick('\x1b[<16;12;5m'), '\x1b[<0;12;5m')
same('Ctrl+Shift deja el Shift', withoutCtrlClick('\x1b[<20;3;1M'), '\x1b[<4;3;1M')
same('Ctrl con el botón derecho también', withoutCtrlClick('\x1b[<18;7;9M'), '\x1b[<2;7;9M')

console.log('\nLo demás pasa tal cual')
same('un click sin Ctrl', withoutCtrlClick('\x1b[<0;12;5M'), '\x1b[<0;12;5M')
same('arrastrar con Ctrl', withoutCtrlClick('\x1b[<48;12;5M'), '\x1b[<48;12;5M')
same('la rueda con Ctrl (zoom en la app)', withoutCtrlClick('\x1b[<80;12;5M'), '\x1b[<80;12;5M')
same('una tecla', withoutCtrlClick('a'), 'a')
same('una flecha', withoutCtrlClick('\x1b[A'), '\x1b[A')
same('un pegado que trae un reporte adentro', withoutCtrlClick('x\x1b[<16;1;1M'), 'x\x1b[<16;1;1M')

console.log(`\n${checks - failures}/${checks} ok`)
if (failures) process.exit(1)
