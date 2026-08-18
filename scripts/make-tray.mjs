/**
 * Genera los íconos del tray a partir de la MISMA geometría del ícono de la app.
 *
 *   node scripts/make-tray.mjs
 *
 * ── Qué dibuja ──────────────────────────────────────────────────────────────
 *
 * La pieza completa del ícono de la app: la baldosa oscura detrás y el glifo
 * encima, a sangre, igual que en la barra de tareas. Hubo una versión con el
 * glifo solo (con baldosa el `>_` queda en ~9px de ancho a 16, y sobre la barra
 * oscura de Windows la baldosa casi no se ve), pero dejaba al tray como la
 * única cara de NTX sin baldosa: se prefiere la pieza completa y se asume el
 * glifo chico.
 *
 * Del master no se rasterizan las scanlines ni el glow: a 16 y 32px son
 * sub-píxel (período 26/962·16 ≈ 0.4px; blur 30/962·16 ≈ 0.5px) y sólo
 * ensuciarían el trazo.
 *
 * La geometría es la misma de build/icon.svg, en el mismo espacio de 1024, así
 * que el tray y el ícono de la app no se pueden desincronizar por accidente.
 *
 * Se rasteriza a mano —campos de distancia, con supersampling— en vez de meter
 * una dependencia de render de SVG: son dos trazos con puntas redondeadas y un
 * rect redondeado, y así el resultado es idéntico en cualquier máquina y no
 * depende de qué motor de SVG haya instalado.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ── La forma, en el espacio de 1024 de build/icon.svg ──────────────────────
const CHEVRON = { pts: [[278, 307], [498, 483], [278, 659]], w: 66 };
const DASH = { pts: [[566, 665], [761, 665]], w: 92 };

// El degradé del glifo, también el del master: cian arriba-izquierda, magenta
// abajo-derecha.
const GRAD = { x1: 245, y1: 274, x2: 807, y2: 711, from: [0x00, 0xe5, 0xff], to: [0xff, 0x2e, 0x88] };

// La baldosa: rect 31–993 de esquinas 205 con degradé vertical, los números del
// master. Allá un transform la lleva a sangre; acá sale igual porque el lienzo
// destino se encuadra contra la baldosa y no contra el viewBox.
const TILE = { x0: 31, y0: 31, x1: 993, y1: 993, r: 205, from: [0x14, 0x14, 0x1f], to: [0x08, 0x08, 0x0e] };

const SS = 4; // supersampling por eje: 16 muestras por píxel

/** Distancia de un punto al segmento AB. */
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/** Distancia mínima a una polilínea. Con puntas redondeadas, "dentro" es
 *  simplemente distancia <= mitad del trazo — de ahí que el cap y el join
 *  redondos salgan gratis. */
