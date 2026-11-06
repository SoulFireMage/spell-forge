// app.js — UI wiring: effect slots, the crucible (3×3 breeding grid), the
// 3D Forge, lineage rollback, export, and the window.spellforge agent API.
import { Forge } from './viewer.js?v=1.2.0';
import { normalize, brood, encodeGenome, decodeGenome, hashGenome, DEFAULT_FORM, DEFAULT_RELIEF, PALETTES, DOMAIN_PALETTE, paletteOf } from './genome.js?v=1.2.0';
import { EFFECTS, PRESET_SPELLS, compileEffects, effectById } from './lexicon.js?v=1.2.0';
import { sigilSVG, stlBinary, threeMF } from './export.js?v=1.2.0';
import { buildManifoldCadScript, SOURCE_FILES } from './manifoldcad.js?v=1.2.0';
import { consultOracle, ORACLE_MODELS, loadOracleSettings, saveOracleSettings } from './llm.js?v=1.2.0';
import { VERSION, RELEASED } from './version.js?v=1.2.0';
import * as cloud from './cloud.js?v=1.2.0';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------ compile pool
class Pool {
  constructor(size) {
    this.workers = Array.from({ length: size }, () => {
      const w = new Worker(new URL('./worker.js?v=1.2.0', import.meta.url), { type: 'module' });
      w.load = 0;
      w.onmessage = (e) => {
        const p = this.pending.get(e.data.id); this.pending.delete(e.data.id);
        w.load--; busy(-1);
        if (p) e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
      };
      return w;
    });
    this.seq = 0; this.pending = new Map();
  }
  compile(genome, opts = {}) {
    const id = ++this.seq;
    const w = this.workers.reduce((a, b) => (b.load < a.load ? b : a));
    w.load++; busy(1);
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); w.postMessage({ id, genome, opts }); });
  }
}
let inflight = 0;
function busy(d) {
  inflight += d;
  $('busy').className = inflight > 0 ? 'working' : '';
  $('busy').textContent = inflight > 0 ? `forging ${inflight}…` : '';
}
const forgeC = new Pool(1);
const gridC = new Pool(Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)));

// ------------------------------------------------------------ state
const view = new Forge($('forge'));
const state = {
  form: { ...DEFAULT_FORM },
  relief: { ...DEFAULT_RELIEF },
  grid: [],          // [{ genome, result }]
  selected: [],      // parent indices, oldest first
  focus: 4,
  generation: 0,
  lineage: [],       // [{ generation, genomes, selected, focus }]
  lastParents: null,
  current: null,     // last 3D result shown in the forge
  volatility: 0.15,
};
// palette: null = "the effects choose" (each genome keeps the colours its effects suggested); otherwise the user's choice, applied to all
state.palette = null;
const physical = (g) => normalize({ ...g, form: { ...state.form }, relief: { ...state.relief }, ...(state.palette ? { palette: { ...state.palette } } : {}) });

// ------------------------------------------------------------ effect slots
const SLOT_NAMES = [['I', 'Core', 'primary intent'], ['II', 'Flow', 'secondary modifier'], ['III', 'Binding', 'containment']];
function buildSlots() {
  const groups = [1, 2, 3].map((s) => `<optgroup label="${['Intents', 'Modifiers', 'Bindings'][s - 1]}">${EFFECTS.filter((e) => e.slot === s).map((e) => `<option value="${e.id}">${e.label}</option>`).join('')}</optgroup>`).join('');
  $('slots').innerHTML = SLOT_NAMES.map(([num, name, role], i) => `
    <div class="slot" style="margin-bottom:6px">
      <div class="num"><b>${num}</b> · ${name} <span class="hint" style="text-transform:none;letter-spacing:0">${role}</span></div>
      <select id="slot-${i}-id" aria-label="Slot ${num} preset"><option value="">${i ? '— none —' : '— your own words —'}</option>${groups}</select>
      <input type="text" id="slot-${i}-text" maxlength="160" placeholder="${['or speak it: “courage for the interview”', 'or: “slowly, like a tide”', 'or: “held close to the heart”'][i]}" aria-label="Slot ${num} in your own words" />
    </div>`).join('');
}
function readSlots() {
  return [0, 1, 2].map((i) => ({ id: $(`slot-${i}-id`).value || null, text: $(`slot-${i}-text`).value.trim() })).filter((s) => s.id || s.text);
}
function writeSlots(slots) {
  [0, 1, 2].forEach((i) => { const s = slots[i] || {}; $(`slot-${i}-id`).value = s.id || ''; $(`slot-${i}-text`).value = s.text || ''; });
}

