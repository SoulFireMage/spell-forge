// genome.js — the Sigil Genome: schema, gene ranges, the Laws of Sympathetic
// Geometry (which primitives each magical domain may use), and the evolution
// operators (normalise / mutate / crossover / encode).
//
// The genome describes ONE WEDGE of the sigil plus a symmetry group; the
// compiler (sigil.js) lifts that wedge to the whole disc. So mutation can do
// anything inside the wedge and the declared symmetry still can't break.
import { rng, hash32, clamp } from './geom.js?v=1.1.0';

export const SCHEMA = 'sigil-genome/1';
export const DOMAINS = ['ward', 'kinetic', 'focus', 'entropy'];

// ---------------------------------------------------------------------------
// Laws of Sympathetic Geometry: what each domain may draw with.
// (requirements §2 table; motifs are "inspired by", never reproductions of
// living sacred symbols.)
// ---------------------------------------------------------------------------
export const LAWS = {
  ward: {
    symmetry: [['D', 6], ['D', 8]],
    core: ['wardarms', 'polygon', 'star'],
    spokes: ['bar', 'wave'],
    terminal: ['fork', 'orb', 'none'],
    lattice: ['chords', 'web'],
    ring: ['teeth', 'plain', 'braid', 'notched'],
    motif: ['diamond', 'ringlet', 'orb'],
  },
  kinetic: {
    symmetry: [['C', 3], ['C', 5], ['C', 7]],
    core: ['swirl', 'star', 'flame', 'polygon'],
    spokes: ['spiral', 'wave', 'bar'],
    terminal: ['spear', 'flame'],
    lattice: ['none', 'chords'],
    ring: ['wave', 'teeth', 'plain'],
    motif: ['tri', 'swirl', 'flame'],
  },
  focus: {
    symmetry: [['D', 2], ['D', 4], ['D', 1]],
    core: ['eye', 'rosette', 'seed', 'star'],
    spokes: ['bar', 'wave', 'none'],
    terminal: ['orb', 'none'],
    lattice: ['vesica', 'web', 'none'],
    ring: ['plain', 'braid', 'wave'],
    motif: ['orb', 'ringlet', 'diamond'],
  },
  entropy: {
    symmetry: [['C', 1], ['D', 3], ['C', 2]],
    core: ['wedge', 'star', 'flame'],
    spokes: ['zigzag', 'bar'],
    terminal: ['spear', 'fork', 'none'],
    lattice: ['none', 'chords'],
    ring: ['split', 'notched', 'teeth'],
    motif: ['wedge', 'tri'],
  },
};

export const CATALOG = {
  core: ['star', 'rosette', 'swirl', 'eye', 'polygon', 'seed', 'wedge', 'wardarms', 'flame'],
  spokes: ['none', 'bar', 'wave', 'spiral', 'zigzag'],
  terminal: ['none', 'spear', 'orb', 'fork', 'flame'],
  lattice: ['none', 'vesica', 'chords', 'web'],
  ring: ['plain', 'teeth', 'wave', 'braid', 'notched', 'split'],
  motif: ['orb', 'ringlet', 'tri', 'wedge', 'swirl', 'diamond', 'flame'],
  form: ['openwork', 'medallion', 'coin'],
  shape: ['disc', 'polygon'],
};

/** Which slot governs which layer (requirements §2, Stage 1). */
export const SLOT_OF = { symmetry: 1, core: 1, spokes: 2, terminal: 2, lattice: 2, motif: 2, ring: 3 };

