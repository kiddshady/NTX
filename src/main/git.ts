import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Resolvemos el branch con `git`, y lo cacheamos: el cwd llega en CADA render del
 * prompt, o sea varias veces por segundo si alguien deja el enter apretado. Sin
 * cache eso serían decenas de procesos por segundo.
 */
const cache = new Map<string, { branch: string | null; at: number }>()
const TTL_MS = 2_000

export function branchFor(cwd: string): Promise<string | null> {
  if (!cwd || !existsSync(cwd)) return Promise.resolve(null)

  const hit = cache.get(cwd)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.branch)

  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, timeout: 1_500, windowsHide: true },
      (err, stdout) => {
        // Error = no es un repo, o no hay git en el PATH. Las dos son normales:
        // se cachean igual para no reintentar en cada prompt.
        const branch = err ? null : stdout.trim() || null
        cache.set(cwd, { branch, at: Date.now() })
        resolve(branch)
      }
    )
  })
}