// ------------------------------------------------------------ physical form controls
function syncFormUI() {
  for (const b of $('form-kind').querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === state.form.kind);
  $('diameter').value = state.form.diameter;
  $('shape').value = state.form.shape;
  $('bail').checked = state.form.bail;
  $('plinth').checked = state.form.plinth;
  $('t1').value = state.relief.t1; $('t2').value = state.relief.t2; $('t3').value = state.relief.t3;
  $('minwall').value = state.form.minWall; $('mingap').value = state.form.minGap;
  const key = `${state.form.minWall},${state.form.minGap}`;
  const opt = [...$('nozzle').options].find((o) => o.value === key);
  $('nozzle').value = opt ? key : 'custom';
  $('custom-walls').hidden = !!opt;
}
let physTimer = null;
function physicalChanged() {
  clearTimeout(physTimer);
  physTimer = setTimeout(() => {
    state.grid = state.grid.map((c) => ({ genome: physical(c.genome), result: null }));
    renderGrid();
    compileGrid();
    showInForge(state.grid[state.focus].genome, { reframe: true });
  }, 250);
}
function wireForm() {
  $('form-kind').addEventListener('click', (e) => {
    const v = e.target.closest('button') && e.target.closest('button').dataset.v;
    if (!v) return;
    state.form.kind = v;
    syncFormUI(); physicalChanged();
  });
  const num = (id, set) => $(id).addEventListener('change', () => { const v = +$(id).value; if (Number.isFinite(v)) { set(v); physicalChanged(); } });
  num('diameter', (v) => { state.form.diameter = Math.min(120, Math.max(20, v)); });
  num('minwall', (v) => { state.form.minWall = v; });
  num('mingap', (v) => { state.form.minGap = v; });
  num('t1', (v) => { state.relief.t1 = v; });
  num('t2', (v) => { state.relief.t2 = v; });
  num('t3', (v) => { state.relief.t3 = v; });
  $('shape').addEventListener('change', () => { state.form.shape = $('shape').value; physicalChanged(); });
  $('bail').addEventListener('change', () => { state.form.bail = $('bail').checked; physicalChanged(); });
  $('plinth').addEventListener('change', () => { state.form.plinth = $('plinth').checked; physicalChanged(); });
  $('nozzle').addEventListener('change', () => {
    const v = $('nozzle').value;
    $('custom-walls').hidden = v !== 'custom';
    if (v !== 'custom') { const [w, g] = v.split(',').map(Number); state.form.minWall = w; state.form.minGap = g; physicalChanged(); }
  });
  $('volatility').addEventListener('input', () => { state.volatility = +$('volatility').value; $('vol-val').textContent = state.volatility.toFixed(2); });
}

// ------------------------------------------------------------ the crucible
function cellCaption(g, i) {
  const s = `${g.symmetry.group}${g.symmetry.n} · ${g.core.glyph}`;
  return state.generation === 0 && i === 4 ? `seed · ${s}` : s;
}
function renderGrid() {
  const el = $('grid');
  el.innerHTML = '';
  state.grid.forEach((c, i) => {
    const d = document.createElement('div');
    const pIdx = state.selected.indexOf(i);
    d.className = `cell${pIdx >= 0 ? ' parent' : ''}${i === state.focus ? ' focus' : ''}${c.result ? '' : ' pending'}${state.generation === 0 && i === 4 ? ' seed' : ''}`;
    d.setAttribute('role', 'option');
    d.setAttribute('aria-selected', pIdx >= 0 ? 'true' : 'false');
    d.tabIndex = 0;
    d.title = `${c.genome.meta.name}\n${hashGenome(c.genome)}\nClick: inspect in the Forge and choose as a parent`;
    if (c.result) d.innerHTML = sigilSVG(c.result, { bridges: true });
    if (pIdx >= 0) d.insertAdjacentHTML('beforeend', `<div class="badge">${'AB'[pIdx]}</div>`);
    if (c.result && c.result.telemetry.warnings.length) d.insertAdjacentHTML('beforeend', '<div class="warn" title="Has warnings"></div>');
    d.insertAdjacentHTML('beforeend', `<div class="cap">${esc(cellCaption(c.genome, i))}</div>`);
    const pick = () => choose(i);
    d.addEventListener('click', pick);
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    el.appendChild(d);
  });
  $('gen').textContent = `Gen ${state.generation}`;
  $('parents').textContent = state.selected.length
    ? `Parent${state.selected.length > 1 ? 's' : ''} ${state.selected.map((_, k) => 'AB'[k]).join(' + ')} chosen: ${state.selected.length > 1 ? 'crossover, then mutation' : 'mutation only'}.`
    : 'Click a sigil to choose it as a parent (up to two).';
}
let gridEpoch = 0;
function compileGrid() {
  const epoch = ++gridEpoch;
  state.grid.forEach((c, i) => {
    if (c.result) return;
    gridC.compile(c.genome, { solid: false }).then((r) => {
      if (epoch !== gridEpoch) return;
      state.grid[i].result = r;
      renderGrid();
      renderLineage();
    }).catch((err) => console.warn('crucible compile failed', err));
  });
}
function choose(i) {
  const at = state.selected.indexOf(i);
  if (at >= 0 && state.focus === i) state.selected.splice(at, 1);
  else if (at < 0) { state.selected.push(i); if (state.selected.length > 2) state.selected.shift(); }
  state.focus = i;
  renderGrid();
  showInForge(state.grid[i].genome);
}
function setGrid(genomes, { generation, focus = 4, selected = [focus], record = true } = {}) {
  state.grid = genomes.map((g) => ({ genome: physical(g), result: null }));
  state.generation = generation;
  state.focus = focus;
  state.selected = selected;
  if (record) {
    state.lineage = state.lineage.filter((l) => l.generation < generation);
    state.lineage.push({ generation, genomes: state.grid.map((c) => c.genome), selected: [...selected], focus });
  }
  renderGrid();
  compileGrid();
  renderLineage();
  showInForge(state.grid[focus].genome, { reframe: generation === 0 });
}
function breed(reroll = false) {
  let parents;
  if (reroll && state.lastParents) parents = state.lastParents;
  else {
    const idx = state.selected.length ? state.selected : [state.focus];
    parents = idx.map((i) => state.grid[i].genome);
    // remember which cells were chosen in this generation's lineage entry
    const entry = state.lineage.find((l) => l.generation === state.generation);
    if (entry) { entry.selected = [...idx]; entry.focus = state.focus; }
  }
  state.lastParents = parents;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const kids = brood(parents, { seed, volatility: state.volatility });
  setGrid(kids, { generation: reroll ? state.generation : state.generation + 1, focus: 4, selected: [] });
}

