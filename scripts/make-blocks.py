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

── La de Roboto Mono (ntx-blocks-roboto.ttf) ──────────────────────────────────

Roboto Mono, la otra fuente de la terminal (Ctrl+Shift+L), no trae NI los
bloques NI el box drawing (─ │ ┌ ├): 0 de 160. Sacarlos de JetBrains por el
respaldo no sirve, porque la celda de Roboto tiene otro alto: 2146/555 sobre
2048 contra 1020/300 sobre 1000, o sea que un │ de JetBrains quedaba medio
píxel corto arriba y los marcos de los TUI salían cortados en cada fila.

Así que se sacan los dos rangos de JetBrains y se estiran a la celda de Roboto:
la celda de una (avance × ascent-descent) va a parar justo sobre la de la otra.
Los bloques llevan además el pisotón de arriba; el box drawing no, igual que en
la de JetBrains, donde nunca hizo falta.
"""

from pathlib import Path

from fontTools import subset
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent.parent / 'src' / 'renderer' / 'src' / 'assets' / 'fonts'
SRC = FONTS / 'jetbrains-mono-400.ttf'
DST = FONTS / 'ntx-blocks.ttf'
ROBOTO = FONTS / 'roboto-mono.ttf'
DST_ROBOTO = FONTS / 'ntx-blocks-roboto.ttf'

# Cuánto sale cada borde, en unidades de la fuente (1000 por em).
E = 24

# U+2580–259F menos las tramas ░▒▓ (2591–2593). Si cambia, cambiar también el
# unicode-range en fonts.css.
CODEPOINTS = [c for c in range(0x2580, 0x25A0) if c not in (0x2591, 0x2592, 0x2593)]


# El box drawing entero (U+2500–257F), que sólo va en la de Roboto.
BOX = list(range(0x2500, 0x2580))


def extract(unicodes: list[int]) -> TTFont:
    """Los glifos de JetBrains Mono de esos caracteres, sin hinting."""
    options = subset.Options()
    options.hinting = False
    options.name_IDs = ['*']
    options.layout_features = []
    font = TTFont(SRC)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    return font


def push_edges(font: TTFont, names: set[str]) -> None:
    """Corre E hacia afuera los puntos de esos glifos que caen en el borde de la celda."""
    ascent, descent = font['hhea'].ascent, font['hhea'].descent
    glyf = font['glyf']
    for name in names:
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


def rename(font: TTFont, family: str) -> None:
    for record in font['name'].names:
        if record.nameID in (1, 4, 16):
            record.string = family
        elif record.nameID == 6:
            record.string = family.replace(' ', '') + '-Regular'


def blocks_jetbrains() -> None:
    font = extract(CODEPOINTS)
    push_edges(font, set(font.getGlyphOrder()))
    rename(font, 'NTX Blocks')
    font.save(DST)
    print(f'{DST.name}: {len(CODEPOINTS)} glifos, E = {E}')


def blocks_roboto() -> None:
    font = extract(BOX + CODEPOINTS)
    cmap = font.getBestCmap()
    push_edges(font, {cmap[c] for c in CODEPOINTS if c in cmap})

    # La celda de JetBrains sobre la de Roboto: el avance sobre el avance y el
    # alto de línea (descent a ascent) sobre el alto de línea.
    roboto = TTFont(ROBOTO)
    advance = roboto['hmtx']['a'][0]
    ascent, descent = roboto['hhea'].ascent, roboto['hhea'].descent
    jb_advance = font['hmtx'][cmap[0x2588]][0]
    jb_ascent, jb_descent = font['hhea'].ascent, font['hhea'].descent
    sx = advance / jb_advance
    sy = (ascent - descent) / (jb_ascent - jb_descent)
    dy = descent - jb_descent * sy

    # Se redibujan todos antes de guardar ninguno: el box drawing de JetBrains
    # tiene compuestos, y un compuesto leería a su componente ya estirado. El
    # dibujo a través del glyphSet los descompone.
    glyph_set = font.getGlyphSet()
    drawn = {}
    for name in font.getGlyphOrder():
        pen = TTGlyphPen(None)
        glyph_set[name].draw(TransformPen(pen, (sx, 0, 0, sy, 0, dy)))
        drawn[name] = pen.glyph()
    glyf = font['glyf']
    for name, glyph in drawn.items():
        glyf[name] = glyph
        glyph.recalcBounds(glyf)
        font['hmtx'][name] = (advance, glyph.xMin if glyph.numberOfContours > 0 else 0)

    font['head'].unitsPerEm = roboto['head'].unitsPerEm
    font['hhea'].ascent, font['hhea'].descent, font['hhea'].lineGap = ascent, descent, 0
    os2, ros2 = font['OS/2'], roboto['OS/2']
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = (
        ros2.sTypoAscender, ros2.sTypoDescender, ros2.sTypoLineGap)
    os2.usWinAscent, os2.usWinDescent = ros2.usWinAscent, ros2.usWinDescent
    os2.fsSelection &= ~(1 << 7)  # USE_TYPO_METRICS: como en Roboto, apagado
    os2.xAvgCharWidth = advance
    font['hhea'].advanceWidthMax = advance

    rename(font, 'NTX Blocks Roboto')
    font.save(DST_ROBOTO)
    print(f'{DST_ROBOTO.name}: {len(drawn) - 1} glifos, x {sx:.4f}, y {sy:.4f} + {dy:.1f}')


def main() -> None:
    blocks_jetbrains()
    blocks_roboto()


if __name__ == '__main__':
    main()
