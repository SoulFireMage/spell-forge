// lexicon.js — the deterministic Thaumaturgical Compiler.
//
// Turns 1–3 effects (curated presets or free text) into domain weights, then
// into a Generation-0 Sigil Genome. No network, no LLM: same words in → same
// sigil out, everywhere. The optional LLM (llm.js) only ever produces the
// same intermediate form (domain weights + a few hints + an inscription) and
// then comes back through compileEffects() here, so it can't produce an
// invalid or unprintable genome.
import { rng, hash32, PHI } from './geom.js?v=1.2.0';
import { normalize, normWeights, pickFor, parseSym, allowed, allowedSymmetry, DOMAINS, DEFAULT_FORM, DEFAULT_RELIEF, DOMAIN_PALETTE, paletteOf } from './genome.js?v=1.2.0';

// ---------------------------------------------------------------------------
// Curated taxonomy (requirements §2 Stage 1). Weights over the four domains.
// ---------------------------------------------------------------------------
export const EFFECTS = [
  // Slot 1 — Primary Intent (the Core)
  { id: 'clarity', label: 'Clarity', slot: 1, w: { focus: 0.8, ward: 0.2 } },
  { id: 'ignition', label: 'Ignition', slot: 1, w: { kinetic: 1 } },
  { id: 'bulwark', label: 'Bulwark', slot: 1, w: { ward: 1 } },
  { id: 'insight', label: 'Insight', slot: 1, w: { focus: 1 } },
  { id: 'courage', label: 'Courage', slot: 1, w: { kinetic: 0.6, ward: 0.4 } },
  { id: 'rebirth', label: 'Rebirth', slot: 1, w: { kinetic: 0.45, entropy: 0.35, focus: 0.2 } },
  { id: 'banishing', label: 'Banishing', slot: 1, w: { entropy: 0.8, ward: 0.2 } },
  { id: 'fortune', label: 'Fortune', slot: 1, w: { entropy: 0.45, focus: 0.35, kinetic: 0.2 } },
  { id: 'calm', label: 'Calm', slot: 1, w: { focus: 0.7, ward: 0.3 } },
  { id: 'creation', label: 'Creation', slot: 1, w: { kinetic: 0.5, entropy: 0.3, focus: 0.2 } },
  // Slot 2 — Secondary Modifier (the Vector / Flow)
  { id: 'sustained', label: 'Sustained', slot: 2, w: { ward: 0.5, focus: 0.5 } },
  { id: 'reflecting', label: 'Reflecting', slot: 2, w: { ward: 0.7, focus: 0.3 } },
  { id: 'piercing', label: 'Piercing', slot: 2, w: { kinetic: 1 } },
  { id: 'cycling', label: 'Cycling', slot: 2, w: { kinetic: 0.5, focus: 0.5 } },
  { id: 'surging', label: 'Surging', slot: 2, w: { kinetic: 0.7, entropy: 0.3 } },
  { id: 'whispering', label: 'Whispering', slot: 2, w: { focus: 0.8, ward: 0.2 } },
  { id: 'scattering', label: 'Scattering', slot: 2, w: { entropy: 1 } },
  { id: 'weaving', label: 'Weaving', slot: 2, w: { focus: 0.5, ward: 0.5 } },
  // Slot 3 — Tertiary Binding (the Containment)
  { id: 'sealed', label: 'Sealed', slot: 3, w: { ward: 1 } },
  { id: 'radiating', label: 'Radiating', slot: 3, w: { kinetic: 0.7, focus: 0.3 } },
  { id: 'grounded', label: 'Grounded', slot: 3, w: { ward: 0.6, focus: 0.4 } },
  { id: 'unbound', label: 'Unbound', slot: 3, w: { entropy: 0.8, kinetic: 0.2 } },
  { id: 'mirrored', label: 'Mirrored', slot: 3, w: { focus: 0.7, ward: 0.3 } },
  { id: 'kindled', label: 'Kindled', slot: 3, w: { kinetic: 0.6, focus: 0.4 } },
];
export const effectById = (id) => EFFECTS.find((e) => e.id === id) || null;