// ------------------------------------------------------------ compile base
async function compileBase() {
  const slots = readSlots();
  if (!slots.length) { toast('Bind at least one effect: choose one or speak it in your own words.'); return; }
  let g0;
  const btn = $('btn-compile');
  btn.disabled = true;
  try {
    if ($('use-oracle').checked && oracle.apiKey) {
      btn.textContent = 'The Oracle is reading…';
      const texts = slots.map((s) => [s.id && effectById(s.id).label, s.text].filter(Boolean).join(': '));
      const o = await consultOracle(texts, oracle);
      g0 = compileEffects(o.effects, { hints: o.hints, name: o.name, inscription: o.inscription, compiler: `oracle:${oracle.model}`, form: state.form, relief: state.relief });
    } else {
      g0 = compileEffects(slots, { form: state.form, relief: state.relief });
    }
  } catch (err) {
    toast(String(err.message || err));
    g0 = compileEffects(slots, { form: state.form, relief: state.relief });
  } finally {
    btn.disabled = false; btn.textContent = 'Compile base sigil';
  }
  const around = brood([g0], { seed: g0.meta.seed, volatility: Math.max(0.3, state.volatility), count: 8 })
    .map((k) => ({ ...k, meta: { ...k.meta, generation: 0 } }));
  const genomes = [...around.slice(0, 4), g0, ...around.slice(4)];
  state.lineage = [];
  state.lastParents = null;
  setGrid(genomes, { generation: 0, focus: 4, selected: [4] });
}

// ------------------------------------------------------------ the forge
let forgeBusy = false, forgeQueued = null;
function showInForge(g, opts = {}) {
  forgeQueued = { g, opts };
  if (!forgeBusy) pumpForge();
}
async function pumpForge() {
  if (!forgeQueued) return;
  const { g, opts } = forgeQueued; forgeQueued = null; forgeBusy = true;
  $('forge-name').textContent = g.meta.name;
  $('forge-meta').textContent = 'forging…';
  try {
    const r = await forgeC.compile(g, { solid: true });
    state.current = r;
    view.show(r, opts);
    report(r);
    syncColourUI();
    syncUrl(r.genome);
  } catch (err) {
    $('forge-meta').innerHTML = `<span style="color:var(--bad)">forge failed: ${esc(err.message)}</span>`;
  }
  forgeBusy = false;
  if (forgeQueued) pumpForge();
}

