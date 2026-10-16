/** Las dos letras mono, que se alternan con Ctrl+Shift+L. Las usa la terminal
 *  y, desde la 1.3.0, también la interfaz (--ntx-font-mono, ver uiFont.ts). */
export type TerminalFont = 'jetbrains' | 'roboto'

/** La pila de cada una para xterm. Roboto Mono lleva a JetBrains de segunda:
 *  le pone lo que no trae (flechas, geometría, powerline, las tramas ░▒▓ y los
 *  emojis achicados de fonts.css), y las dos miden 0,6 em de ancho, así que lo
 *  prestado entra en la celda. El box drawing y los bloques NO salen de ahí:
 *  ver ntx-blocks-roboto en fonts.css. */
export const TERMINAL_FONTS: Record<TerminalFont, string> = {
  jetbrains: "'JetBrains Mono', 'Noto Sans Symbols 2', monospace",
  roboto: "'Roboto Mono', 'JetBrains Mono', 'Noto Sans Symbols 2', monospace"
}

/** Las familias que main.tsx carga enteras antes del primer render. */
export const TERMINAL_FAMILIES = ['JetBrains Mono', 'Roboto Mono', 'Noto Sans Symbols 2']

const FONT_KEY = 'ntx:font'

/** JetBrains es la de siempre: sólo un 'roboto' guardado la cambia. */
export function loadTerminalFont(): TerminalFont {
  return window.localStorage.getItem(FONT_KEY) === 'roboto' ? 'roboto' : 'jetbrains'
}

export function saveTerminalFont(font: TerminalFont): void {
  window.localStorage.setItem(FONT_KEY, font)
}