// ---------------------------------------------------------------------------
// Free-text lexicon: word stems → domain nudges. Unknown words still count,
// via a hash, so every prompt yields a stable, distinct sigil.
// ---------------------------------------------------------------------------
const STEMS = {
  ward: ['protect', 'guard', 'shield', 'safe', 'ward', 'defen', 'seal', 'hold', 'keep', 'home', 'block', 'armo', 'stasis', 'still', 'boundar', 'wall', 'secur', 'shelter', 'fortif', 'steady', 'stabl', 'anchor', 'endur', 'patien', 'loyal', 'house', 'door', 'gate', 'night'],
  kinetic: ['fire', 'flame', 'ignit', 'energ', 'speed', 'fast', 'move', 'motiv', 'drive', 'power', 'strik', 'project', 'launch', 'courag', 'passion', 'spark', 'burn', 'start', 'action', 'catal', 'win', 'run', 'race', 'brave', 'bold', 'phoenix', 'dragon', 'sun', 'forge', 'heat', 'vigor', 'vital', 'strength', 'grow'],
  focus: ['focus', 'clear', 'clarit', 'wisdom', 'wise', 'insight', 'study', 'exam', 'learn', 'harmon', 'balanc', 'peace', 'calm', 'medit', 'sleep', 'dream', 'memor', 'see', 'truth', 'love', 'kind', 'heal', 'gentl', 'still', 'moon', 'star', 'read', 'write', 'think', 'mind', 'quiet', 'grace', 'friend'],
  entropy: ['banish', 'break', 'chaos', 'disrupt', 'end', 'change', 'releas', 'luck', 'random', 'curse', 'undo', 'scatter', 'storm', 'wild', 'entrop', 'forget', 'rid', 'quit', 'shatter', 'free', 'escape', 'trick', 'fortun', 'gambl', 'dice', 'chance', 'rebel', 'transform', 'shift', 'lightning'],
};