const WARN_TEXT = {
  DISCONNECTED: 'Some parts float free and could not all be bridged. Try a medallion, or another child.',
  THIN_FEATURES: 'Some strokes were finer than your printer can make and were smoothed away.',
  SYMMETRY_DRIFT: 'The symmetry drifted more than expected.',
};
function report(r) {
  const t = r.telemetry, g = r.genome;
  $('forge-name').textContent = g.meta.name;
  $('forge-meta').textContent = `${t.symmetry} · ${g.form.kind} · ${t.dimensionsMm.x.toFixed(1)} × ${t.dimensionsMm.y.toFixed(1)} × ${t.dimensionsMm.z.toFixed(1)} mm · ${t.status === 'NoError' ? 'watertight' : t.status}`;
  $('sig-name').textContent = g.meta.name;
  $('inscription').textContent = g.meta.inscription;
  $('bound').innerHTML = g.effects.map((e) => `<span class="chip"><b>${['I', 'II', 'III'][e.slot - 1]}</b>${esc(e.label)}</span>`).join('');
  $('hash').textContent = t.hash;
  const stats = [
    ['Symmetry', t.symmetry], ['Mass (PLA)', `${t.massG} g`], ['Bodies', t.bodies],
    ['Size', `${Math.round(t.dimensionsMm.x)}×${Math.round(t.dimensionsMm.y)} mm`], ['Bridges', t.islandsBridged], ['Min wall', `${t.minWallMm} mm`],
    ['Swap at', `${t.filamentSwapsAtMm.join(' / ')} mm`], ['Triangles', t.triangles.toLocaleString()], ['Smoothed', `${t.thinLossPct}%`],
  ];
  $('stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v" title="${esc(v)}">${esc(v)}</div></div>`).join('');
  $('warnings').innerHTML = t.warnings.length
    ? t.warnings.map((w) => `<div class="w">⚠ ${esc(WARN_TEXT[w] || w)}</div>`).join('')
    : `<div class="ok">✓ One watertight body${t.form === 'openwork' ? ', every island bridged' : ''}; walls ≥ ${t.minWallMm} mm.</div>`;
  $('genome-json').value = JSON.stringify(g, null, 2);
  $('telemetry').value = JSON.stringify(t, null, 2);
}

// ------------------------------------------------------------ lineage
function renderLineage() {
  const el = $('lineage');
  el.innerHTML = '';
  [...state.lineage].reverse().forEach((l) => {
    const i = l.selected.length ? l.selected[0] : l.focus;
    const cell = l.generation === state.generation ? state.grid[i] : null;
    const d = document.createElement('div');
    d.className = `lin${l.generation === state.generation ? ' current' : ''}`;
    const g = l.genomes[i];
    d.innerHTML = `${cell && cell.result ? sigilSVG(cell.result, { bridges: false }) : '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="#5a2d3a"/></svg>'}
      <div class="t"><b>Gen ${l.generation}</b> · ${esc(g.symmetry.group + g.symmetry.n)} ${esc(g.core.glyph)}<br />${l.selected.length > 1 ? 'two parents' : l.selected.length ? 'one parent' : 'browsing'}</div>`;
    d.title = 'Roll back to this generation';
    d.addEventListener('click', () => {
      state.lineage = state.lineage.filter((x) => x.generation <= l.generation);
      setGrid(l.genomes, { generation: l.generation, focus: l.focus, selected: [...l.selected], record: false });
    });
    el.appendChild(d);
  });
}

// ------------------------------------------------------------ export
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const slug = () => (state.current ? state.current.genome.meta.name : 'sigil').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'sigil';
const shareUrl = (g) => `${location.origin}${location.pathname}#g=${encodeGenome(g)}`;
function syncUrl(g) { try { history.replaceState(null, '', `#g=${encodeGenome(g)}`); } catch (_) { /* file:// */ } }
function spellCard(r) {
  const g = r.genome, t = r.telemetry;
  return `${g.meta.name}
${'='.repeat(g.meta.name.length)}

${g.meta.inscription}

Bound effects:
${g.effects.map((e) => `  ${['I  (Core)', 'II (Flow)', 'III (Binding)'][e.slot - 1]}: ${e.label}`).join('\n')}

Genome hash: ${t.hash}
Form: ${g.form.kind}, ${g.form.diameter} mm${g.form.bail ? ', bail loop' : ''}${g.form.plinth ? ', desk plinth' : ''}
Symmetry: ${t.symmetry} · Mass ≈ ${t.massG} g PLA · ${t.dimensionsMm.x} × ${t.dimensionsMm.y} × ${t.dimensionsMm.z} mm
Printing: walls ≥ ${t.minWallMm} mm.
Filament plan: start with ${colourName(g.palette.t1)}; swap to ${colourName(g.palette.t2)} at ${t.filamentSwapsAtMm[0]} mm; swap to ${colourName(g.palette.t3)} at ${t.filamentSwapsAtMm[1]} mm.

Reforge it: ${shareUrl(g)}

Forged in Soulfire Mage's Spellforge v${VERSION}. Not suitable for national security, crime,
crime detection, birth prevention, or serious healthcare. Tongue firmly in cheek.
`;
}
const srcCache = {};
async function manifoldCadScript(g) {
  for (const f of SOURCE_FILES) if (!srcCache[f]) srcCache[f] = await (await fetch(new URL(`./${f}?v=${VERSION}`, import.meta.url))).text();
  return buildManifoldCadScript({ sources: srcCache, genome: g });
}
function wireExport() {
  const need = (fn) => () => { if (!state.current) return toast('Still forging…'); fn(state.current); };
  $('btn-stl').addEventListener('click', need((r) => download(`${slug()}.stl`, stlBinary(r.mesh, r.genome.meta.name), 'model/stl')));
  $('btn-3mf').addEventListener('click', need((r) => download(`${slug()}.3mf`, threeMF(r.mesh, { name: r.genome.meta.name, palette: r.genome.palette, relief: r.genome.relief, inscription: r.genome.meta.inscription }), 'model/3mf')));
  $('btn-svg').addEventListener('click', need((r) => download(`${slug()}.svg`, sigilSVG(r, { bridges: true }), 'image/svg+xml')));
  $('btn-json').addEventListener('click', need((r) => download(`${slug()}.json`, JSON.stringify(r.genome, null, 2), 'application/json')));
  $('btn-card').addEventListener('click', need((r) => download(`${slug()}.txt`, spellCard(r), 'text/plain')));
  $('btn-link').addEventListener('click', need((r) => copy(shareUrl(r.genome), 'Share link copied')));
  $('btn-copy-hash').addEventListener('click', need((r) => copy(r.telemetry.hash, 'Genome hash copied')));
  $('btn-mcad').addEventListener('click', need(async (r) => download(`${slug()}.mjs`, await manifoldCadScript(r.genome), 'text/javascript')));
  $('btn-shot').addEventListener('click', () => { const a = document.createElement('a'); a.href = view.snapshot(); a.download = `${slug()}.png`; a.click(); });
  $('btn-apply').addEventListener('click', () => {
    try {
      const g = normalize(JSON.parse($('genome-json').value));
      state.grid[state.focus] = { genome: physical(g), result: null };
      Object.assign(state.form, g.form); Object.assign(state.relief, g.relief); state.palette = { ...g.palette }; syncFormUI();
      renderGrid(); compileGrid(); showInForge(state.grid[state.focus].genome);
    } catch (err) { toast(`Not a genome: ${err.message}`); }
  });
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch (_) { prompt('Copy this:', text); }
}
let toastT = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }

