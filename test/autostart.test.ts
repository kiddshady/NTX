/**
 * El arranque con Windows al compartir (src/main/autostart.ts): qué decide
 * para cada caso, y que sus scripts de PowerShell parseen y encuentren tareas
 * de verdad. No crea ni borra tareas: eso pide admin y tocaría la máquina.
 *
 *   npm test
 */
import { execFileSync } from 'node:child_process'
import { SCRIPTS, findTasks, isElevated, planAutostart } from '../src/main/autostart'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

console.log('\nArranque con Windows: qué decide')
const T = ['\\NTX']
let p = planAutostart({ enabled: true, elevated: true, tasks: [], mode: 'run' })
check('elevado y compartiendo, sin tarea: la crea y saca la Run', p.create && !p.run && p.mode === 'task')
p = planAutostart({ enabled: true, elevated: true, tasks: T, mode: 'run' })
check('elevado y compartiendo, con una tarea: no crea otra, la pone en regla y saca la Run', !p.create && !p.run && p.fix.join() === T.join() && p.mode === 'task')
p = planAutostart({ enabled: true, elevated: false, tasks: [], mode: 'run' })
check('común y compartiendo, sin tarea: la Run de siempre', p.run && !p.create && p.mode === 'run')
p = planAutostart({ enabled: true, elevated: false, tasks: T, mode: 'run' })
check('común, con la tarea de admin a la vista: la respeta y no pone la Run', !p.run && !p.create && !p.remove.length && p.mode === 'task')
p = planAutostart({ enabled: true, elevated: false, tasks: [], mode: 'task' })
check('común, con la tarea invisible pero recordada: tampoco pone la Run', !p.run && p.mode === 'task')
p = planAutostart({ enabled: false, elevated: true, tasks: T, mode: 'task' })
check('elevado, dejar de compartir: borra la tarea y la Run', !p.run && p.remove.join() === T.join() && p.mode === 'run')
p = planAutostart({ enabled: false, elevated: false, tasks: T, mode: 'task' })
check('común, dejar de compartir con una tarea de admin: no la puede borrar y lo dice', !p.run && !p.remove.length && !!p.warning && p.mode === 'task')
p = planAutostart({ enabled: false, elevated: false, tasks: [], mode: 'run' })
check('común, dejar de compartir: saca la Run y nada más', !p.run && !p.create && !p.remove.length && !p.warning)

// La tarea que quedó apuntando a la carpeta vieja después de que el instalador se mudara.
const S = ['\\Umbro\\NTX (admin al iniciar)']
p = planAutostart({ enabled: true, elevated: true, tasks: [], stale: S, mode: 'task' })
check('elevado, con una tarea huérfana: la vuelve a apuntar y no crea otra', !p.create && !p.run && p.repoint.join() === S.join() && p.fix.join() === S.join())
p = planAutostart({ enabled: true, elevated: true, tasks: T, stale: S, mode: 'task' })
check('elevado, con una buena y una huérfana: apunta la huérfana y pone en regla las dos', !p.create && p.repoint.join() === S.join() && p.fix.length === 2)
p = planAutostart({ enabled: true, elevated: false, tasks: [], stale: S, mode: 'run' })
check('común, con una huérfana: no pone la Run (sería una copia común) y lo avisa', !p.run && !p.repoint.length && !!p.warning && p.mode === 'task')
p = planAutostart({ enabled: false, elevated: true, tasks: [], stale: S, mode: 'task' })
check('elevado, dejar de compartir: también borra la huérfana', p.remove.join() === S.join())

console.log('\nLos scripts de PowerShell')
const ps = (script: string, env: Record<string, string> = {}): string =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true
  }).trim()
for (const [name, script] of Object.entries(SCRIPTS)) {
  const errors = ps('$e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:S, [ref]$null, [ref]$e); $e.Count', { S: script })
  check(`«${name}» parsea sin errores`, errors === '0', errors)
}
const settings = ps("(New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)) | ForEach-Object { '{0}|{1}|{2}' -f $_.DisallowStartIfOnBatteries, $_.StopIfGoingOnBatteries, $_.ExecutionTimeLimit }")
check('la tarea arranca a batería, no se corta al desenchufar y no tiene tope de 72 h', settings === 'False|False|PT0S', settings)

check('isElevated contesta sí o no', typeof (await isElevated()) === 'boolean')
const nadie = await findTasks('C:\\no\\existe\\NTX-de-prueba.exe')
check('un exe que no lanza nadie no tiene tareas', nadie.tasks.length === 0 && nadie.stale.length === 0)
// Una tarea real de esta máquina: findTasks tiene que encontrarla por su programa.
const sample = ps("$ErrorActionPreference='SilentlyContinue'; foreach ($t in Get-ScheduledTask) { $x = @($t.Actions)[0].Execute; if ($x -and (Test-Path ([Environment]::ExpandEnvironmentVariables($x.Trim('\"'))))) { '{0}|{1}' -f ($t.TaskPath + $t.TaskName), $x; break } }")
if (sample) {
  const [task, exe] = sample.split('|')
  const found = await findTasks(exe.replace(/^"|"$/g, '').replace(/%([^%]+)%/g, (_, v: string) => process.env[v] ?? `%${v}%`))
  check('encuentra una tarea de verdad por su programa', found.tasks.includes(task), `${task} no está en ${found.tasks.join(', ')}`)
} else {
  console.log('  (esta máquina no tiene tareas con un programa a la vista: se saltea)')
}

console.log(`\n${checks - failures}/${checks} ok`)
process.exit(failures ? 1 : 0)
