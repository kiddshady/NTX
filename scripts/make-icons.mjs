/**
 * Regenera build/icon.ico y build/icon.png desde build/icon.svg.
 *
 *   node scripts/make-icons.mjs        → arranca en http://localhost:8643
 *   (abrir esa URL una vez; los archivos se escriben solos y el server se corta)
 *
 * ── Por qué un server y no una librería ────────────────────────────────────
 *
 * El master tiene degradés, un patrón de scanlines y dos capas de blur. Rasterizar
 * eso a mano sería reescribir medio motor de SVG, y meter una dependencia de
 * render sólo para tocar el ícono cada tanto no se paga. Chromium ya sabe hacerlo
 * y está acá al lado: la página dibuja el SVG en un canvas de cada tamaño y
 * devuelve los PNG por POST, que este server escribe en build/.
 *
 * El .ico se arma acá con un encoder propio (los ICO modernos admiten PNG crudo
 * adentro), así que no hace falta nada más instalado.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'build');
const PORT = 8643;

// Los tamaños que espera electron-builder adentro del .ico, más el 512 suelto.
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

const PAGE = `<!doctype html><meta charset="utf-8"><title>NTX · rasterizando</title>
<body style="background:#08080a;color:#9a9aa3;font:13px system-ui;padding:32px">
<h1 style="color:#ececef;font-size:16px">Rasterizando el ícono de NTX…</h1>
<div id="log"></div>
<div id="strip" style="display:flex;gap:12px;align-items:flex-end;margin-top:24px"></div>
<script>
const SIZES = ${JSON.stringify(SIZES)};
const log = (m) => { document.getElementById('log').innerHTML += m + '<br>'; };
const img = new Image();
img.onerror = () => log('<b style="color:#ff2e88">no pude cargar icon.svg</b>');
img.onload = async () => {
  for (const s of SIZES) {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, s, s);
    if (s <= 128) document.getElementById('strip').appendChild(c);
    const b64 = c.toDataURL('image/png').split(',')[1];
    await fetch('/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: s, b64 })
    });
    log('  ' + s + '×' + s + ' listo');
  }
  const r = await fetch('/done', { method: 'POST' }).then((x) => x.text());
  log('<b style="color:#00e5ff">' + r + '</b>');
};
img.src = '/icon.svg?v=' + Date.now();
</script>`;

/** ICO con PNG embebidos. */
function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 significa 256
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const got = new Map();

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }

  if (req.method === 'GET' && req.url.startsWith('/icon.svg')) {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end(fs.readFileSync(path.join(BUILD, 'icon.svg')));
  }

  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { size, b64 } = JSON.parse(body);
      got.set(size, Buffer.from(b64, 'base64'));
      res.writeHead(200).end('ok');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/done') {
    // El 512 va suelto como icon.png; el resto entra al .ico.
    const png512 = got.get(512);
    if (png512) fs.writeFileSync(path.join(BUILD, 'icon.png'), png512);

    const forIco = SIZES.filter((s) => s <= 256)
      .map((size) => ({ size, data: got.get(size) }))
      .filter((i) => i.data);
    const ico = encodeICO(forIco);
    fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);

    // El tray tampoco sale de acá: scripts/make-tray.mjs rasteriza la misma
    // pieza —baldosa y glifo— por su cuenta, sin depender de abrir esta página
    // en un browser.
    const msg = `icon.ico (${forIco.map((i) => i.size).join(', ')}) y icon.png 512 escritos en build/`;
    console.log(msg);
    res.writeHead(200).end(msg);
    setTimeout(() => server.close(() => process.exit(0)), 300);
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => console.log(`rasterizador en http://localhost:${PORT}`));
