"""
Genera assets/fonts/ntx-marks.ttf: el ● y el ❯ de Claude Code con las medidas
que tienen en Windows Terminal, sobre la celda de Roboto Mono.

    python scripts/make-marks.py      (necesita fontTools: pip install fonttools)

── Para qué ───────────────────────────────────────────────────────────────────

Roboto Mono no trae ni el ● (las viñetas de las respuestas) ni el ❯ (el prompt).
Windows Terminal los saca del respaldo de Windows: el ● de Segoe UI (un círculo
de 0,43 em) y el ❯ de Segoe UI Symbol (un chevron fino de 0,43 × 0,72 em). En
NTX caían a JetBrains Mono, la segunda de la pila, que los dibuja distinto: el ●
de 0,62 em, más ancho que la celda, y el ❯ angosto y grueso, casi un paréntesis.

En Windows, fonts.css los pide primero a esas mismas Segoe con local(): salen
idénticos a Windows Terminal. Esta fuente es el segundo src de esas dos caras,
para donde no hay Segoe: el celu (NTX Mobile compila el fonts.css de NTX). Por
eso los glifos copian las medidas de los de Segoe, dibujados acá desde cero:
el círculo y un chevron de siete puntos.

El avance es el de Roboto (1229/2048, 0,6 em) y no el de Segoe, para que xterm
no tenga que corregir el ancho con letter-spacing. Las métricas verticales son
las de Roboto, como en ntx-blocks-roboto.ttf. Sin hinting.
"""

import math
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

FONTS = Path(__file__).resolve().parent.parent / 'src' / 'renderer' / 'src' / 'assets' / 'fonts'
ROBOTO = FONTS / 'roboto-mono.ttf'
DST = FONTS / 'ntx-marks.ttf'

# Todo en unidades de Roboto Mono: 2048 por em.
UPM = 2048

# ● (U+25CF): el de Segoe UI mide 0,43 em y tiene el centro a 0,282 em de la
# línea base.
DOT_DIAMETER = 880
DOT_CENTER_Y = 578

# ❯ (U+276F): el de Segoe UI Symbol. Dos brazos que se juntan en una punta
# chata; CHEVRON_STROKE es el grueso del brazo medido en horizontal.
CHEVRON_WIDTH = 886
CHEVRON_TOP = 1458
CHEVRON_BOTTOM = -25
CHEVRON_STROKE = 322
CHEVRON_TIP = 24  # la mitad del alto de la punta chata


def dot(pen, cx: float) -> None:
    """Un círculo con cuatro cúbicas (Cu2QuPen las pasa a cuadráticas)."""
    r = DOT_DIAMETER / 2
    cy = DOT_CENTER_Y
    k = r * 4 * (math.sqrt(2) - 1) / 3
    # En sentido horario, que es el de un contorno exterior en TrueType.
    pen.moveTo((cx, cy + r))
    pen.curveTo((cx + k, cy + r), (cx + r, cy + k), (cx + r, cy))
    pen.curveTo((cx + r, cy - k), (cx + k, cy - r), (cx, cy - r))
    pen.curveTo((cx - k, cy - r), (cx - r, cy - k), (cx - r, cy))
    pen.curveTo((cx - r, cy + k), (cx - k, cy + r), (cx, cy + r))
    pen.closePath()


def chevron(pen, cx: float) -> None:
    left = cx - CHEVRON_WIDTH / 2
    right = cx + CHEVRON_WIDTH / 2
    middle = (CHEVRON_TOP + CHEVRON_BOTTOM) / 2
    # El canto de adentro del codo: el borde interior de cada brazo es el
    # exterior corrido CHEVRON_STROKE a la izquierda, seguido hasta la mitad.
    slope = (CHEVRON_WIDTH - CHEVRON_STROKE) / (CHEVRON_TOP - middle - CHEVRON_TIP)
    inner = right - CHEVRON_STROKE + slope * CHEVRON_TIP
    pen.moveTo((left + CHEVRON_STROKE, CHEVRON_TOP))
    pen.lineTo((right, middle + CHEVRON_TIP))
    pen.lineTo((right, middle - CHEVRON_TIP))
    pen.lineTo((left + CHEVRON_STROKE, CHEVRON_BOTTOM))
    pen.lineTo((left, CHEVRON_BOTTOM))
    pen.lineTo((inner, middle))
    pen.lineTo((left, CHEVRON_TOP))
    pen.closePath()


def draw(shape, cx: float):
    pen = TTGlyphPen(None)
    shape(Cu2QuPen(pen, max_err=1, reverse_direction=False), cx)
    glyph = pen.glyph()
    # TTGlyphPen deja los puntos en float; el glyf los quiere enteros.
    glyph.coordinates.toInt()
    return glyph


def main() -> None:
    roboto = TTFont(ROBOTO)
    advance = roboto['hmtx']['a'][0]
    hhea, os2 = roboto['hhea'], roboto['OS/2']
    cx = advance / 2

    names = ['.notdef', 'uni25CF', 'uni276F']
    glyphs = {
        '.notdef': TTGlyphPen(None).glyph(),
        'uni25CF': draw(dot, cx),
        'uni276F': draw(chevron, cx),
    }

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({0x25CF: 'uni25CF', 0x276F: 'uni276F'})
    fb.setupGlyf(glyphs)
    glyf = fb.font['glyf']
    metrics = {}
    for name in names:
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        metrics[name] = (advance, glyph.xMin if glyph.numberOfContours > 0 else 0)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=hhea.ascent, descent=hhea.descent, lineGap=0)
    fb.setupNameTable({'familyName': 'NTX Marks', 'styleName': 'Regular'})
    fb.setupOS2(
        sTypoAscender=os2.sTypoAscender,
        sTypoDescender=os2.sTypoDescender,
        sTypoLineGap=os2.sTypoLineGap,
        usWinAscent=os2.usWinAscent,
        usWinDescent=os2.usWinDescent,
        xAvgCharWidth=advance,
    )
    fb.setupPost(isFixedPitch=1)
    fb.save(DST)
    print(f'{DST.name}: ● {DOT_DIAMETER}/{UPM} em, ❯ {CHEVRON_WIDTH}×{CHEVRON_TOP - CHEVRON_BOTTOM}/{UPM} em')


if __name__ == '__main__':
    main()