// ---------------------------------------------------------------------------
// Numeric genes: [min, max]. Lengths are fractions of the sigil radius R.
// Mutation drift is volatility × span (so 0.05 = "5% parameter drift").
// ---------------------------------------------------------------------------
export const GENES = {
  core: { r: [0.12, 0.42], inner: [0.25, 0.8], w: [0.03, 0.09], twist: [-0.6, 0.6], mult: [1, 3, 'int'] },
  spokes: {
    mult: [1, 3, 'int'], r0: [0.08, 0.6], r1: [0.55, 1.0], w: [0.03, 0.08], amp: [0, 0.12], waves: [1, 4, 'int'],
    twist: [-1.2, 1.2], phase: [0, 1], termSize: [0.05, 0.16],
  },
  lattice: { r: [0.3, 0.8], size: [0.15, 0.5], w: [0.025, 0.06], step: [1, 3, 'int'], mult: [1, 2, 'int'] },
  ring: { r: [0.28, 0.92], w: [0.035, 0.1], count: [1, 4, 'int'], depth: [0.03, 0.1], phase: [0, 1], gaps: [1, 3, 'int'], gapDeg: [6, 24] },
  motif: { r: [0.22, 0.9], phase: [0, 1], size: [0.05, 0.14] },
  fracture: { cuts: [0, 3, 'int'], w: [0.03, 0.07], jag: [0, 1] },
  relief: { t1: [1.0, 3.0], t2: [1.6, 5.0], t3: [2.2, 7.0] },
  form: { diameter: [20, 120], minWall: [0.4, 3.0], minGap: [0.3, 2.0], bevel: [0, 2.5], plinthDepth: [6, 20] },
};

export const LIMITS = { rings: [1, 4], motifs: [0, 4], effects: [1, 3], maxSpokes: 24 };

export const DEFAULT_FORM = {
  kind: 'openwork', shape: 'disc', diameter: 45, minWall: 1.6, minGap: 0.8, bevel: 0.8,
  bail: true, plinth: false, plinthDepth: 12,
};
export const DEFAULT_RELIEF = { t1: 1.8, t2: 3.0, t3: 4.0 };
export const DEFAULT_PALETTE = { t1: '#3b1830', t2: '#d0643a', t3: '#ffcf6e', bridge: '#9fe6ff' };

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, [lo, hi, kind], d) => {
  let x = Number.isFinite(+v) ? +v : d;
  x = clamp(x, lo, hi);
  return kind === 'int' ? Math.round(x) : x;
};
const oneOf = (v, opts, d) => (opts.includes(v) ? v : d);

// ---------------------------------------------------------------------------
// Domain weights → allowed primitive sets
// ---------------------------------------------------------------------------
export function normWeights(w = {}) {
  const out = {}; let s = 0;
  for (const d of DOMAINS) { out[d] = Math.max(0, +w[d] || 0); s += out[d]; }
  if (s <= 1e-9) { out.focus = 1; s = 1; }
  for (const d of DOMAINS) out[d] /= s;
  return out;
}

/** Weights governing a layer: its slot's effect, falling back to the primary. */
export function slotWeights(genome, slot) {
  const e = genome.effects.find((x) => x.slot === slot) || genome.effects[0];
  return normWeights(e && e.w);
}

/** Options a layer may use, given the effects: union over domains with ≥ 20% weight (the top domain always counts). */
export function allowed(genome, category) {
  const w = slotWeights(genome, SLOT_OF[category]);
  const top = DOMAINS.reduce((a, b) => (w[b] > w[a] ? b : a));
  const set = new Set();
  for (const d of DOMAINS) if (d === top || w[d] >= 0.2) LAWS[d][category].forEach((o) => set.add(o));
  return [...set];
}

/** Allowed symmetry groups for the primary slot, as "D6"-style keys. */
export function allowedSymmetry(genome) {
  return allowed(genome, 'symmetry').map((s) => (Array.isArray(s) ? `${s[0]}${s[1]}` : s));
}

/** Weighted pick of an option for a layer, using the slot's domain weights. */
export function pickFor(w, category, r) {
  const scores = new Map();
  for (const d of DOMAINS) {
    const opts = LAWS[d][category];
    opts.forEach((o, i) => {
      const k = Array.isArray(o) ? `${o[0]}${o[1]}` : o;
      scores.set(k, (scores.get(k) || 0) + w[d] * (1 / (1 + i * 0.6)) * (w[d] >= 0.2 || w[d] === Math.max(...Object.values(w)) ? 1 : 0));
    });
  }
  const entries = [...scores].filter(([, s]) => s > 0);
  let t = r() * entries.reduce((a, [, s]) => a + s, 0);
  for (const [k, s] of entries) { t -= s; if (t <= 0) return k; }
  return entries[entries.length - 1][0];
}

