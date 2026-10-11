"""
Genera assets/fonts/ntx-blocks.ttf: los block elements de JetBrains Mono con los
bordes de la celda corridos un pelito hacia afuera.

    python scripts/make-blocks.py      (necesita fontTools: pip install fonttools)

── Para qué ───────────────────────────────────────────────────────────────────

Todo dibujo hecho con bloques (el mascot de Claude Code, las barras de btop)
salía con una costura vertical en cada borde de celda: una rayita de 1px más
oscura, verdosa con ClearType porque se come sólo el subpíxel rojo.

La celda mide 0,6 em: a 12,5px son 7,5px, y el borde entre dos celdas cae en
medio píxel. Cada glifo se suaviza por separado, así que ese píxel lo tapa la
mitad un bloque y la mitad el otro, y dos coberturas de 50% compuestas dan 75%,
no 100%. xterm no tiene arreglo para esto con el renderer DOM (`customGlyphs`
sólo vale para canvas/WebGL, y el WebGL está descartado: ver TerminalPane), y
redondear el tamaño de fuente tampoco alcanza: probado a 13,333px (celda de 8px
justos) y el hinting igual deja el bloque un pelo más angosto o más ancho.

Lo que sí anda es que los bloques vecinos se pisen: cada punto del contorno que
está sobre un borde de la celda (x = 0, x = avance, y = ascent, y = descent) se
corre E unidades hacia afuera. Los bordes internos (la mitad de ▐, el corte de
los cuadrantes) no se tocan, y el avance sigue en 600, así que la medida de la
celda no cambia. El pisotón es de E/1000 em: 0,3px a 12,5px, invisible en la
silueta.

Quedan afuera las tramas ░▒▓: son semitransparentes a propósito, y donde se
pisaran se verían más oscuras.

Va como una @font-face más de 'JetBrains Mono' con unicode-range (fonts.css),
igual que los emojis. La fuente sale sin hinting: para rectángulos no hace falta.
"""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent.parent / 'src' / 'renderer' / 'src' / 'assets' / 'fonts'
SRC = FONTS / 'jetbrains-mono-400.ttf'
DST = FONTS / 'ntx-blocks.ttf'

# Cuánto sale cada borde, en unidades de la fuente (1000 por em).
E = 24

# U+2580–259F menos las tramas ░▒▓ (2591–2593). Si cambia, cambiar también el
# unicode-range en fonts.css.
CODEPOINTS = [c for c in range(0x2580, 0x25A0) if c not in (0x2591, 0x2592, 0x2593)]


def main() -> None:
    options = subset.Options()
    options.hinting = False
    options.name_IDs = ['*']
    options.layout_features = []
    font = TTFont(SRC)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=CODEPOINTS)
    subsetter.subset(font)

    ascent, descent = font['hhea'].ascent, font['hhea'].descent
    glyf = font['glyf']
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours <= 0:
            continue
        advance = font['hmtx'][name][0]
        coords = glyph.coordinates
        for i, (x, y) in enumerate(coords):
            if x <= 0:
                x = -E
            elif x >= advance:
                x = advance + E
            if y <= descent:
                y = descent - E
            elif y >= ascent:
                y = ascent + E
            coords[i] = (x, y)
        glyph.recalcBounds(glyf)
        # El lsb del hmtx tiene que seguir al xMin nuevo. El rasterizador ubica el
        # glifo con el lsb, no con el contorno: si queda en 0 con xMin = -E, todo el
        # bloque se corre E a la derecha (sobra 2E de un lado y falta del otro), y
        # el pisotón de la izquierda no existe. Así salió la 0.19.1: dentro de un
        # mismo span lo que sobraba a la derecha igual tapaba la costura. Con un
        # fondo en la celda de al lado no (ver term/cellBackgrounds.ts).
        font['hmtx'][name] = (advance, glyph.xMin)

    for record in font['name'].names:
        if record.nameID in (1, 4, 16):
            record.string = 'NTX Blocks'
        elif record.nameID == 6:
            record.string = 'NTXBlocks-Regular'

    font.save(DST)
    print(f'{DST.name}: {len(CODEPOINTS)} glifos, E = {E}')


if __name__ == '__main__':
    main()
