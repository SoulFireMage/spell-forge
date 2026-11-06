#!/usr/bin/env node
// Headless test suite for the sigil compiler and the genome operators.
//   npm test            (or: node tools/test.mjs [--walks 6] [--steps 8] [--randoms 24])
//
// Checks (the printability contract, AGENT_SPEC.md §1):
//  1. every preset, in every form, compiles to ONE watertight body, warning-free
//  2. WASM hygiene: every Manifold / CrossSection created is deleted (leak = 0)
//  3. free-text effects and long mutation / crossover walks at Wild Surge
//     volatility always compile to one connected watertight body
//  4. symmetry: un-fractured sigils are invariant under their rotation group
//  5. determinism (same effects → same genome hash) + share-link round trip
//  6. exporters: STL triangle count, 3MF zip signature, SVG well-formed
import Module from 'manifold-3d';
import { compileSigil } from '../src/sigil.js';
import { normalize, mutate, crossover, brood, encodeGenome, decodeGenome, hashGenome, allowed, CATALOG } from '../src/genome.js';
import { presetGenome, compileEffects, PRESET_SPELLS, EFFECTS } from '../src/lexicon.js';
import { stlBinary, threeMF, sigilSVG } from '../src/export.js';
import { rng } from '../src/geom.js';

const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? +argv[i + 1] : d; };
const WALKS = opt('walks', 5), STEPS = opt('steps', 6), RANDOMS = opt('randoms', 18);

const wasm = await Module();
wasm.setup();

// --- leak instrumentation (identity-based live set), as in Starship Drydock
const liveSet = new Set();
const isObj = (v) => v instanceof wasm.Manifold || v instanceof wasm.CrossSection;
const count = (r) => { if (isObj(r)) liveSet.add(r); else if (Array.isArray(r)) r.forEach(count); return r; };
const sampleM = wasm.Manifold.cube(1), sampleC = wasm.CrossSection.square(1);
const targets = [wasm.Manifold, wasm.CrossSection, Object.getPrototypeOf(sampleM), Object.getPrototypeOf(sampleC), wasm.Manifold.prototype, wasm.CrossSection.prototype];
sampleM.delete(); sampleC.delete();
for (const target of new Set(targets)) {
  for (const key of Object.getOwnPropertyNames(target)) {
    if (['constructor', 'delete', 'prototype', 'length', 'name', 'isDeleted', 'clone', 'isAliasOf', 'deleteLater'].includes(key)) continue;
    const d = Object.getOwnPropertyDescriptor(target, key);
    if (!d || typeof d.value !== 'function') continue;
    const f = d.value;
    target[key] = function (...a) { return count(f.apply(this, a)); };
  }
}
{
  let proto = wasm.Manifold.cube(1);
  const probe = proto;
  while (proto && !Object.getOwnPropertyNames(proto).includes('delete')) proto = Object.getPrototypeOf(proto);
  const del = proto.delete;
  proto.delete = function () { liveSet.delete(this); return del.call(this); };
  probe.delete();
  liveSet.clear();
}

let failures = 0, checks = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const ok = (cond, msg) => { checks++; if (!cond) fail(msg); return cond; };
{ // the detector must see a deliberate leak
  const c = wasm.CrossSection.circle(1), t = c.translate([1, 0]);
  if (liveSet.size !== 2) { console.log('leak detector broken: saw', liveSet.size); process.exit(2); }
  c.delete(); t.delete();
  if (liveSet.size !== 0) { console.log('leak detector broken'); process.exit(2); }
}

function check(label, genome, { solid = true, strictWarnings = false } = {}) {
  const before = liveSet.size;
  let r;
  try { r = compileSigil(wasm, genome, { solid }); } catch (e) { fail(`${label}: threw ${e.stack}`); return null; }
  const t = r.telemetry;
  ok(liveSet.size === before, `${label}: leaked ${liveSet.size - before} WASM handles`);
  ok(t.components === 1, `${label}: ${t.components} 2D components`);
  if (solid) {
    ok(t.status === 'NoError', `${label}: status ${t.status}`);
    ok(t.bodies === 1, `${label}: ${t.bodies} bodies`);
    ok(t.volumeMm3 > 0, `${label}: zero volume`);
  }
  if (strictWarnings) ok(t.warnings.length === 0, `${label}: warnings ${t.warnings.join(',')}`);
  else ok(!t.warnings.includes('DISCONNECTED'), `${label}: DISCONNECTED`);
  return r;
}

console.log('1. presets × forms');
for (const key of Object.keys(PRESET_SPELLS)) {
  for (const kind of ['openwork', 'medallion', 'coin']) {
    const r = check(`${key}/${kind}`, presetGenome(key, { kind }), { strictWarnings: true });
    if (r && kind === 'openwork') console.log(`  ${key.padEnd(16)} ${r.telemetry.symmetry.padEnd(4)} ${String(r.telemetry.massG).padStart(5)} g  ${r.telemetry.triangles} tris  ${r.telemetry.timingsMs.total} ms`);
  }
}