export const parseSym = (k) => ({ group: k[0] === 'C' ? 'C' : 'D', n: clamp(parseInt(k.slice(1), 10) || 1, 1, 12) });

// ---------------------------------------------------------------------------
// normalize: the compiler never trusts input
// ---------------------------------------------------------------------------
export function normalize(input) {
  const g = clone(input || {});
  const G = GENES;
  const out = { schema: SCHEMA };

  const meta = g.meta || {};
  out.meta = {
    name: String(meta.name || 'Unnamed Sigil').slice(0, 80),
    inscription: String(meta.inscription || '').slice(0, 600),
    generation: Math.max(0, Math.round(+meta.generation || 0)),
    lineage: Array.isArray(meta.lineage) ? meta.lineage.slice(-24).map(String) : [],
    seed: (+meta.seed >>> 0) || 1,
    ...(meta.compiler ? { compiler: String(meta.compiler).slice(0, 40) } : {}),
  };

  let effects = Array.isArray(g.effects) ? g.effects.slice(0, 3) : [];
  if (!effects.length) effects = [{ slot: 1, id: 'clarity', text: '', w: { focus: 1 } }];
  out.effects = effects.map((e, i) => ({
    slot: i + 1,
    id: e.id ? String(e.id).slice(0, 40) : null,
    text: String(e.text || '').slice(0, 160),
    label: String(e.label || e.id || e.text || `Effect ${i + 1}`).slice(0, 60),
    w: normWeights(e.w),
  }));

  const sym = g.symmetry || {};
  out.symmetry = { group: sym.group === 'C' ? 'C' : 'D', n: clamp(Math.round(+sym.n || 6), 1, 12) };
  const n = out.symmetry.n;

  const c = g.core || {};
  out.core = {
    glyph: oneOf(c.glyph, CATALOG.core, 'star'),
    r: num(c.r, G.core.r, 0.26), inner: num(c.inner, G.core.inner, 0.5), w: num(c.w, G.core.w, 0.05),
    twist: num(c.twist, G.core.twist, 0), mult: num(c.mult, G.core.mult, 1), well: !!c.well,
  };

  const s = g.spokes || {};
  const maxMult = Math.max(1, Math.min(n <= 2 ? 6 : 3, Math.floor(LIMITS.maxSpokes / n)));
  out.spokes = {
    style: oneOf(s.style, CATALOG.spokes, 'bar'),
    mult: clamp(Math.round(+s.mult || 1), 1, maxMult),
    r0: num(s.r0, G.spokes.r0, 0.3), r1: num(s.r1, G.spokes.r1, 0.95), w: num(s.w, G.spokes.w, 0.045),
    amp: num(s.amp, G.spokes.amp, 0.04), waves: num(s.waves, G.spokes.waves, 2), twist: num(s.twist, G.spokes.twist, 0.4),
    phase: num(s.phase, G.spokes.phase, 0), terminal: oneOf(s.terminal, CATALOG.terminal, 'none'),
    termSize: num(s.termSize, G.spokes.termSize, 0.08),
  };
  // spokes start inside the core and end on (or past) the rim, so they always tie the layers together
  out.spokes.r0 = Math.min(out.spokes.r0, out.core.r * 0.9);
  out.spokes.r1 = Math.max(out.spokes.r1, 0.97);

  const l = g.lattice || {};
  out.lattice = {
    kind: oneOf(l.kind, CATALOG.lattice, 'none'),
    r: num(l.r, G.lattice.r, 0.55), size: num(l.size, G.lattice.size, 0.3), w: num(l.w, G.lattice.w, 0.035),
    step: num(l.step, G.lattice.step, 2), mult: num(l.mult, G.lattice.mult, 1),
  };

  let rings = Array.isArray(g.rings) ? g.rings.slice(0, LIMITS.rings[1]) : [];
  if (!rings.length) rings = [{ style: 'plain' }];
  out.rings = rings.map((r, i) => ({
    style: oneOf(r.style, CATALOG.ring, 'plain'),
    r: num(r.r, G.ring.r, 0.6), w: num(r.w, G.ring.w, 0.06),
    count: num(r.count, G.ring.count, 1), depth: num(r.depth, G.ring.depth, 0.05),
    phase: num(r.phase, G.ring.phase, 0), gaps: num(r.gaps, G.ring.gaps, 1), gapDeg: num(r.gapDeg, G.ring.gapDeg, 12),
    inward: r.inward !== false,
  }));
  // ring 0 is the containment rim: it sits on the edge, always.
  out.rings[0].r = 1 - out.rings[0].w / 2;
  for (let i = 1; i < out.rings.length; i++) out.rings[i].r = Math.min(out.rings[i].r, 0.92 - out.rings[0].w);
  out.rings = [out.rings[0], ...out.rings.slice(1).sort((a, b) => b.r - a.r)];

  out.motifs = (Array.isArray(g.motifs) ? g.motifs.slice(0, LIMITS.motifs[1]) : []).map((m) => ({
    kind: oneOf(m.kind, CATALOG.motif, 'orb'),
    r: num(m.r, G.motif.r, 0.6), phase: num(m.phase, G.motif.phase, 0.5), size: num(m.size, G.motif.size, 0.08),
    tier: m.tier === 2 ? 2 : 3,
  }));

  const f = g.fracture || {};
  out.fracture = { cuts: num(f.cuts, G.fracture.cuts, 0), w: num(f.w, G.fracture.w, 0.045), jag: num(f.jag, G.fracture.jag, 0.5), seed: (+f.seed >>> 0) || 7 };

  const rl = { ...DEFAULT_RELIEF, ...(g.relief || {}) };
  const t1 = num(rl.t1, G.relief.t1, 1.8);
  const t2 = Math.max(num(rl.t2, G.relief.t2, 3.0), t1 + 0.4);
  const t3 = Math.max(num(rl.t3, G.relief.t3, 4.0), t2 + 0.4);
  out.relief = { t1, t2, t3 };

  const fm = { ...DEFAULT_FORM, ...(g.form || {}) };
  out.form = {
    kind: oneOf(fm.kind, CATALOG.form, 'openwork'), shape: oneOf(fm.shape, CATALOG.shape, 'disc'),
    diameter: num(fm.diameter, G.form.diameter, 45), minWall: num(fm.minWall, G.form.minWall, 1.6),
    minGap: num(fm.minGap, G.form.minGap, 0.8), bevel: num(fm.bevel, G.form.bevel, 0.8),
    bail: !!fm.bail, plinth: !!fm.plinth, plinthDepth: num(fm.plinthDepth, G.form.plinthDepth, 12),
  };

  const p = { ...DEFAULT_PALETTE, ...(g.palette || {}) };
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v) ? v : d);
  out.palette = { t1: hex(p.t1, DEFAULT_PALETTE.t1), t2: hex(p.t2, DEFAULT_PALETTE.t2), t3: hex(p.t3, DEFAULT_PALETTE.t3), bridge: hex(p.bridge, DEFAULT_PALETTE.bridge) };
  return out;
}

