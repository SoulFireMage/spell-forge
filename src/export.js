// export.js — plain-data exporters: SVG (tiers), binary STL, 3MF. No WASM, no DOM.

const f = (v) => (Math.round(v * 1000) / 1000).toString();
const pathOf = (polys) => polys.map((p) => `M${p.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L')}Z`).join('');

/**
 * Tier polygons → SVG. Y is flipped so +Y (the bail) is up.
 * @param {object} r      compileSigil result (tiers, bridges, radius)
 * @param {object} [o]    { palette, background, bridges: bool, size: px | null (mm units if null), stroke }
 */
export function sigilSVG(r, o = {}) {
  const pal = o.palette || r.genome.palette;
  const R = r.radius;
  const pad = R * 0.08 + (r.genome.form.bail ? 8 : 0);
  const all = [...r.tiers.t1, ...r.tiers.t2];
  let x0 = -R - pad, y0 = -R - pad, x1 = R + pad, y1 = R + pad;
  for (const p of all) for (const [x, y] of p) { x0 = Math.min(x0, x - 1); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, -y - 1); y1 = Math.max(y1, -y + 1); }
  const w = x1 - x0, h = y1 - y0;
  const size = o.size ? `width="${o.size}" height="${(o.size * h) / w}"` : `width="${f(w)}mm" height="${f(h)}mm"`;
  const bg = o.background ? `<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="${o.background}"/>` : '';
  const sw = o.stroke ? ` stroke="${o.stroke}" stroke-width="${f(R * 0.006)}"` : '';
  const bridges = o.bridges !== false && r.bridges && r.bridges.length
    ? `<path d="${pathOf(r.bridges)}" fill="${pal.bridge}" fill-opacity="0.85" fill-rule="evenodd"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" ${size}>
<title>${esc(r.genome.meta.name)}</title>${bg}
<g id="tier-1"><path d="${pathOf(r.tiers.t1)}" fill="${pal.t1}" fill-rule="evenodd"${sw}/></g>
<g id="bridges">${bridges}</g>
<g id="tier-2"><path d="${pathOf(r.tiers.t2)}" fill="${pal.t2}" fill-rule="evenodd"${sw}/></g>
<g id="tier-3"><path d="${pathOf(r.tiers.t3)}" fill="${pal.t3}" fill-rule="evenodd"${sw}/></g>
</svg>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** { positions, indices } → binary STL (mm). */
export function stlBinary(mesh, name = 'sigil') {
  const { positions: P, indices: I } = mesh;
  const nt = I.length / 3;
  const buf = new ArrayBuffer(84 + 50 * nt);
  const dv = new DataView(buf);
  const head = `Soulfire Spellforge: ${name}`.slice(0, 79);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------- 3MF (zip, stored)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Minimal store-only zip writer: [{ name, data: Uint8Array }] → Uint8Array. */
export function zip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nm = enc.encode(name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
    chunks.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, c) => a + c.length, 0));
  let p = 0; for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}

/**
 * 3MF with per-triangle colours by relief tier (from each triangle's height),
 * so slicers that read 3MF materials show the tiers; and the filament-swap
 * heights in the metadata for those that don't.
 */
export function threeMF(mesh, { name = 'Sigil', palette, relief, inscription = '' } = {}) {
  const { positions: P, indices: I } = mesh;
  const tierOf = (z) => (z <= relief.t1 + 1e-3 ? 0 : z <= relief.t2 + 1e-3 ? 1 : 2);
  const v = [], t = [];
  for (let i = 0; i < P.length; i += 3) v.push(`<vertex x="${f(P[i])}" y="${f(P[i + 1])}" z="${f(P[i + 2])}"/>`);
  for (let i = 0; i < I.length; i += 3) {
    const zc = Math.max(P[I[i] * 3 + 2], P[I[i + 1] * 3 + 2], P[I[i + 2] * 3 + 2]);
    t.push(`<triangle v1="${I[i]}" v2="${I[i + 1]}" v3="${I[i + 2]}" pid="1" p1="${tierOf(zc - 1e-3)}"/>`);
  }
  const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-GB" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${xmlEsc(name)}</metadata>
<metadata name="Application">Soulfire Mage's Spellforge</metadata>
<metadata name="Description">${xmlEsc(inscription)} | Filament swaps at ${relief.t1} mm and ${relief.t2} mm.</metadata>
<resources>
<basematerials id="1"><base name="Tier 1" displaycolor="${palette.t1}FF"/><base name="Tier 2" displaycolor="${palette.t2}FF"/><base name="Tier 3" displaycolor="${palette.t3}FF"/></basematerials>
<object id="2" type="model" pid="1" pindex="0" name="${xmlEsc(name)}"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>
</resources>
<build><item objectid="2"/></build>
</model>`;
  const enc = new TextEncoder();
  return zip([
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}
