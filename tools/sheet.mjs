#!/usr/bin/env node
// Contact sheet of 2D sigils (presets, or a brood) → snapshots/sheet.png. Needs Playwright.
//   node tools/sheet.mjs                 presets
//   node tools/sheet.mjs --brood ember-ward 0.3
import Module from 'manifold-3d';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compileSigil } from '../src/sigil.js';
import { sigilSVG } from '../src/export.js';
import { presetGenome, PRESET_SPELLS } from '../src/lexicon.js';
import { brood } from '../src/genome.js';

const argv = process.argv.slice(2);
const wasm = await Module(); wasm.setup();
let gs;
if (argv[0] === '--brood') gs = brood([presetGenome(argv[1] || 'ember-ward')], { seed: 42, volatility: +(argv[2] || 0.25) });
else gs = Object.keys(PRESET_SPELLS).map((k) => presetGenome(k));
const cells = gs.map((g) => {
  const t = Date.now(); const r = compileSigil(wasm, g); const ms = Date.now() - t;
  return `<figure>${sigilSVG(r, { size: 300, background: '#0d0710' })}<figcaption>${r.genome.meta.name} · ${r.telemetry.symmetry} · ${r.genome.core.glyph}/${r.genome.spokes.style}/${r.genome.rings.map((x) => x.style).join('+')} · ${ms}ms · ${r.telemetry.warnings.join(',') || 'ok'} br=${r.telemetry.islandsBridged}</figcaption></figure>`;
});
mkdirSync('snapshots', { recursive: true });
const html = `<html><body style="background:#111;color:#ccc;font:11px monospace;display:grid;grid-template-columns:repeat(3,310px);gap:8px">${cells.join('')}</body></html>`;
writeFileSync('snapshots/sheet.html', html);
const { chromium } = await (await import('./pw.mjs')).playwright();
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 960, height: 400 } });
await p.setContent(html); await p.screenshot({ path: 'snapshots/sheet.png', fullPage: true }); await b.close();
console.log('snapshots/sheet.png');