console.log('2. every primitive in the catalog');
{
  const base = presetGenome('ember-ward');
  for (const glyph of CATALOG.core) check(`core ${glyph}`, { ...base, core: { ...base.core, glyph } }, { solid: false });
  for (const style of CATALOG.spokes) for (const terminal of CATALOG.terminal) check(`spokes ${style}/${terminal}`, { ...base, spokes: { ...base.spokes, style, terminal } }, { solid: false });
  for (const kind of CATALOG.lattice) check(`lattice ${kind}`, { ...base, lattice: { ...base.lattice, kind } }, { solid: false });
  for (const style of CATALOG.ring) check(`ring ${style}`, { ...base, rings: [{ style, w: 0.07 }, { style, r: 0.6, w: 0.05 }] }, { solid: false });
  for (const kind of CATALOG.motif) check(`motif ${kind}`, { ...base, motifs: [{ kind, r: 0.6, phase: 0.5, size: 0.1, tier: 3 }] }, { solid: false });
  for (const [group, n] of [['C', 1], ['D', 1], ['C', 2], ['D', 2], ['D', 3], ['C', 7], ['D', 12]]) check(`symmetry ${group}${n}`, { ...base, symmetry: { group, n } });
  check('tiny pendant 20 mm, FDM walls', { ...base, form: { ...base.form, diameter: 20 } });
  check('resin 0.8 mm walls', { ...base, form: { ...base.form, minWall: 0.8, minGap: 0.4 } });
  check('desk totem plinth', { ...base, form: { ...base.form, kind: 'medallion', plinth: true, bail: false } });
  check('polygon medallion', { ...base, form: { ...base.form, kind: 'medallion', shape: 'polygon' } });
}

console.log('3. free text + Wild Surge walks');
{
  const r = rng(20261106);
  const words = ['protect', 'home', 'exam', 'calm', 'fire', 'luck', 'banish', 'dragon', 'phoenix', 'sleep', 'courage', 'chaos', 'my', 'cat', 'garden', 'bicycle', 'thunder', 'quiet', 'tea'];
  for (let i = 0; i < RANDOMS; i++) {
    const slots = Array.from({ length: r.int(1, 3) }, () => (r.chance(0.5) ? { id: r.pick(EFFECTS).id } : { text: Array.from({ length: r.int(1, 4) }, () => r.pick(words)).join(' ') }));
    const kind = r.pick(['openwork', 'openwork', 'medallion', 'coin']);
    check(`random ${i} ${JSON.stringify(slots)}`, compileEffects(slots, { form: { kind, bail: r.chance(0.6), diameter: r.range(25, 70) } }), { solid: i % 3 === 0 });
  }
  let disconnected = 0, total = 0;
  for (let w = 0; w < WALKS; w++) {
    let g = presetGenome(Object.keys(PRESET_SPELLS)[w % 6]);
    let other = presetGenome(Object.keys(PRESET_SPELLS)[(w + 2) % 6]);
    for (let s = 0; s < STEPS; s++) {
      g = s % 3 === 2 ? crossover(g, other, { seed: w * 100 + s }) : mutate(g, { seed: w * 1000 + s, volatility: 0.5 });
      total++;
      const res = check(`walk ${w}.${s}`, g, { solid: s === STEPS - 1 });
      if (res && res.telemetry.components !== 1) disconnected++;
      // children stay on-spell
      ok(allowed(g, 'core').includes(g.core.glyph) && allowed(g, 'spokes').includes(g.spokes.style) && g.rings.every((x) => allowed(g, 'ring').includes(x.style)), `walk ${w}.${s}: ${g.core.glyph}/${g.spokes.style} not allowed by its effects`);
    }
  }
  console.log(`  ${total} evolved sigils, ${disconnected} disconnected`);
}

console.log('4. symmetry invariance');
for (const key of ['ember-ward', 'still-water', 'phoenix-spark']) {
  const r = compileSigil(wasm, presetGenome(key), {});
  ok(r.telemetry.symmetryErrorPct !== null && r.telemetry.symmetryErrorPct < 1, `${key}: symmetry error ${r.telemetry.symmetryErrorPct}%`);
}

console.log('5. determinism + share links');
{
  const a = compileEffects([{ text: 'protect my home' }, { id: 'sustained' }]);
  const b = compileEffects([{ text: 'protect my home' }, { id: 'sustained' }]);
  ok(hashGenome(a) === hashGenome(b), 'same effects gave different genomes');
  ok(hashGenome(decodeGenome(encodeGenome(a))) === hashGenome(a), 'encode/decode round trip changed the genome');
  ok(hashGenome(mutate(a, { seed: 5 })) === hashGenome(mutate(a, { seed: 5 })), 'mutate is not deterministic');
  ok(brood([a], { seed: 3 }).length === 9, 'brood is not nine');
  ok(normalize({}).effects.length === 1, 'normalize({}) did not repair');
  ok(normalize({ symmetry: { n: 99 } }).symmetry.n === 12, 'symmetry not clamped');
}

console.log('6. exporters');
{
  const r = compileSigil(wasm, presetGenome('ember-ward'), { solid: true });
  const stl = stlBinary(r.mesh, 'x');
  ok(new DataView(stl.buffer).getUint32(80, true) === r.telemetry.triangles, 'STL triangle count');
  const mf = threeMF(r.mesh, { name: 'x', palette: r.genome.palette, relief: r.genome.relief });
  ok(mf[0] === 0x50 && mf[1] === 0x4b, '3MF is not a zip');
  const svg = sigilSVG(r);
  ok(svg.startsWith('<svg') && svg.includes('tier-3'), 'SVG malformed');
}

console.log(`\n${checks} checks, ${failures} failures, ${liveSet.size} live WASM handles at exit`);
process.exit(failures || liveSet.size ? 1 : 0);
