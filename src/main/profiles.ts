import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ShellProfile } from '../shared/types.js'

/**
 * Los scripts de init viven fuera del asar (van por `extraResources`), porque en
 * producción el shell los abre como un archivo cualquiera del disco: adentro del
 * asar no existen para nadie que no sea Node.
 */
function shellInitDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'shell-init')
    : join(app.getAppPath(), 'src', 'main', 'shell-init')
}

/**
 * Convierte `S:\tools\NTX\x.sh` en `/mnt/s/tools/NTX/x.sh`.
 *
 * Vale sólo para WSL con automount en su default. Si el usuario lo movió o lo
 * apagó, la ruta no resuelve y bash simplemente arranca sin sourcear nada — o
 * sea que perdemos el OSC 7, no la shell.
 */
function toWslPath(winPath: string): string {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(winPath)
  if (!m) return winPath
  return `/mnt/${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, '/')}`
}

/** El primer candidato que exista en disco, o null. */
function firstExisting(candidates: string[]): string | null {
  return candidates.find((c) => existsSync(c)) ?? null
}

/**
 * Detecta qué shells hay realmente instaladas en esta máquina.
 *
 * Devolvemos sólo perfiles cuyo ejecutable existe: un perfil que no arranca es
 * peor que no ofrecerlo. El orden importa — el primero es el default de NTX.
 */
export function detectProfiles(): ShellProfile[] {
  const system = process.env.SystemRoot ?? 'C:\\Windows'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const initPs1 = join(shellInitDir(), 'ntx-init.ps1')
  const initSh = join(shellInitDir(), 'ntx-init.sh')

  const profiles: ShellProfile[] = []

  // PowerShell 7. Dot-sourceamos el init por variable de entorno y no inline en
  // el -Command: así una ruta con espacios o comillas no rompe el parseo.
  const pwsh = firstExisting([
    join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    join(programFilesX86, 'PowerShell', '7', 'pwsh.exe')
  ])
  if (pwsh) {
    profiles.push({
      id: 'pwsh',
      label: 'PowerShell 7',
      kind: 'pwsh',
      exec: pwsh,
      args: ['-NoLogo', '-NoExit', '-Command', '. $env:NTX_INIT'],
      initFile: initPs1
    })
  }

  // Windows PowerShell 5.1 — el fallback que siempre está.
  const winps = firstExisting([
    join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  ])
  if (winps) {
    profiles.push({
      id: 'powershell',
      label: 'Windows PowerShell',
      kind: 'powershell',
      exec: winps,
      args: ['-NoLogo', '-NoExit', '-Command', '. $env:NTX_INIT'],
      initFile: initPs1
    })
  }

  // cmd no tiene dónde colgar un OSC 7 por prompt, pero al menos lo abrimos en
  // UTF-8 para que un .exe nativo no escupa mojibake.
  const cmd = firstExisting([process.env.ComSpec ?? '', join(system, 'System32', 'cmd.exe')])
  if (cmd) {
    profiles.push({
      id: 'cmd',
      label: 'Command Prompt',
      kind: 'cmd',
      exec: cmd,
      args: ['/K', 'chcp 65001 > nul']
    })
  }

  const gitBash = firstExisting([
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe')
  ])
  if (gitBash) {
    profiles.push({
      id: 'gitbash',
      label: 'Git Bash',
      kind: 'gitbash',
      exec: gitBash,
      args: ['-i', '--rcfile', initSh],
      initFile: initSh
    })
  }

  const wsl = firstExisting([join(system, 'System32', 'wsl.exe')])
  if (wsl) {
    profiles.push({
      id: 'wsl',
      label: 'WSL',
      kind: 'wsl',
      exec: wsl,
      args: ['--', 'bash', '-i', '--rcfile', toWslPath(initSh)],
      initFile: initSh
    })
  }

  return profiles
}
