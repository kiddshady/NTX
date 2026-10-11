/**
 * El arranque con Windows de una máquina que comparte (ver setHostEnabled).
 *
 * Hay dos maneras, y NTX usa la que corresponde a cómo está corriendo:
 *
 * - La clave Run de siempre (app.setLoginItemSettings): NTX común, sin admin.
 * - Una tarea programada al iniciar sesión, con los privilegios más altos: NTX
 *   como administrador. Fran la eligió para la UCK1 (11 oct 2026): las shells
 *   que abre la UCX allá tienen que poder hacer cosas de admin, y el cartel de
 *   UAC saldría en una pantalla que nadie está mirando.
 *
 * Las reglas:
 *
 * - Elevado y compartiendo: la tarea (se crea si no hay ya una que lance este
 *   exe) y NADA de clave Run. Con las dos, al iniciar sesión arrancaban una
 *   copia común y una elevada, y con instancia única la común podía ganar.
 * - Común y compartiendo: si ya hay una tarea, se la respeta y tampoco va la
 *   Run. Una tarea creada como admin puede no verse desde un proceso común, por
 *   eso remote.json recuerda el modo (`host.autostart`).
 * - Al dejar de compartir se saca todo lo que se pueda. Una tarea de admin solo
 *   la puede borrar un NTX elevado: desde uno común queda, y se avisa en el log.
 * - Al arrancar elevado y compartiendo, se pone en regla solo: si alguien (o el
 *   switch, en una versión vieja) dejó la clave Run, se va.
 *
 * Dos trampas de las tareas programadas que se evitan acá: con los valores de
 * fábrica, una tarea NO arranca si la notebook está a batería, y corta el
 * programa a las 72 horas. Las que lanzan NTX van con las dos cosas apagadas,
 * también si las creó otro.
 */
import { execFile } from 'node:child_process'
import { app } from 'electron'
import type { RemoteConfig } from './remoteConfig.js'

export type AutostartMode = 'run' | 'task'

/** El nombre de la tarea que crea NTX. Una que lance el mismo exe con otro
 *  nombre (hecha a mano) también cuenta: se la busca por el programa. */
export const TASK_NAME = 'NTX'

export interface AutostartInput {
  /** Si esta máquina comparte sus shells. */
  enabled: boolean
  /** Si NTX está corriendo como administrador. */
  elevated: boolean
  /** Las tareas programadas que lanzan este exe ("\carpeta\nombre"). */
  tasks: string[]
  /** Lo que quedó guardado la última vez. */
  mode: AutostartMode
}

export interface AutostartPlan {
  /** La clave Run: prendida o no. */
  run: boolean
  /** Crear la tarea de NTX. */
  create: boolean
  /** Tareas existentes a poner en regla (batería y tope de 72 h). */
  fix: string[]
  /** Tareas a borrar. */
  remove: string[]
  /** El modo que queda guardado. */
  mode: AutostartMode
  /** Algo que no se pudo hacer desde acá, para el log. */
  warning?: string
}

/** Qué hacer. Pura: todo lo que mira llega en `input`. */
export function planAutostart({ enabled, elevated, tasks, mode }: AutostartInput): AutostartPlan {
  const none = { create: false, fix: [] as string[], remove: [] as string[] }
  if (enabled && elevated) {
    return tasks.length
      ? { ...none, run: false, fix: tasks, mode: 'task' }
      : { ...none, run: false, create: true, mode: 'task' }
  }
  if (enabled) {
    return tasks.length || mode === 'task'
      ? { ...none, run: false, mode: 'task' }
      : { ...none, run: true, mode: 'run' }
  }
  if (elevated) return { ...none, run: false, remove: tasks, mode: 'run' }
  if (tasks.length || mode === 'task') {
    return {
      ...none,
      run: false,
      mode: 'task',
      warning: 'la tarea que arranca NTX como admin solo se puede sacar desde un NTX abierto como admin'
    }
  }
  return { ...none, run: false, mode: 'run' }
}

/* ── Windows ─────────────────────────────────────────────────────────────── */

/** Corre un script de PowerShell sin perfil. Los datos van por variables de
 *  entorno, nunca pegados en el script: así no hay comillas que escapar. */
function powershell(script: string, env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, ...env }, timeout: 30_000, windowsHide: true },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(String(stdout)))
    )
  })
}