// ------------------------------------------------------------ oracle settings
const oracle = { apiKey: '', model: ORACLE_MODELS[0].id, remember: false, ...loadOracleSettings() };
function wireOracle() {
  $('oracle-model').innerHTML = ORACLE_MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  $('oracle-model').value = oracle.model;
  $('api-key').value = oracle.apiKey || '';
  $('remember-key').checked = !!oracle.remember;
  const upd = () => {
    oracle.apiKey = $('api-key').value.trim(); oracle.model = $('oracle-model').value; oracle.remember = $('remember-key').checked;
    saveOracleSettings(oracle);
    $('oracle-toggle-row').hidden = !oracle.apiKey;
    if (!oracle.apiKey) $('use-oracle').checked = false;
  };
  ['api-key', 'oracle-model', 'remember-key'].forEach((id) => $(id).addEventListener('change', upd));
  $('api-key').addEventListener('input', upd);
  $('oracle-toggle-row').hidden = !oracle.apiKey;
  $('use-oracle').checked = !!oracle.apiKey;
}

// ------------------------------------------------------------ colours (filament sets)
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function colourName(hex) {
  for (const [, p] of Object.entries(PALETTES)) for (const k of ['t1', 't2', 't3']) if (p[k].toLowerCase() === hex.toLowerCase()) return `${hex} (${p.label} ${['base', 'rings', 'core'][+k[1] - 1]})`;
  return hex;
}
const shownPalette = () => state.palette || (state.grid[state.focus] ? state.grid[state.focus].genome.palette : paletteOf('soulfire'));
function syncColourUI() {
  const p = shownPalette();
  $('c1').value = p.t1; $('c2').value = p.t2; $('c3').value = p.t3;
  for (const b of $('swatches').querySelectorAll('button')) {
    const k = b.dataset.p;
    b.classList.toggle('on', k === 'auto' ? !state.palette : !!state.palette && ['t1', 't2', 't3'].every((t) => PALETTES[k][t] === state.palette[t]));
  }
  const single = p.t1 === p.t2 && p.t2 === p.t3;
  const low = !single && (contrast(p.t1, p.t2) < 1.35 || contrast(p.t2, p.t3) < 1.35);
  $('colour-hint').classList.toggle('warn', low);
  $('colour-hint').textContent = low ? 'Two neighbouring tiers are close in brightness: the relief may vanish in the print.'
    : single ? 'One filament: the relief alone carries the design.'
    : state.palette ? 'Your colours, kept as you breed. Choose "From the effects" to let the spell decide.'
    : 'The effects chose these. Pick a set or a colour to make them yours.';
}
function setPalette(p) {
  state.palette = p ? { ...shownPalette(), ...p } : null;
  if (!p) { // back to the effects' suggestion, from each genome's strongest domain
    state.grid = state.grid.map((c) => {
      const w = { ward: 0, kinetic: 0, focus: 0, entropy: 0 };
      for (const e of c.genome.effects) for (const d in w) w[d] += e.w[d];
      const top = Object.keys(w).reduce((a, b) => (w[b] > w[a] ? b : a));
      return { genome: normalize({ ...c.genome, palette: paletteOf(DOMAIN_PALETTE[top]) }), result: c.result };
    });
  } else state.grid = state.grid.map((c) => ({ genome: physical(c.genome), result: c.result }));
  // colour needs no recompile: repaint the cached 2D results and re-show the forge mesh
  for (const c of state.grid) if (c.result) c.result = { ...c.result, genome: c.genome };
  renderGrid();
  const g = state.grid[state.focus].genome;
  if (state.current) { state.current = { ...state.current, genome: { ...state.current.genome, palette: g.palette } }; view.show(state.current); report(state.current); syncUrl(state.current.genome); }
  syncColourUI();
}
function wireColours() {
  $('swatches').innerHTML = `<button class="sw" data-p="auto" title="Let the bound effects choose: ward → Abyss, kinetic → Soulfire, focus → Moonsilver, entropy → Storm"><span>✶ From the effects</span></button>`
    + Object.entries(PALETTES).map(([k, p]) => `<button class="sw" data-p="${k}" title="${p.label}"><span class="chips"><i style="background:${p.t1}"></i><i style="background:${p.t2}"></i><i style="background:${p.t3}"></i></span><span>${p.label}</span></button>`).join('');
  $('swatches').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setPalette(b.dataset.p === 'auto' ? null : paletteOf(b.dataset.p));
  });
  let t = null;
  for (const id of ['c1', 'c2', 'c3']) $(id).addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => setPalette({ t1: $('c1').value, t2: $('c2').value, t3: $('c3').value }), 120);
  });
}