function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i], pts[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Color del degradé en un punto: proyección sobre el eje del gradiente. */
function gradientAt(x, y) {
  const dx = GRAD.x2 - GRAD.x1;
  const dy = GRAD.y2 - GRAD.y1;
  const len2 = dx * dx + dy * dy;
  let t = ((x - GRAD.x1) * dx + (y - GRAD.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return [
    Math.round(GRAD.from[0] + (GRAD.to[0] - GRAD.from[0]) * t),
    Math.round(GRAD.from[1] + (GRAD.to[1] - GRAD.from[1]) * t),
    Math.round(GRAD.from[2] + (GRAD.to[2] - GRAD.from[2]) * t)
  ];
}

/** Color del fondo de la baldosa a una altura dada: degradé vertical puro. */
function tileAt(y) {
  let t = (y - TILE.y0) / (TILE.y1 - TILE.y0);
  t = Math.max(0, Math.min(1, t));
  return [
    Math.round(TILE.from[0] + (TILE.to[0] - TILE.from[0]) * t),
    Math.round(TILE.from[1] + (TILE.to[1] - TILE.from[1]) * t),
    Math.round(TILE.from[2] + (TILE.to[2] - TILE.from[2]) * t)
  ];
}

/**
 * Rasteriza a un buffer RGBA de size×size.
 *
 * El lienzo destino se mapea contra la baldosa (31–993), que por eso queda a
 * sangre: su borde ES el borde del ícono, como en el ícono de la app. El glifo
 * cae donde el master lo pone —apenas arriba del centro— y no se re-encuadra.
 */
function render(size) {
  const scale = (TILE.x1 - TILE.x0) / size;
  const center = (TILE.x0 + TILE.x1) / 2;        // 512, en ambos ejes
  const straight = (TILE.x1 - TILE.x0) / 2 - TILE.r; // tramo recto hasta la esquina

  const px = Buffer.alloc(size * size * 4, 0);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      let rr = 0, gg = 0, bb = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Centro de la submuestra, llevado al espacio del master.
          const gx = TILE.x0 + (x + (sx + 0.5) / SS) * scale;
          const gy = TILE.y0 + (y + (sy + 0.5) / SS) * scale;

          // Fuera del rect redondeado no hay nada: distancia con signo clásica.
          const qx = Math.abs(gx - center) - straight;
          const qy = Math.abs(gy - center) - straight;
          if (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) > TILE.r) continue;

          const inChevron = distToPolyline(gx, gy, CHEVRON.pts) <= CHEVRON.w / 2;
          const inDash = distToPolyline(gx, gy, DASH.pts) <= DASH.w / 2;
          const [r, g, b] = inChevron || inDash ? gradientAt(gx, gy) : tileAt(gy);
          rr += r; gg += g; bb += b;
          hits++;
        }
      }

      if (!hits) continue;
      const total = SS * SS;
      const i = (y * size + x) * 4;
      // El color promedia SÓLO las muestras que cayeron dentro; si promediara
      // todas, el borde de la baldosa tiraría a negro y saldría un halo sucio.
      px[i] = Math.round(rr / hits);
      px[i + 1] = Math.round(gg / hits);
      px[i + 2] = Math.round(bb / hits);
      px[i + 3] = Math.round((hits / total) * 255);
    }
  }
  return px;
}

// ── Encoder PNG mínimo (RGBA de 8 bits, sin filtro) ────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  // 10,11,12 = compresión, filtro e interlace, todos 0.

  // Cada scanline va precedida por su byte de filtro (0 = None).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Empaqueta varios PNG en un .ico.
 *
 * En Windows el tray conviene que sea ICO y no PNG: el shell elige de adentro el
 * tamaño que le pide el DPI en vez de reescalar uno solo, así que a 125% o 150%
 * no sale borroso. Los ICO modernos admiten PNG crudo adentro, que es lo que se
 * hace acá — nada de BMP con máscara.
 */
function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // 1 = ícono
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    // 0 significa 256: un byte no llega a ese número.
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // paleta
    e[3] = 0; // reservado
    e.writeUInt16LE(1, 4);  // planos
    e.writeUInt16LE(32, 6); // bits por píxel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// ── Salida ─────────────────────────────────────────────────────────────────
const OUT = path.resolve(import.meta.dirname, '..', 'resources', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// Sin padding: la baldosa va a sangre y el aire alrededor del glifo lo da ella.
const built = [];
for (const [name, size] of [['tray.png', 16], ['tray@2x.png', 32]]) {
  const png = encodePNG(size, render(size));
  fs.writeFileSync(path.join(OUT, name), png);
  built.push({ size, data: png });
  console.log(`  ${name.padEnd(14)} ${size}×${size}  ${png.length} bytes`);
}

const ico = encodeICO(built);
fs.writeFileSync(path.join(OUT, 'tray.ico'), ico);
console.log(`  ${'tray.ico'.padEnd(14)} 16+32      ${ico.length} bytes`);
console.log('Tray generado desde la geometría de build/icon.svg.');