/** Los scripts, a la vista para que el test los pueda parsear. */
export const SCRIPTS = {
  find: `
$ErrorActionPreference = 'SilentlyContinue'
$exe = [IO.Path]::GetFullPath($env:NTX_EXE)
foreach ($t in Get-ScheduledTask) {
  foreach ($a in @($t.Actions)) {
    if (-not $a.Execute) { continue }
    try { $p = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($a.Execute.Trim('"'))) } catch { continue }
    if ($p -ieq $exe) { $t.TaskPath + $t.TaskName; break }
  }
}`,
  create: `
$ErrorActionPreference = 'Stop'
$user = "$env:USERDOMAIN\\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $env:NTX_EXE -Argument '--hidden'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $env:NTX_TASK -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Arranca NTX como administrador al iniciar sesion (src/main/autostart.ts).' -Force | Out-Null`,
  fix: `
$ErrorActionPreference = 'Stop'
$i = $env:NTX_TASK.LastIndexOf('\\')
$path = $env:NTX_TASK.Substring(0, $i + 1)
$name = $env:NTX_TASK.Substring($i + 1)
$t = Get-ScheduledTask -TaskPath $path -TaskName $name
$s = $t.Settings
if ($s.DisallowStartIfOnBatteries -or $s.StopIfGoingOnBatteries -or $s.ExecutionTimeLimit -ne 'PT0S') {
  $s.DisallowStartIfOnBatteries = $false
  $s.StopIfGoingOnBatteries = $false
  $s.ExecutionTimeLimit = 'PT0S'
  Set-ScheduledTask -TaskPath $path -TaskName $name -Settings $s | Out-Null
}`,
  remove: `
$ErrorActionPreference = 'Stop'
$i = $env:NTX_TASK.LastIndexOf('\\')
Unregister-ScheduledTask -TaskPath $env:NTX_TASK.Substring(0, $i + 1) -TaskName $env:NTX_TASK.Substring($i + 1) -Confirm:$false`
}

/** ¿Corre como administrador? El nivel de integridad alto (S-1-16-12288) o el
 *  de sistema (S-1-16-16384) está en el token solo si el proceso está elevado. */
export function isElevated(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('whoami', ['/groups'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      resolve(!err && /S-1-16-(12288|16384)\b/.test(String(stdout)))
    })
  })
}

/** Las tareas que lanzan este exe. */
export async function findTasks(exe: string): Promise<string[]> {
  const out = await powershell(SCRIPTS.find, { NTX_EXE: exe }).catch(() => '')
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

const LOGIN_ARGS = ['--hidden']

/* De a un cambio a la vez: dos toques seguidos al switch no se pisan. */
let queue: Promise<void> = Promise.resolve()

/**
 * Pone el arranque con Windows en regla. `onlyIfElevated`: el chequeo del
 * arranque, que en un NTX común no toca nada (si alguien puso NTX en el inicio
 * por su cuenta, el arranque normal no se lo desarma).
 */
export function syncAutostart(
  enabled: boolean,
  config: RemoteConfig,
  save: (config: RemoteConfig) => void,
  { onlyIfElevated = false } = {}
): Promise<void> {
  const run = async (): Promise<void> => {
    if (!app.isPackaged) return
    if (process.platform !== 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, args: LOGIN_ARGS })
      return
    }
    const elevated = await isElevated()
    if (onlyIfElevated && !elevated) return
    const exe = process.execPath
    const tasks = await findTasks(exe)
    const plan = planAutostart({ enabled, elevated, tasks, mode: config.host.autostart ?? 'run' })

    app.setLoginItemSettings({ openAtLogin: plan.run, args: LOGIN_ARGS })
    const step = (what: string, p: Promise<unknown>): Promise<unknown> =>
      p.catch((err: Error) => console.error(`[autostart] no pude ${what}:`, err.message))
    if (plan.create) await step('crear la tarea', powershell(SCRIPTS.create, { NTX_EXE: exe, NTX_TASK: TASK_NAME }))
    for (const t of plan.fix) await step(`poner en regla ${t}`, powershell(SCRIPTS.fix, { NTX_TASK: t }))
    for (const t of plan.remove) await step(`borrar ${t}`, powershell(SCRIPTS.remove, { NTX_TASK: t }))
    if (plan.warning) console.warn(`[autostart] ${plan.warning}`)

    if (config.host.autostart !== plan.mode) {
      config.host.autostart = plan.mode
      save(config)
    }
    console.log(
      `[autostart] ${enabled ? 'compartiendo' : 'sin compartir'}, ${elevated ? 'como admin' : 'sin admin'}: ` +
        `Run ${plan.run ? 'sí' : 'no'}, tareas ${plan.create ? `nueva (${TASK_NAME})` : tasks.join(', ') || 'ninguna'}` +
        (plan.remove.length ? `, borradas ${plan.remove.join(', ')}` : '')
    )
  }
  queue = queue.then(run).catch((err: Error) => console.error('[autostart]', err.message))
  return queue
}