/** Domain weights from free text. Returns { w, matched: [stems] }. */
export function weighText(text) {
  const words = String(text || '').toLowerCase().match(/[a-z']+/g) || [];
  const w = { ward: 0, kinetic: 0, focus: 0, entropy: 0 };
  const matched = [];
  for (const word of words) {
    let hit = false;
    for (const d of DOMAINS) for (const s of STEMS[d]) if (word.startsWith(s) || (s.length > 4 && word.includes(s))) { w[d] += 1; hit = true; matched.push(word); }
    if (!hit && word.length > 3) { const h = hash32(word); w[DOMAINS[h % 4]] += 0.15; }
  }
  return { w: normWeights(w), matched: [...new Set(matched)] };
}

/** Resolve one effect slot (preset id and/or text) to { id, text, label, w }. */
export function resolveEffect({ id = null, text = '' } = {}, slot = 1) {
  const preset = id ? effectById(id) : null;
  const t = String(text || '').trim();
  if (preset && !t) return { slot, id: preset.id, text: '', label: preset.label, w: normWeights(preset.w) };
  if (!preset && !t) return null;
  const tw = weighText(t).w;
  const w = preset ? normWeights(Object.fromEntries(DOMAINS.map((d) => [d, 0.5 * (preset.w[d] || 0) + 0.5 * tw[d]]))) : tw;
  const label = preset ? `${preset.label}: ${t}` : titleCase(t);
  return { slot, id: preset ? preset.id : null, text: t, label: label.slice(0, 60), w };
}
const titleCase = (s) => s.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).map((x) => x[0].toUpperCase() + x.slice(1)).join(' ');

const top = (w) => DOMAINS.reduce((a, b) => (w[b] > w[a] ? b : a));

// ---------------------------------------------------------------------------
// compileEffects: effects → Generation-0 genome
// ---------------------------------------------------------------------------
/**
 * @param {Array<{id?:string,text?:string,w?:object,label?:string}>} slots  1–3 effects
 * @param {object} [opts]  { form, relief, palette, hints, inscription, name }
 *   hints (from the optional LLM) may name preferred primitives:
 *   { core, spokes, terminal, ring, lattice, motifs: [] } — each is only used
 *   if the effects' laws allow it.
 */
export function compileEffects(slots, opts = {}) {
  const effects = [];
  slots.slice(0, 3).forEach((s, i) => {
    const e = s && s.w ? { slot: i + 1, id: s.id || null, text: s.text || '', label: s.label || s.text || s.id || `Effect ${i + 1}`, w: normWeights(s.w) } : resolveEffect(s || {}, i + 1);
    if (e) effects.push({ ...e, slot: effects.length + 1 });
  });
  if (!effects.length) effects.push(resolveEffect({ id: 'clarity' }, 1));

  const seed = hash32(effects.map((e) => `${e.id}|${e.text}|${DOMAINS.map((d) => e.w[d].toFixed(2))}`).join('/'));
  const r = rng(seed);
  const stub = normalize({ effects });
  const W = (slot) => normWeights((effects.find((e) => e.slot === slot) || effects[0]).w);
  const w1 = W(1), w2 = W(2), w3 = W(3);
  const allW = normWeights(Object.fromEntries(DOMAINS.map((d) => [d, effects.reduce((a, e) => a + e.w[d], 0)])));
  const hints = opts.hints || {};
  const hinted = (cat, fallback) => {
    const ok = cat === 'symmetry' ? allowedSymmetry(stub) : allowed(stub, cat);
    return hints[cat] && ok.includes(hints[cat]) ? hints[cat] : fallback;
  };

  const sym = parseSym(hinted('symmetry', pickFor(w1, 'symmetry', r)));
  const d1 = top(w1), d3 = top(w3);

  const core = {
    glyph: hinted('core', pickFor(w1, 'core', r)),
    r: d1 === 'focus' ? 1 / (PHI * PHI) + 0.02 : r.range(0.2, 0.32),
    inner: r.range(0.35, 0.6), w: r.range(0.045, 0.065),
    twist: sym.group === 'C' ? r.range(0.15, 0.5) * (r.chance(0.5) ? 1 : -1) : 0,
    mult: 1, well: d1 === 'focus' || r.chance(0.2),
  };
  const spokes = {
    style: hinted('spokes', pickFor(w2, 'spokes', r)),
    mult: sym.n <= 2 ? r.int(2, 4) : (sym.n >= 6 ? 1 : r.int(1, 2)),
    r0: core.r * 0.6, r1: 1, w: r.range(0.04, 0.055), amp: r.range(0.02, 0.07), waves: r.int(1, 3),
    twist: r.range(0.3, 0.9) * (core.twist < 0 ? -1 : 1), phase: sym.group === 'D' ? (r.chance(0.6) ? 0 : 1) : r(),
    terminal: hinted('terminal', pickFor(w2, 'terminal', r)), termSize: r.range(0.07, 0.11),
  };
  const lattice = { kind: hinted('lattice', pickFor(w2, 'lattice', r)), r: r.range(0.45, 0.65), size: r.range(0.22, 0.35), w: 0.035, step: r.int(1, 2), mult: 1 };

  // Rings: the rim (slot 3's containment) plus 0–2 inner rings.
  // Focus spaces rings by the golden ratio; ward makes the rim thick.
  const rimStyle = hinted('ring', pickFor(w3, 'ring', r));
  const rings = [{ style: rimStyle, w: d3 === 'ward' ? 0.085 : 0.06, count: r.int(1, 3), depth: r.range(0.04, 0.07), gaps: d3 === 'entropy' ? r.int(1, 3) : 1, gapDeg: r.range(8, 16), inward: d3 !== 'kinetic', phase: 0 }];
  const inner = d1 === 'focus' || d3 === 'focus' ? 2 : r.int(0, 2);
  for (let i = 0; i < inner; i++) {
    const rr = d1 === 'focus' || d3 === 'focus' ? Math.pow(1 / PHI, i + 1) * 1.05 : r.range(0.45, 0.78);
    rings.push({ style: r.chance(0.65) ? 'plain' : pickFor(w3, 'ring', r), r: Math.max(rr, core.r + 0.12), w: r.range(0.04, 0.055), count: r.int(1, 2), depth: 0.04, gaps: 1, gapDeg: 10, inward: true, phase: r() });
  }
  const motifs = [];
  const mcount = r.int(0, 2);
  const hm = Array.isArray(hints.motifs) ? hints.motifs.filter((m) => allowed(stub, 'motif').includes(m)) : [];
  for (let i = 0; i < mcount + Math.min(1, hm.length); i++) motifs.push({ kind: hm[i] || pickFor(w2, 'motif', r), r: r.range(0.55, 0.85), phase: r(), size: r.range(0.06, 0.1), tier: r.chance(0.5) ? 2 : 3 });

  const fracture = { cuts: allW.entropy > 0.45 ? r.int(1, 2) : 0, w: 0.045, jag: r(), seed: r.int(1, 1e9) };

  const name = opts.name || sigilName(effects);
  const g = normalize({
    meta: { name, inscription: opts.inscription || inscribe(effects, seed), generation: 0, lineage: [], seed, compiler: opts.compiler || 'lexicon' },
    effects, symmetry: sym, core, spokes, lattice, rings, motifs, fracture,
    relief: opts.relief || DEFAULT_RELIEF, form: opts.form || DEFAULT_FORM, palette: opts.palette || paletteOf(DOMAIN_PALETTE[top(allW)]),
  });
  return g;
}

// ---------------------------------------------------------------------------
// Names and inscriptions — the soulfire voice. Tongue firmly in cheek.
// ---------------------------------------------------------------------------
const STOP = new Set(['a', 'an', 'the', 'for', 'of', 'my', 'to', 'and', 'in', 'on', 'with', 'at', 'me', 'our', 'your', 'be', 'is', 'it', 'by', 'from', 'like']);
const SHORT = (e) => {
  if (e.id && effectById(e.id) && !e.text) return effectById(e.id).label;
  const words = String(e.text || e.label || '').split(/\s+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  const short = titleCase(words.slice(0, 3).join(' ') || e.label || 'Mystery');
  return e.id && effectById(e.id) ? `${effectById(e.id).label} (${short})` : short;
};

export function sigilName(effects) {
  const [a, b, c] = effects.map(SHORT);
  if (c) return `Sigil of ${a}, ${b} & ${c}`;
  if (b) return `Sigil of ${a} & ${b}`;
  return `Sigil of ${a}`;
}

const OPENINGS = [
  'By the first fire, older than the stars,',
  'Kindled in soulfire before matter learned its shape,',
  'From the ember that remembers every beginning,',
  'Where the old flame folds back on itself and rises,',
  'In the forge beneath all forges,',
];
const BIND = {
  ward: ['held within an unbroken ring', 'kept behind teeth that face inward', 'sealed in patient lattice'],
  kinetic: ['flung outward on turning spokes', 'spun in a rising spiral', 'driven to a point and loosed'],
  focus: ['gathered to a quiet centre', 'measured in golden spacing', 'balanced across the mirror line'],
  entropy: ['broken so it may be remade', 'scattered and bridged again', 'cracked along the lightning path'],
};
const CLOSINGS = ['So it is forged.', 'Let the ember keep it.', 'Burn bright; burn true.', 'As the flame wills, so it shapes.', 'Remade, and remade again.'];

export function inscribe(effects, seed = 1) {
  const r = rng(seed ^ 0x5f17e);
  const lines = [r.pick(OPENINGS)];
  const roles = ['let there be', 'carried', 'and bound'];
  effects.forEach((e, i) => {
    const d = top(e.w);
    const what = SHORT(e).toLowerCase();
    if (i === 0) lines.push(`${roles[0]} ${what}, ${r.pick(BIND[d])};`);
    else if (i === 1) lines.push(`${roles[1]} ${what}, ${r.pick(BIND[d])};`);
    else lines.push(`${roles[2]} ${what}, ${r.pick(BIND[d])}.`);
  });
  if (effects.length < 3) lines[lines.length - 1] = lines[lines.length - 1].replace(/;$/, '.');
  lines.push(r.pick(CLOSINGS));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Presets: named spells compiled from effects (so they obey the same laws)
// ---------------------------------------------------------------------------
export const PRESET_SPELLS = {
  'ember-ward': { label: 'Ember Ward', slots: [{ id: 'bulwark' }, { id: 'sustained' }, { id: 'sealed' }] },
  'phoenix-spark': { label: 'Phoenix Spark', slots: [{ id: 'rebirth' }, { id: 'surging' }, { id: 'radiating' }] },
  'still-water': { label: 'Still Water', slots: [{ id: 'clarity' }, { id: 'whispering' }, { id: 'mirrored' }] },
  'trickster-coin': { label: "Trickster's Coin", slots: [{ id: 'fortune' }, { id: 'scattering' }, { id: 'unbound' }], form: { kind: 'coin', bail: false } },
  'exam-focus': { label: 'Exam Focus', slots: [{ text: 'focus and calm memory for an exam' }, { id: 'sustained' }, { id: 'grounded' }] },
  'desk-dragon': { label: 'Desk Dragon', slots: [{ id: 'courage' }, { id: 'piercing' }, { id: 'kindled' }], form: { kind: 'medallion', bail: false, plinth: true } },
};
export function presetGenome(key, formOverride = {}) {
  const p = PRESET_SPELLS[key] || PRESET_SPELLS['ember-ward'];
  return compileEffects(p.slots, { form: { ...DEFAULT_FORM, ...(p.form || {}), ...formOverride } });
}