// ---------------------------------------------------------------------------
// Evolution: mutate / crossover / brood
// ---------------------------------------------------------------------------

/** Numeric drift on every number in a block that has a GENES range. */
function drift(block, ranges, r, v, rate) {
  for (const [k, range] of Object.entries(ranges)) {
    if (!(k in block) || typeof block[k] !== 'number' || !r.chance(rate)) continue;
    const [lo, hi, kind] = range;
    let x = block[k] + r.gauss() * v * (hi - lo);
    if (kind === 'int') x = block[k] + (r.chance(Math.min(0.9, v * 2)) ? (r.chance(0.5) ? 1 : -1) : 0);
    block[k] = clamp(x, lo, hi);
    if (kind === 'int') block[k] = Math.round(block[k]);
  }
}

/** Bring every categorical layer back within what the bound effects allow (the Laws). */
export function onSpell(g, r) {
  const fix = (cat, v) => { const ok = allowed(g, cat); return ok.includes(v) ? v : r.pick(ok); };
  g.core.glyph = fix('core', g.core.glyph);
  g.spokes.style = fix('spokes', g.spokes.style);
  g.spokes.terminal = fix('terminal', g.spokes.terminal);
  g.lattice.kind = fix('lattice', g.lattice.kind);
  g.rings.forEach((ring) => { ring.style = fix('ring', ring.style); });
  g.motifs.forEach((m) => { m.kind = fix('motif', m.kind); });
  const syms = allowedSymmetry(g);
  if (!syms.includes(`${g.symmetry.group}${g.symmetry.n}`)) g.symmetry = parseSym(r.pick(syms));
  return g;
}