// ------------------------------------------------------------ embers (phoenix, lightly)
function embers() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('embers'), ctx = c.getContext('2d');
  let W = 0, H = 0;
  const resize = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
  resize(); addEventListener('resize', resize);
  const N = Math.min(70, Math.round((innerWidth * innerHeight) / 26000));
  const mk = (y) => ({ x: Math.random() * W, y: y ?? H + Math.random() * 40, v: 0.25 + Math.random() * 0.7, r: 0.6 + Math.random() * 1.6, ph: Math.random() * 6.28, wing: Math.random() < 0.08, life: 0 });
  const ps = Array.from({ length: N }, () => mk(Math.random() * H));
  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.life++; p.y -= p.v;
      // a few embers sweep into a wing-curve as they rise
      p.x += Math.sin(p.ph + p.y * 0.01) * 0.35 + (p.wing ? Math.sin(p.life * 0.02) * 0.9 : 0);
      const a = Math.max(0, Math.min(1, p.y / H)) * 0.85;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fillStyle = p.wing ? `rgba(191,233,255,${a * 0.7})` : `rgba(255,${140 + Math.round(p.r * 40)},70,${a})`;
      ctx.shadowColor = p.wing ? '#bfe9ff' : '#ff7a3d'; ctx.shadowBlur = 8;
      ctx.fill();
      if (p.y < -10) Object.assign(p, mk());
    }
    requestAnimationFrame(tick);
  };
  tick();
}

// ------------------------------------------------------------ release check
async function checkVersion() {
  $('version').textContent = `v${VERSION}`;
  $('version').title = `Released ${RELEASED}`;
  try {
    const res = await fetch(new URL(`../version.json?t=${Date.now()}`, import.meta.url), { cache: 'no-store' });
    const { version } = await res.json();
    if (version && version !== VERSION) {
      $('update-banner').querySelector('span').textContent = `A newer forge (v${version}) is lit.`;
      $('update-banner').hidden = false;
      $('btn-update').onclick = () => location.reload();
    }
  } catch (_) { /* offline: fine */ }
}

// ------------------------------------------------------------ boot
function wire() {
  buildSlots();
  $('grimoire').innerHTML = `<option value="">Grimoire: preset spells…</option>${Object.entries(PRESET_SPELLS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}`;
  $('grimoire').addEventListener('change', () => {
    const p = PRESET_SPELLS[$('grimoire').value];
    if (!p) return;
    writeSlots(p.slots);
    if (p.form) { Object.assign(state.form, DEFAULT_FORM, p.form); syncFormUI(); }
    $('grimoire').value = '';
    compileBase();
  });
  $('btn-compile').addEventListener('click', compileBase);
  $('btn-mutate').addEventListener('click', () => breed(false));
  $('btn-reroll').addEventListener('click', () => (state.lastParents ? breed(true) : compileBase()));
  $('btn-spin').addEventListener('click', (e) => { const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); view.setSpin(on); });
  $('btn-bridges').addEventListener('click', (e) => { const on = !e.target.classList.contains('on'); e.target.classList.toggle('on', on); view.setBridges(on); });
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view.view(b.dataset.view));
  wireForm();
  wireExport();
  wireOracle();
  wireCloud();
  wireColours();
  syncFormUI();
}

wire();
embers();
checkVersion();

/** Bring a genome into the crucible: it sits at the centre, with eight gentle variants around it. */
function adopt(g) {
  g = normalize(g);
  Object.assign(state.form, g.form); Object.assign(state.relief, g.relief); state.palette = { ...g.palette }; syncFormUI();
  writeSlots(g.effects.map((e) => ({ id: e.id, text: e.text || (e.id ? '' : e.label) })));
  const around = brood([g], { seed: g.meta.seed, volatility: 0.12, count: 8 });
  state.lineage = [];
  state.lastParents = null;
  setGrid([...around.slice(0, 4), g, ...around.slice(4)], { generation: g.meta.generation, focus: 4, selected: [4] });
}

