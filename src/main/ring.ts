/**
 * La historia de salida de un panel: los últimos `cap` caracteres, numerados.
 *
 * `end` es cuánto escupió el panel desde que nació (el offset del próximo
 * carácter) y `start` desde dónde todavía se guarda. Todo lo que el cliente
 * pida entre esos dos se le puede devolver exacto; lo anterior a `start` ya se
 * fue, y el cliente se entera porque el chunk le llega con un `at` más adelante
 * de lo que esperaba.
 */
export class OutputRing {
  private chunks: string[] = []
  private size = 0
  /** Offset absoluto del próximo carácter. */
  end = 0

  constructor(private readonly cap: number) {}

  get start(): number {
    return this.end - this.size
  }

  push(data: string): void {
    this.chunks.push(data)
    this.size += data.length
    this.end += data.length

    // Se descarta de a chunks enteros mientras sobren; el último que queda
    // colgando del borde se recorta por la mitad. Nunca se vacía del todo.
    while (this.size > this.cap && this.chunks.length > 1) {
      const head = this.chunks[0]!
      if (this.size - head.length >= this.cap) {
        this.chunks.shift()
        this.size -= head.length
      } else {
        const excess = this.size - this.cap
        this.chunks[0] = head.slice(excess)
        this.size -= excess
      }
    }
    if (this.size > this.cap) {
      // Un solo chunk más grande que todo el anillo.
      const only = this.chunks[0]!
      this.chunks[0] = only.slice(only.length - this.cap)
      this.size = this.cap
    }
  }

  /** Lo guardado desde `from` (acotado a lo que queda). `at` dice desde dónde
   *  arranca de verdad: si es mayor que `from`, hubo un hueco. */
  since(from: number): { at: number; data: string } {
    const at = Math.max(from, this.start)
    if (at >= this.end) return { at: this.end, data: '' }
    const joined = this.chunks.join('')
    // Compactar de paso: el join ya se pagó.
    this.chunks = joined ? [joined] : []
    return { at, data: joined.slice(at - this.start) }
  }
}