/**
 * mutate(parent, { seed, volatility }) → child genome.
 *   volatility 0.05 = Harmonic Refinement (5% drift, no substitutions)
 *   volatility 0.50 = Wild Surge (50% drift + primitive substitution)
 * Substitutions only ever pick from what the bound effects allow, and the
 * symmetry order only moves within the primary effect's groups, so children
 * stay "on-spell".
 */
export function mutate(parent, { seed = 1, volatility = 0.15 } = {}) {
  const g = normalize(parent);
  const r = rng(seed);
  const v = clamp(volatility, 0.02, 0.6);
  const rate = clamp(0.35 + v, 0.35, 0.9);
  const sub = v <= 0.12 ? 0 : clamp((v - 0.12) * 1.4, 0, 0.55); // primitive substitution chance

  drift(g.core, GENES.core, r, v, rate);
  drift(g.spokes, GENES.spokes, r, v, rate);
  drift(g.lattice, GENES.lattice, r, v, rate * 0.8);
  g.rings.forEach((ring) => drift(ring, GENES.ring, r, v, rate * 0.8));
  g.motifs.forEach((m) => drift(m, GENES.motif, r, v, rate));
  drift(g.fracture, GENES.fracture, r, v * 0.5, rate * 0.5);
  if (r.chance(v)) g.fracture.seed = r.int(1, 1e9);

  // rotate inner rings / swap terminals etc. (requirements §2 Stage 3)
  if (r.chance(sub)) g.core.glyph = r.pick(allowed(g, 'core'));
  if (r.chance(sub)) g.spokes.style = r.pick(allowed(g, 'spokes'));
  if (r.chance(sub)) g.spokes.terminal = r.pick(allowed(g, 'terminal'));
  if (r.chance(sub * 0.8)) g.lattice.kind = r.pick(allowed(g, 'lattice'));
  for (const ring of g.rings) if (r.chance(sub * 0.7)) ring.style = r.pick(allowed(g, 'ring'));
  for (const m of g.motifs) if (r.chance(sub)) m.kind = r.pick(allowed(g, 'motif'));
  if (r.chance(sub * 0.4)) g.core.well = !g.core.well;
  if (r.chance(sub * 0.5)) g.symmetry = parseSym(r.pick(allowedSymmetry(g)));
  if (r.chance(sub * 0.5)) { // structural: add / remove an inner ring or motif
    if (g.rings.length > 1 && r.chance(0.4)) g.rings.splice(r.int(1, g.rings.length - 1), 1);
    else if (g.rings.length < LIMITS.rings[1]) g.rings.push({ style: r.pick(allowed(g, 'ring')), r: r.range(0.35, 0.8), w: r.range(0.04, 0.07) });
  }
  if (r.chance(sub * 0.5)) {
    if (g.motifs.length && r.chance(0.4)) g.motifs.splice(r.int(0, g.motifs.length - 1), 1);
    else if (g.motifs.length < LIMITS.motifs[1]) g.motifs.push({ kind: r.pick(allowed(g, 'motif')), r: r.range(0.35, 0.85), phase: r(), size: r.range(0.06, 0.11), tier: r.chance(0.5) ? 2 : 3 });
  }
  onSpell(g, r);
  g.meta.generation += 1;
  return normalize(g);
}