// first sigil: a shared link, or the Ember Ward
let first = null;
const m = location.hash.match(/#g=([\w-]+)/);
if (m) { try { first = decodeGenome(m[1]); } catch (_) { first = null; } }
if (first) adopt(first);
else {
  writeSlots(PRESET_SPELLS['ember-ward'].slots);
  compileBase();
}

// ------------------------------------------------------------ Skapi: account, Spellbook, Hall of Sigils
let profile = null;
const thumbs = new Map(); // hash → SVG string
function entryEl(item, { onOpen, onRemove, removeLabel }) {
  const d = document.createElement('div');
  d.className = 'entry'; d.tabIndex = 0; d.setAttribute('role', 'button');
  d.title = `${item.name}\n${item.effects.join(' · ')}\n${item.hash}${item.by ? `\nby ${item.by}` : ''}`;
  const art = document.createElement('div');
  art.className = 'art pending';
  d.appendChild(art);
  d.insertAdjacentHTML('beforeend', `<div class="lbl">${esc(item.name.replace(/^Sigil of /, ''))}<br /><i>${esc(item.symmetry)} · ${esc(item.form)}${item.by ? ` · ${esc(item.by)}` : ''}</i></div>`);
  if (onRemove) {
    const x = document.createElement('button');
    x.className = 'x small'; x.textContent = '✕'; x.title = removeLabel; x.setAttribute('aria-label', removeLabel);
    x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(item, d); });
    d.appendChild(x);
  }
  d.addEventListener('click', () => onOpen(item));
  d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item); } });
  const paint = (svg) => { art.classList.remove('pending'); art.innerHTML = svg; };
  if (thumbs.has(item.hash)) paint(thumbs.get(item.hash));
  else gridC.compile(item.genome, { solid: false }).then((r) => { const svg = sigilSVG(r, { bridges: false }); thumbs.set(item.hash, svg); paint(svg); }).catch(() => paint('<span class="hint">?</span>'));
  return d;
}

function showAccount() {
  const signedIn = !!profile;
  $('account-who').innerHTML = signedIn
    ? `Signed in as <b>${esc(profile.name || profile.email || 'a mage')}</b>`
    : 'Sign in to keep a Spellbook and to visit the Hall.';
  $('btn-account').textContent = signedIn ? 'Sign out' : 'Sign in';
  $('book-actions').hidden = !signedIn;
  if (!signedIn) $('spellbook').innerHTML = '';
}

async function refreshSpellbook() {
  if (!profile) return;
  const el = $('spellbook');
  try {
    const { items } = await cloud.listSpellbook();
    el.innerHTML = '';
    if (!items.length) el.innerHTML = '<div class="empty">Your Spellbook is empty. Save a sigil from the Forge.</div>';
    for (const it of items) {
      el.appendChild(entryEl(it, {
        onOpen: (x) => { adopt(x.genome); toast(`Opened ${x.name}`); },
        removeLabel: 'Remove from Spellbook',
        onRemove: async (x, node) => {
          if (!confirm(`Remove “${x.name}” from your Spellbook?`)) return;
          try { await cloud.removeRecord(x.record_id); node.remove(); toast('Removed'); } catch (e) { toast(cloud.errorMessage(e)); }
        },
      }));
    }
  } catch (e) { el.innerHTML = `<div class="empty">Couldn't open the Spellbook: ${esc(cloud.errorMessage(e))}</div>`; }
}

let hallEnd = false, hallLoading = false;
async function loadHall(more = false) {
  if (hallLoading) return;
  hallLoading = true;
  const el = $('hall-list');
  if (!more) el.innerHTML = '<div class="empty">Opening the Hall…</div>';
  try {
    const { items, end } = await cloud.listHall({ more });
    if (!more) el.innerHTML = '';
    hallEnd = end;
    if (!items.length && !more) el.innerHTML = '<div class="empty">The Hall is empty. Be the first to publish a sigil.</div>';
    for (const it of items) {
      const mine = profile && it.user_id === profile.user_id;
      el.appendChild(entryEl(it, {
        onOpen: (x) => { $('hall').close(); adopt(x.genome); toast(`${x.name} is in your crucible`); },
        removeLabel: 'Withdraw from the Hall',
        onRemove: mine ? async (x, node) => {
          if (!confirm(`Withdraw “${x.name}” from the Hall?`)) return;
          try { await cloud.removeRecord(x.record_id); node.remove(); toast('Withdrawn'); } catch (e) { toast(cloud.errorMessage(e)); }
        } : null,
      }));
    }
  } catch (e) { el.innerHTML = `<div class="empty">The Hall is out of reach: ${esc(cloud.errorMessage(e))}</div>`; }
  $('btn-hall-more').hidden = hallEnd;
  hallLoading = false;
}

function authTab(name) {
  for (const b of $('auth').querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === name);
  for (const f of $('auth').querySelectorAll('form')) f.hidden = f.dataset.pane !== name;
  $('auth-err').textContent = '';
}
async function authSubmit(e, fn) {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button[type=submit]');
  btn.disabled = true; $('auth-err').textContent = '';
  try { await fn(Object.fromEntries(new FormData(f))); } catch (err) { $('auth-err').textContent = cloud.errorMessage(err); }
  btn.disabled = false;
}
let openHallAfterSignIn = false;
function signedIn(p) {
  profile = p;
  showAccount();
  if (p) {
    $('auth').close(); toast(`Welcome, ${p.name || 'mage'}`); refreshSpellbook();
    if (openHallAfterSignIn) { openHallAfterSignIn = false; $('hall').showModal(); loadHall(false); }
  }
}

