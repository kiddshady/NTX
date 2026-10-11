/**
 * Qué shell abre Ctrl+Shift+M (otherMachinePwsh en src/renderer/src/lib/panes.ts):
 * un PowerShell 7 de otra máquina, nunca uno de ésta.
 *
 *   npm test
 */
import { otherMachinePwsh } from '../src/renderer/src/lib/panes'
import type { ShellProfile } from '../src/shared/types'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

const local = (id: string, kind: ShellProfile['kind']): ShellProfile => ({ id, label: id, kind, exec: 'x', args: [] })
const remote = (peer: string, id: string, kind: ShellProfile['kind'], host: string): ShellProfile => ({
  id: `@${peer}/${id}`,
  label: id,
  kind,
  exec: '',
  args: [],
  host
})

console.log('\nCtrl+Shift+M: PowerShell 7 de la otra máquina')

const ucx = [local('pwsh', 'pwsh'), local('cmd', 'cmd')]
const uck1 = [remote('k1', 'powershell', 'powershell', 'UCK1'), remote('k1', 'pwsh', 'pwsh', 'UCK1')]
const otra = [remote('zz', 'pwsh', 'pwsh', 'OTRA')]

check('sin máquinas emparejadas no hay nada que abrir', otherMachinePwsh(ucx, 'pwsh') === undefined)
check(
  'desde un panel local abre el pwsh de la UCK1, no el Windows PowerShell',
  otherMachinePwsh([...ucx, ...uck1], 'pwsh')?.id === '@k1/pwsh'
)
check('sin panel activo también', otherMachinePwsh([...ucx, ...uck1])?.id === '@k1/pwsh')
check(
  'con dos máquinas, sigue en la del panel activo',
  otherMachinePwsh([...ucx, ...uck1, ...otra], '@zz/pwsh')?.id === '@zz/pwsh'
)
check(
  'desde un panel local, la primera emparejada',
  otherMachinePwsh([...ucx, ...uck1, ...otra], 'cmd')?.id === '@k1/pwsh'
)
check(
  'una máquina sin pwsh no cuenta',
  otherMachinePwsh([...ucx, remote('k1', 'cmd', 'cmd', 'UCK1')], 'pwsh') === undefined
)

console.log(`\n${checks - failures}/${checks} ok`)
process.exit(failures ? 1 : 0)