/**
 * crossover(a, b, { seed }) → child. Uniform crossover by layer block: each
 * layer (core+symmetry travel together, spokes, lattice, rings, motifs,
 * relief) comes whole from one parent, with occasional numeric blending of
 * blocks whose shape matches. Form, effects and palette follow parent A (they
 * are the user's choices, not genes).
 */
export function crossover(a, b, { seed = 1 } = {}) {
  const A = normalize(a), B = normalize(b);
  const r = rng(seed);
  const pick = () => (r.chance(0.5) ? A : B);
  const blend = (x, y, ranges) => {
    const o = { ...x };
    if (!r.chance(0.35)) return o;
    const t = r.range(0.25, 0.75);
    for (const [k, [, , kind]] of Object.entries(ranges)) if (typeof x[k] === 'number' && typeof y[k] === 'number') o[k] = kind === 'int' ? (r.chance(t) ? y[k] : x[k]) : x[k] + (y[k] - x[k]) * t;
    return o;
  };
  const c = clone(A);
  const coreFrom = pick();
  c.symmetry = clone(coreFrom.symmetry);
  c.core = blend(coreFrom.core, (coreFrom === A ? B : A).core, GENES.core);
  const sp = pick(); c.spokes = blend(sp.spokes, (sp === A ? B : A).spokes, GENES.spokes);
  c.lattice = clone(pick().lattice);
  c.rings = clone(pick().rings);
  c.motifs = clone(pick().motifs);
  c.fracture = clone(pick().fracture);
  c.relief = clone(pick().relief);
  c.meta.generation = Math.max(A.meta.generation, B.meta.generation) + 1;
  return normalize(onSpell(c, r));
}

/**
 * brood(parents, { seed, volatility }) → 9 children for the crucible.
 * One parent: nine mutants, volatility ramping gently → wild across the grid.
 * Two parents: crossover then mutation, alternating which parent leads.
 */
export function brood(parents, { seed = 1, volatility = 0.15, count = 9 } = {}) {
  const r = rng(seed);
  const kids = [];
  for (let i = 0; i < count; i++) {
    const v = volatility * (0.6 + 0.8 * (i / Math.max(1, count - 1)));
    let base = parents[0];
    if (parents.length > 1) base = crossover(parents[i % 2], parents[(i + 1) % 2], { seed: r.int(1, 1e9) });
    const k = mutate(base, { seed: r.int(1, 1e9), volatility: v });
    k.meta.lineage = [...(parents[0].meta.lineage || []), hashGenome(parents[0])].slice(-24);
    k.meta.generation = Math.max(...parents.map((p) => p.meta.generation)) + 1;
    kids.push(k);
  }
  return kids;
}

// ---------------------------------------------------------------------------
// Hash + share encoding
// ---------------------------------------------------------------------------

/** Canonical design hash: everything that shapes the object (meta excluded). */
export function hashGenome(g) {
  const n = normalize(g);
  const { meta, ...design } = n;
  const round = (k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
  const h = hash32(JSON.stringify(design, round));
  return `SF1-${h.toString(16).padStart(8, '0').toUpperCase()}`;
}

const b64u = {
  enc: (s) => {
    const bytes = new TextEncoder().encode(s);
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec: (s) => {
    const bin = typeof atob === 'function' ? atob(s.replace(/-/g, '+').replace(/_/g, '/')) : Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('binary');
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  },
};
export function encodeGenome(g) {
  const round = (k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
  return b64u.enc(JSON.stringify(normalize(g), round));
}
export const decodeGenome = (s) => normalize(JSON.parse(b64u.dec(s)));