function wireCloud() {
  cloud.onUser((p) => {
    const was = profile && profile.user_id;
    profile = p;
    showAccount();
    if (p && p.user_id !== was) refreshSpellbook();
  });
  $('auth').addEventListener('close', () => { $('auth-note').hidden = true; });
  $('btn-account').addEventListener('click', async () => {
    if (profile) { await cloud.logout().catch((e) => toast(cloud.errorMessage(e))); profile = null; showAccount(); toast('Signed out'); return; }
    openHallAfterSignIn = false;
    authTab('login');
    $('auth').showModal();
  });
  $('btn-auth-close').addEventListener('click', () => $('auth').close());
  for (const b of $('auth').querySelectorAll('[data-tab]')) b.addEventListener('click', () => authTab(b.dataset.tab));
  $('form-login').addEventListener('submit', (e) => authSubmit(e, async (v) => signedIn(await cloud.login(v.email, v.password))));
  $('form-signup').addEventListener('submit', (e) => authSubmit(e, async (v) => signedIn(await cloud.signup(v.email, v.password, v.name.trim()))));
  $('btn-send-code').addEventListener('click', async () => {
    const email = $('form-forgot').email.value.trim();
    if (!email) { $('auth-err').textContent = 'Enter your e-mail first.'; return; }
    try { await cloud.forgotPassword(email); toast('If that account exists, a code is on its way.'); } catch (err) { $('auth-err').textContent = cloud.errorMessage(err); }
  });
  $('form-forgot').addEventListener('submit', (e) => authSubmit(e, async (v) => {
    await cloud.resetPassword(v.email, v.code, v.new_password);
    toast('Password changed. Sign in with the new one.');
    authTab('login');
  }));
  const needForged = (fn) => async () => {
    if (!state.current) return toast('Still forging…');
    if (!profile) { authTab('login'); $('auth').showModal(); return; }
    try { await fn(state.current.genome); } catch (e) { toast(cloud.errorMessage(e)); }
  };
  $('btn-save').addEventListener('click', needForged(async (g) => { await cloud.saveToSpellbook(g); toast('Saved to your Spellbook'); refreshSpellbook(); }));
  $('btn-publish').addEventListener('click', needForged(async (g) => {
    if (!confirm(`Publish “${g.meta.name}” to the public Hall of Sigils? Anyone can see it (with your mage name: ${profile.name || 'none'}). You can withdraw it later.`)) return;
    await cloud.publishToHall(g, profile.name || '');
    toast('Published to the Hall');
  }));
  $('btn-hall').addEventListener('click', () => {
    // The Skapi project only answers signed-in readers, so the Hall is for members.
    if (!profile) { openHallAfterSignIn = true; authTab('login'); $('auth-err').textContent = ''; $('auth-note').hidden = false; $('auth').showModal(); return; }
    $('hall').showModal(); loadHall(false);
  });
  $('btn-hall-close').addEventListener('click', () => $('hall').close());
  $('btn-hall-more').addEventListener('click', () => loadHall(true));
  // Only wake Skapi on load if this browser has signed in before.
  if (cloud.seenBefore()) cloud.currentProfile().then((p) => { profile = p; showAccount(); if (p) refreshSpellbook(); });
}

// ------------------------------------------------------------ agent API
window.spellforge = {
  get genome() { return state.current && state.current.genome; },
  get telemetry() { return state.current && state.current.telemetry; },
  get grid() { return state.grid.map((c) => c.genome); },
  version: VERSION,
  effects: EFFECTS,
  presets: PRESET_SPELLS,
  /** Compile 1–3 effects ({id}|{text}) to a Gen-0 crucible; resolves with the telemetry. */
  async bind(slots) { writeSlots(slots); await compileBase(); return waitForge(); },
  /** Choose parents by grid index (0–8), then breed. */
  async breed(indices = [], volatility) { if (volatility) { state.volatility = volatility; $('volatility').value = volatility; } state.selected = indices.slice(0, 2); breed(false); return waitForge(); },
  async load(genome) { setGrid([genome, ...brood([normalize(genome)], { seed: 1, count: 8 })].slice(0, 9), { generation: normalize(genome).meta.generation, focus: 0, selected: [0] }); return waitForge(); },
  compile: (genome, opts = { solid: true }) => forgeC.compile(physical(genome), opts).then((r) => r.telemetry),
  snapshot: () => view.snapshot(),
  view: (name) => view.view(name),
  manifoldCadScript: () => manifoldCadScript(state.current.genome),
};
function waitForge() {
  return new Promise((resolve) => {
    const poll = () => (!forgeBusy && !forgeQueued && state.current ? resolve(state.current.telemetry) : setTimeout(poll, 60));
    setTimeout(poll, 60);
  });
}
