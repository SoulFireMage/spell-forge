// sigil.js — Sigil Genome → printable 2D tiers → watertight 3D solid.
//
//   compileSigil(wasm, genome, { solid, manifold }) → {
//     genome,      // normalised copy of the input
//     tiers,       // { t1, t2, t3 } — polygons (mm) of each relief tier's footprint, nested t3 ⊂ t2 ⊂ t1
//     bridges,     // polygons of the structural bridges the solver (or a split ring / fracture) added
//     plate,       // polygons of the medallion / coin plate outline (empty for open-work)
//     mesh,        // (solid) { positions, indices } of the final welded solid, mm, Z up
//     bridgeMesh,  // (solid) thin overlay marking the bridges, for the Forge view
//     telemetry,   // JSON an agent can read to self-check the design
//   }
//
// Pure function of (wasm, genome, opts): no DOM, no Three.js, every WASM
// object freed before returning (except opts.manifold, which also returns the
// live final Manifold for the caller to own: that's how the ManifoldCAD
// export works). Runs unchanged in Node, the browser worker and ManifoldCAD.
//
// Pipeline (AGENT_SPEC.md §3):
//   1. Lift: build one wedge of primitives and lift it to the disc with the
//      symmetry group (Cn rotates, Dn mirrors then rotates).
//   2. Pre-union per tier in 2D (Clipper, Positive fill), nest t3 ⊂ t2 ⊂ t1.
//   3. Demote: ring gaps, runic notches and fracture cracks are lowered to
//      tier 1 rather than cut through, so they stay connected by construction.
//   4. Clamp: strokes are built ≥ min wall; then closing (fills gaps < min
//      gap) and opening (removes slivers < min wall) on every tier.
//   5. Solve islands (open-work only): decompose the footprint; bridge each
//      island to the main body at tier-1 height along the closest pair of
//      points, replicated over the symmetry orbit; drop sub-printable debris.
//   6. Housing: bail, plinth, medallion / coin plate.
//   7. Extrude tiers from Z = 0, union, telemetry. Because every tier starts
//      at Z = 0, the solid is connected iff its 2D footprint is.
import { Scope, TAU, clamp, lerp, rng, ccw, rot, rotPoly, mirrorPoly, polar, circlePoly, strokePath, sample, closestPair } from './geom.js?v=1.2.0';
import { normalize, hashGenome } from './genome.js?v=1.2.0';
import { VERSION } from './version.js?v=1.2.0';

export const BAIL = { id: 4.5, wall: 2.5 };      // requirements §2 Stage 5
export const PLA_DENSITY = 1.24;                  // g/cm³, for the mass estimate

// ---------------------------------------------------------------------------
// Symmetry: lift a wedge to the disc
// ---------------------------------------------------------------------------
/** All images of `polys` under Cn (rotations) or Dn (rotations + mirror across θ = 0). */
export function orbit(polys, group, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (TAU * k) / n;
    for (const p of polys) {
      out.push(k ? rotPoly(p, a) : p);
      if (group === 'D') out.push(rotPoly(mirrorPoly(p), a));
    }
  }
  return out;
}
/** Angular width of the fundamental wedge: π/n for Dn, 2π/n for Cn. */
export const wedgeAngle = (group, n) => (group === 'D' ? Math.PI / n : TAU / n);

// ---------------------------------------------------------------------------
// Primitive shapes (all in mm, built along +x then rotated into place)
// ---------------------------------------------------------------------------
const along = (pts, a) => pts.map((p) => rot(p, a));

/** Tapered ribbon: width w(t) along a polyline (comma tails, flames). */
function taper(pts, wAt) {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const h = wAt(i / (n - 1)) / 2, nx = -dy / l, ny = dx / l;
    L.push([pts[i][0] + nx * h, pts[i][1] + ny * h]);
    R.push([pts[i][0] - nx * h, pts[i][1] - ny * h]);
  }
  return ccw([...L, ...R.reverse()]);
}

/** Lens (vesica) from x = x0 to x1 with half-height h, as a polygon. */
function lens(x0, x1, h, seg = 24) {
  const top = sample((t) => [lerp(x0, x1, t), h * Math.sin(Math.PI * t)], seg);
  const bot = sample((t) => [lerp(x1, x0, t), -h * Math.sin(Math.PI * t)], seg).slice(1, -1);
  return ccw([...top, ...bot]);
}

function regular(n, r, a0 = 0) { const out = []; for (let i = 0; i < n; i++) out.push(polar(r, a0 + (TAU * i) / n)); return out; }
const triangle = (x, size, dir = 1) => ccw([[x + dir * size, 0], [x - dir * size * 0.6, size * 0.75], [x - dir * size * 0.6, -size * 0.75]]);
const diamond = (x, size) => ccw([[x + size, 0], [x, size * 0.6], [x - size, 0], [x, -size * 0.6]]);
const flameShape = (x, size, bend) => taper(sample((t) => [x - size + 2 * size * t, bend * size * 0.5 * Math.sin(Math.PI * t * 0.9)], 16), (t) => size * 1.1 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.02)) ** 0.8 + 0.01);
const commaShape = (x, size, chir) => {
  const head = circlePoly(x, 0, size * 0.55, 20);
  const tail = taper(sample((t) => polar(size * (0.55 + 0.25 * t), Math.PI / 2 * chir + chir * t * 2.2).map((v, i) => v + (i ? 0 : x)), 14), (t) => size * 1.0 * (1 - t) + 0.05);
  return [head, tail];
};

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------
export function compileSigil(wasm, input, opts = {}) {
  const { CrossSection, Manifold } = wasm;
  const t0 = Date.now(), timings = {};
  const S = new Scope();
  const k = (o) => S.k(o);
  const g = normalize(input);
  const { group, n } = g.symmetry;
  const F = g.form;
  const R = F.diameter / 2;
  const mw = F.minWall, mg = F.minGap;
  const W = (frac) => Math.max(frac * R, mw * 1.05);       // stroke width in mm, clamped to the min wall
  const wedge = wedgeAngle(group, n);
  const warnings = [];

  // raw tier contents (polygon lists) + boolean CrossSections + demotion regions
  const T = { 1: [], 2: [], 3: [] };
  const CS = { 1: [], 2: [], 3: [] };
  const demote = [];               // regions lowered to tier 1
  const holes = [];                // regions cut through every tier (core well)
  const bridgeShapes = [];         // for the Forge highlight

  const csOf = (polys) => {
    const ok = polys.filter((p) => p.length >= 3);
    return k(ok.length ? CrossSection.ofPolygons(ok, 'Positive') : CrossSection.union([]));
  };
  const annulus = (r, w, seg) => {
    const ro = r + w / 2, ri = Math.max(0.01, r - w / 2);
    return k(k(CrossSection.circle(ro, seg || Math.max(48, Math.min(256, Math.ceil(ro * 5))))).subtract(k(CrossSection.circle(ri, seg || Math.max(48, Math.min(256, Math.ceil(ro * 5)))))));
  };
  const ringFromRadius = (fr, w, seg = 360) => { // closed band following r(θ)
    const outer = [], inner = [];
    for (let i = 0; i < seg; i++) { const a = (TAU * i) / seg, r = fr(a); outer.push(polar(r + w / 2, a)); inner.push(polar(Math.max(0.1, r - w / 2), a)); }
    return k(k(CrossSection.ofPolygons([outer], 'Positive')).subtract(k(CrossSection.ofPolygons([inner], 'Positive'))));
  };
  const sector = (r0, r1, a0, a1) => {
    const pts = [];
    const m = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 0.05));
    for (let i = 0; i <= m; i++) pts.push(polar(r1, lerp(a0, a1, i / m)));
    for (let i = m; i >= 0; i--) pts.push(polar(Math.max(0, r0), lerp(a0, a1, i / m)));
    return ccw(pts);
  };

  // ---------------------------------------------------------------- 1. core (tier 3)
  const C = g.core;
  const rc = C.r * R, cw = W(C.w);
  const P = n * Math.max(1, Math.ceil(Math.max(3, C.mult * (n < 3 ? 6 : n)) / n)) ; // arms: a multiple of n, ≥ 3
  const chir = group === 'C' ? (C.twist >= 0 ? 1 : -1) : 0;
  const twist = group === 'C' ? C.twist : 0;
  const armAngles = (count) => Array.from({ length: count }, (_, i) => (TAU * i) / count);
  const core = [];
  switch (C.glyph) {
    case 'star': {
      const pts = [];
      for (let i = 0; i < 2 * P; i++) {
        const a = (Math.PI * i) / P + (i % 2 ? twist * Math.PI / P : 0);
        pts.push(polar(i % 2 ? rc * C.inner : rc, a));
      }
      core.push(ccw(pts));
      break;
    }
    case 'polygon': {
      const N = n >= 3 ? n : 8;
      CS[3].push(k(k(CrossSection.ofPolygons([regular(N, rc)], 'Positive')).subtract(k(CrossSection.ofPolygons([regular(N, Math.max(0.1, rc - cw * 1.2))], 'Positive')))));
      CS[3].push(k(k(CrossSection.ofPolygons([regular(N, rc * C.inner)], 'Positive')).subtract(k(CrossSection.ofPolygons([regular(N, Math.max(0.1, rc * C.inner - cw))], 'Positive')))));
      for (const a of armAngles(N)) core.push(strokePath([polar(rc * C.inner - cw / 2, a), polar(rc - cw / 2, a)], cw));
      break;
    }
    case 'rosette': {
      for (const a of armAngles(P)) {
        const pet = taper(sample((t) => [rc * t, twist * rc * 0.35 * Math.sin(Math.PI * t)], 20), (t) => Math.max(mw * 1.05, rc * C.inner * 0.55 * Math.sin(Math.PI * t)));
        core.push(along(pet, a));
      }
      core.push(circlePoly(0, 0, Math.max(cw, rc * 0.18)));
      break;
    }
    case 'swirl': {
      const count = Math.max(n, 3);
      for (const a of armAngles(count)) for (const p of commaShape(rc * 0.5, rc * 0.5, chir || 1)) core.push(along(p, a));
      core.push(circlePoly(0, 0, Math.max(cw, rc * 0.2)));
      break;
    }
    case 'eye': {
      const m = n % 2 ? n : n / 2;
      for (let i = 0; i < m; i++) {
        const a = (Math.PI * i) / m;
        const outer = along(lens(-rc, rc, rc * C.inner * 0.75), a);
        const inner = along(lens(-rc + cw * 1.6, rc - cw * 1.6, Math.max(0.2, rc * C.inner * 0.75 - cw)), a);
        CS[3].push(k(k(CrossSection.ofPolygons([outer], 'Positive')).subtract(k(CrossSection.ofPolygons([inner], 'Positive')))));
      }
      core.push(circlePoly(0, 0, Math.max(cw, rc * 0.3)));
      break;
    }
    case 'seed': {
      const N = n * Math.ceil(6 / n);
      const rho = rc / 2;
      CS[3].push(annulus(rho, cw));
      for (const a of armAngles(N)) { const [x, y] = polar(rho, a); CS[3].push(k(annulus(rho, cw).translate([x, y]))); }
      break;
    }
    case 'wedge': {
      for (const a of armAngles(P)) {
        const head = ccw([[rc * 0.18, 0], [rc * 0.55, rc * 0.22], [rc * 0.48, 0], [rc * 0.55, -rc * 0.22]]);
        core.push(along(head, a + twist * 0.3));
        core.push(along(strokePath([[rc * 0.45, 0], [rc, chir * rc * 0.08]], cw), a + twist * 0.3));
      }
      core.push(circlePoly(0, 0, Math.max(cw, rc * 0.22)));
      break;
    }
    case 'wardarms': {
      for (const a of armAngles(P)) {
        core.push(along(strokePath([[0, 0], [rc * 0.92, 0]], cw), a));
        for (const f of [0.5, 0.74]) core.push(along(strokePath([[rc * f, -rc * 0.12], [rc * f, rc * 0.12]], cw * 0.9), a));
        core.push(along(strokePath([[rc * 0.8, 0], [rc, rc * 0.12]], cw * 0.9), a));
        core.push(along(strokePath([[rc * 0.8, 0], [rc, -rc * 0.12]], cw * 0.9), a));
      }
      core.push(circlePoly(0, 0, Math.max(cw * 1.2, rc * 0.16)));
      break;
    }
    case 'flame': {
      for (const a of armAngles(P)) core.push(along(flameShape(rc * 0.58, rc * 0.42, chir), a));
      core.push(circlePoly(0, 0, Math.max(cw, rc * 0.28)));
      break;
    }
    default: core.push(circlePoly(0, 0, rc));
  }
  T[3].push(...core);
  if (C.well) holes.push(circlePoly(0, 0, Math.max(mw, rc * C.inner * 0.42)));

  // ---------------------------------------------------------------- 2. rings (tier 2), rim = ring 0
  const rings = g.rings.map((ring, i) => ({ ...ring, i, rr: ring.r * R, w: W(ring.w) }));
  const rim = rings[0];
  rim.rr = R - rim.w / 2;
  const rimInner = rim.rr - rim.w / 2;
  for (const ring of rings) {
    const isRim = ring.i === 0;
    const T_ = n * Math.max(1, Math.ceil((ring.count * 8) / n));
    const ph = (ring.phase * TAU) / T_;
    switch (ring.style) {
      case 'teeth': {
        CS[2].push(annulus(ring.rr, ring.w));
        const dir = isRim || ring.inward ? -1 : 1;
        const edge = ring.rr + (dir * ring.w) / 2;
        const depth = Math.max(mw * 1.2, ring.depth * R);
        const half = Math.max(mw * 0.7, Math.min(depth * 0.6, (Math.PI * ring.rr) / T_ * 0.55));
        const tooth = ccw([polar(edge - dir * ring.w * 0.3, -half / ring.rr), polar(edge + dir * depth, 0), polar(edge - dir * ring.w * 0.3, half / ring.rr)]);
        for (let j = 0; j < T_; j++) T[2].push(rotPoly(tooth, ph + (TAU * j) / T_));
        break;
      }
      case 'wave': {
        const amp = Math.max(mw * 0.5, ring.depth * R * 0.8);
        const base = isRim ? R - ring.w / 2 - amp : ring.rr;
        CS[2].push(ringFromRadius((a) => base + amp * Math.cos(T_ / 2 * (a - ph)), ring.w));
        if (isRim) CS[2].push(annulus(R - ring.w * 0.4, ring.w * 0.8));
        break;
      }
      case 'braid': {
        const amp = Math.max(mw * 0.6, ring.w * 0.55);
        const base = isRim ? R - ring.w / 2 - amp : ring.rr;
        const sw = Math.max(mw * 1.05, ring.w * 0.6);
        CS[2].push(ringFromRadius((a) => base + amp * Math.cos(T_ / 2 * (a - ph)), sw));
        CS[3].push(ringFromRadius((a) => base - amp * Math.cos(T_ / 2 * (a - ph)), sw)); // one strand rides higher: over / under
        if (isRim) CS[2].push(annulus(R - sw / 2, sw));
        break;
      }
      case 'notched': {
        CS[2].push(annulus(ring.rr, ring.w));
        const nw = Math.max(mg * 1.6, ring.w * 0.45);
        for (let j = 0; j < T_; j++) {
          const a = ph + (TAU * j) / T_;
          demote.push(along(ccw([[ring.rr - ring.w * 0.55, -nw / 2], [ring.rr + ring.w * 0.55, -nw / 2], [ring.rr + ring.w * 0.55, nw / 2], [ring.rr - ring.w * 0.55, nw / 2]]), a));
        }
        break;
      }
      case 'split': {
        CS[2].push(annulus(ring.rr, ring.w));
        const G = ring.gaps * n, span = (ring.gapDeg * Math.PI) / 180;
        for (let j = 0; j < G; j++) {
          const a = ph + (TAU * j) / G + (TAU / G) * 0.5;
          demote.push(sector(ring.rr - ring.w * 0.75, ring.rr + ring.w * 0.75, a - span / 2, a + span / 2));
        }
        break;
      }
      default: CS[2].push(annulus(ring.rr, ring.w));
    }
  }

  // ---------------------------------------------------------------- 3. spokes (tier 2) + terminals (tier 3)
  const sp = g.spokes;
  const Ns = n * sp.mult;
  if (sp.style !== 'none') {
    const sw = W(sp.w);
    const r0 = sp.r0 * R, r1 = Math.min(sp.r1 * R, rim.rr);
    const swedge = wedgeAngle(group, Ns);
    const a0 = sp.phase * swedge;
    const amp = sp.amp * R;
    let path;
    switch (sp.style) {
      case 'wave': path = sample((t) => rot([lerp(r0, r1, t), amp * Math.sin(Math.PI * sp.waves * t)], a0), 40); break;
      case 'spiral': path = sample((t) => polar(lerp(r0, r1, t), a0 + sp.twist * t * (TAU / Ns) * 0.9), 40); break;
      case 'zigzag': {
        const steps = sp.waves * 2 + 1;
        path = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const off = i === 0 || i === steps ? 0 : (i % 2 ? 1 : -1) * Math.max(amp, sw);
          path.push(rot([lerp(r0, r1, t), off], a0));
        }
        break;
      }
      default: path = [polar(r0, a0), polar(r1, a0)];
    }
    // sharp-cornered paths are stroked per segment (a ribbon would pinch at the corners)
    const strokes = sp.style === 'zigzag' || sp.style === 'bar'
      ? path.slice(1).map((p, i) => strokePath([path[i], p], sw))
      : [strokePath(path, sw)];
    T[2].push(...orbit(strokes, group, Ns));

    // terminal sits just inside the rim, pointing along the spoke
    if (sp.terminal !== 'none') {
      const ts = Math.max(mw * 1.6, sp.termSize * R);
      const rt = rimInner - ts * 0.9;
      let i = path.findIndex((p) => Math.hypot(p[0], p[1]) >= rt);
      if (i < 1) i = path.length - 1;
      const p = path[i], q = path[i - 1];
      const dir = Math.atan2(p[1] - q[1], p[0] - q[0]);
      const loc = (poly) => poly.map(([x, y]) => { const [u, v] = rot([x, y], dir); return [u + p[0], v + p[1]]; });
      let shapes = [];
      switch (sp.terminal) {
        case 'spear': shapes = [triangle(0, ts, 1)]; break;
        case 'orb': shapes = [circlePoly(0, 0, ts * 0.6, 24)]; break;
        case 'fork': shapes = [strokePath([[-ts * 0.6, 0], [ts * 0.5, ts * 0.6]], Math.max(mw * 1.05, sw * 0.9)), strokePath([[-ts * 0.6, 0], [ts * 0.5, -ts * 0.6]], Math.max(mw * 1.05, sw * 0.9))]; break;
        case 'flame': shapes = [flameShape(0, ts * 0.9, chir)]; break;
        default: break;
      }
      T[3].push(...orbit(shapes.map(loc), group, Ns));
    }
  }

  // ---------------------------------------------------------------- 4. lattice (tier 2)
  const L = g.lattice;
  if (L.kind !== 'none') {
    const lw = W(L.w), lr = L.r * R;
    const Nl = n * L.mult * (n < 3 ? 3 : 1);
    if (L.kind === 'vesica') {
      const rho = Math.max(lw * 2, L.size * R);
      for (let j = 0; j < Nl; j++) { const [x, y] = polar(lr, (TAU * (j + 0.5)) / Nl); CS[2].push(k(annulus(rho, lw).translate([x, y]))); }
    } else if (L.kind === 'chords') {
      const Np = Math.max(5, Nl);
      const step = clamp(L.step + 1, 2, Math.floor((Np - 1) / 2));
      const pts = regular(Np, lr, Math.PI / Np);
      for (let j = 0; j < Np; j++) T[2].push(strokePath([pts[j], pts[(j + step) % Np]], lw));
    } else if (L.kind === 'web') {
      const Np = Math.max(3, Nl);
      for (const f of [1, 0.68]) {
        const outer = regular(Np, lr * f + lw / 2, Math.PI / Np), inner = regular(Np, Math.max(0.1, lr * f - lw / 2), Math.PI / Np);
        CS[2].push(k(k(CrossSection.ofPolygons([outer], 'Positive')).subtract(k(CrossSection.ofPolygons([inner], 'Positive')))));
      }
    }
  }

  // ---------------------------------------------------------------- 5. motifs (tier 2/3), lifted by the group
  for (const m of g.motifs) {
    const s = Math.max(mw * 1.5, m.size * R);
    const x = clamp(m.r * R, rc + s * 0.5, rimInner - s * 0.8);
    let shapes;
    switch (m.kind) {
      case 'orb': shapes = [circlePoly(x, 0, s * 0.6, 28)]; break;
      case 'ringlet': shapes = null; break;
      case 'tri': shapes = [triangle(x, s * 0.9, 1)]; break;
      case 'wedge': shapes = [ccw([[x - s, 0], [x - s * 0.2, s * 0.5], [x + s, 0], [x - s * 0.2, -s * 0.5]])]; break;
      case 'swirl': shapes = commaShape(x, s * 0.9, chir || 1); break;
      case 'diamond': shapes = [diamond(x, s)]; break;
      case 'flame': shapes = [flameShape(x, s, chir)]; break;
      default: shapes = [circlePoly(x, 0, s * 0.5)];
    }
    const a = m.phase * wedge;
    if (shapes) T[m.tier].push(...orbit(shapes.map((p) => rotPoly(p, a)), group, n));
    else {
      for (let j = 0; j < n; j++) for (const sgn of group === 'D' ? [1, -1] : [1]) {
        const [cx, cy] = polar(x, sgn * a + (TAU * j) / n);
        CS[m.tier].push(k(annulus(s * 0.55, Math.max(mw * 1.05, s * 0.3)).translate([cx, cy])));
      }
    }
  }

  // ---------------------------------------------------------------- 6. fracture: lowered cracks (asymmetric on purpose)
  const fr = g.fracture;
  if (fr.cuts > 0) {
    const r = rng(fr.seed);
    for (let c = 0; c < fr.cuts; c++) {
      const a = r.range(0, Math.PI), off = r.range(-0.35, 0.35) * R;
      const steps = 7 + Math.round(fr.jag * 6), pts = [];
      for (let i = 0; i <= steps; i++) {
        const t = lerp(-1.05, 1.05, i / steps) * R;
        const j = i === 0 || i === steps ? 0 : (r() - 0.5) * fr.jag * R * 0.22;
        pts.push(rot([t, off + j], a));
      }
      demote.push(strokePath(pts, Math.max(mg * 1.8, fr.w * R)));
    }
  }
  timings.primitives = Date.now() - t0;

  // ---------------------------------------------------------------- 7. pre-union, demote, clamp
  const t1s = Date.now();
  const unionTier = (i) => k(CrossSection.union([csOf(T[i]), ...CS[i]]));
  let A3 = unionTier(3);
  let A2 = k(unionTier(2).add(A3));
  let A1 = k(csOf(T[1]).add(A2));
  const disc = k(CrossSection.circle(R, Math.max(96, Math.min(360, Math.ceil(R * 8)))));
  A1 = k(A1.intersect(disc)); A2 = k(A2.intersect(disc)); A3 = k(A3.intersect(disc));
  let demoted = null;
  if (demote.length) {
    const D = k(csOf(demote).intersect(A2));
    A3 = k(A3.subtract(D)); A2 = k(A2.subtract(D));
    demoted = D;
  }
  if (holes.length) {
    const H = csOf(holes);
    A1 = k(A1.subtract(H)); A2 = k(A2.subtract(H)); A3 = k(A3.subtract(H));
  }
  const rawArea = A1.area();
  const morph = (cs) => {
    const closed = k(k(cs.offset(mg / 2, 'Round', 2, 24)).offset(-mg / 2, 'Round', 2, 24));
    return k(k(closed.offset(-mw * 0.45, 'Round', 2, 24)).offset(mw * 0.45, 'Round', 2, 24));
  };
  A3 = morph(A3); A2 = k(morph(A2).add(A3)); A1 = k(morph(A1).add(A2));
  A1 = k(A1.intersect(disc)); A2 = k(A2.intersect(A1)); A3 = k(A3.intersect(A2));
  // drop vertices closer than a printer can resolve (keeps extrusion + union fast)
  const eps = Math.min(0.02, mw * 0.02);
  A1 = k(A1.simplify(eps)); A2 = k(A2.simplify(eps)); A3 = k(A3.simplify(eps));
  const thinLossPct = rawArea > 0 ? Math.max(0, 100 * (1 - A1.area() / rawArea)) : 0;
  timings.union = Date.now() - t1s;

  // ---------------------------------------------------------------- 8. island solver (open-work)
  const t2s = Date.now();
  let islandsBridged = 0, debrisRemoved = 0, components = 1;
  const symmetric = fr.cuts === 0;
  if (F.kind === 'openwork') {
    const bw = Math.max(mw * 1.3, 1.2);
    for (let iter = 0; iter < 10; iter++) {
      // probe a slightly eroded copy: pieces that only kiss at a vertex count as separate
      const parts = k(A1.offset(-0.05, 'Round', 2, 12)).decompose().map(k);
      components = parts.length;
      if (parts.length <= 1) break;
      parts.sort((a, b) => b.area() - a.area());
      const main = parts[0];
      const mainPts = main.toPolygons().flat();
      // drop sub-printable debris
      const debris = parts.slice(1).filter((p) => p.area() < 2 * mw * mw);
      if (debris.length) {
        const Dd = k(k(CrossSection.union(debris)).offset(0.2, 'Round', 2, 12)); // re-grow past the probe's erosion
        A1 = k(A1.subtract(Dd)); A2 = k(A2.subtract(Dd)); A3 = k(A3.subtract(Dd));
        debrisRemoved += debris.length;
        continue;
      }
      // bridge the island closest to the main body, then let the orbit carry it to its siblings
      let best = null;
      for (const isl of parts.slice(1)) {
        const cp = closestPair(isl.toPolygons().flat(), mainPts);
        if (!best || cp.d < best.d) best = cp;
      }
      const [px, py] = best.a, [qx, qy] = best.b;
      const d = Math.hypot(qx - px, qy - py) || 1, ux = (qx - px) / d, uy = (qy - py) / d;
      const seg = strokePath([[px - ux * bw, py - uy * bw], [qx + ux * bw, qy + uy * bw]], bw);
      const shapes = symmetric ? orbit([seg], 'C', n).concat(group === 'D' ? orbit([mirrorPoly(seg)], 'C', n) : []) : [seg];
      const B = k(csOf(shapes).intersect(disc));
      bridgeShapes.push(B);
      A1 = k(A1.add(B));
      islandsBridged += 1;
    }
    const finalParts = k(A1.offset(-0.05, 'Round', 2, 12)).decompose().map(k);
    components = finalParts.length;
    if (components > 1) warnings.push('DISCONNECTED');
  }
  timings.islands = Date.now() - t2s;

  // ---------------------------------------------------------------- 9. housing: bail, plinth, plate
  const bailCS = F.bail ? k(annulus(BAIL.id / 2 + BAIL.wall / 2, BAIL.wall, 48).translate([0, R + BAIL.id / 2 + 0.3])) : null;
  const plinthCS = F.plinth ? k(CrossSection.ofPolygons([[[-0.55 * R, -R - 1], [0.55 * R, -R - 1], [0.55 * R, -R + 0.2 * R], [-0.55 * R, -R + 0.2 * R]]], 'Positive')) : null;
  let plate = null;
  if (F.kind !== 'openwork') {
    if (F.shape === 'polygon') {
      const N = n >= 5 ? n : 8;
      plate = k(CrossSection.ofPolygons([regular(N, R / Math.cos(Math.PI / N) * 0.97, Math.PI / 2 + Math.PI / N)], 'Positive'));
    } else plate = disc;
  }
  // footprint polygons for SVG
  const polys = (cs) => (cs ? cs.toPolygons() : []);
  let fA1 = A1, fA2 = A2, fA3 = A3;
  if (F.kind === 'coin') { // engraved: the sigil is cut into the face, with a margin
    const s = 0.86;
    fA2 = k(A2.scale([s, s])); fA3 = k(A3.scale([s, s])); fA1 = k(A1.scale([s, s]));
  } else if (F.kind === 'medallion') {
    const inset = k(plate.offset(-(F.bevel + 0.3), 'Round', 2, 24));
    fA2 = k(A2.intersect(inset)); fA3 = k(A3.intersect(inset));
  }
  if (bailCS) { fA1 = k(fA1.add(bailCS)); fA2 = k(fA2.add(bailCS)); }
  if (plinthCS) fA1 = k(fA1.add(plinthCS));

  const out = {
    genome: g,
    tiers: { t1: polys(F.kind === 'openwork' ? fA1 : k(plate.add(fA1))), t2: polys(fA2), t3: polys(fA3) },
    bridges: bridgeShapes.length || demoted ? polys(k(k(CrossSection.union([...bridgeShapes, ...(demoted ? [demoted] : [])])).intersect(fA1))) : [],
    plate: plate ? polys(plate) : [],
    radius: R,
  };
  if (F.kind === 'coin') out.tiers = { t1: polys(bailCS ? k(plate.add(bailCS)) : plate), t2: polys(fA2), t3: polys(fA3) };

  // ---------------------------------------------------------------- 10. 3D
  const { t1, t2, t3 } = g.relief;
  let solid = null, tel3 = {};
  if (opts.solid || opts.manifold) {
    const t3s = Date.now();
    const ext = (cs, z0, z1, scaleTop) => k(k(cs.extrude(z1 - z0, 0, 0, scaleTop || [1, 1])).translate([0, 0, z0]));
    const parts = [];
    if (F.kind === 'openwork') {
      parts.push(ext(fA1, 0, t1), ext(fA2, t1, t2), ext(fA3, t2, t3));
    } else {
      const s = plate === disc ? (R - F.bevel) / R : (R - F.bevel) / R;
      if (F.kind === 'medallion') {
        parts.push(ext(plate, 0, t1, [s, s]), ext(fA2, t1, t2), ext(fA3, t2, t3));
        if (bailCS) parts.push(ext(bailCS, 0, t2));
      } else { // coin: plate to t3, engraving carved down
        let body = ext(plate, 0, t3, [s, s]);
        body = k(body.subtract(ext(fA2, t2, t3 + 1)));
        body = k(body.subtract(ext(fA3, t1, t3 + 1)));
        parts.push(body);
        if (bailCS) parts.push(ext(bailCS, 0, t2));
      }
    }
    if (plinthCS) parts.push(ext(plinthCS, 0, F.plinthDepth));
    solid = k(Manifold.union(parts));
    const pieces = solid.decompose().map(k);
    const bb = solid.boundingBox();
    const vol = solid.volume();
    tel3 = {
      status: String(solid.status()),
      bodies: pieces.length,
      genus: solid.genus(),
      volumeMm3: +vol.toFixed(1),
      massG: +((vol / 1000) * PLA_DENSITY).toFixed(2),
      dimensionsMm: { x: +(bb.max[0] - bb.min[0]).toFixed(2), y: +(bb.max[1] - bb.min[1]).toFixed(2), z: +(bb.max[2] - bb.min[2]).toFixed(2) },
      triangles: solid.numTri(),
    };
    if (pieces.length > 1 && !warnings.includes('DISCONNECTED')) warnings.push('DISCONNECTED');
    const mesh = solid.getMesh();
    const np = mesh.numProp, nv = mesh.vertProperties.length / np;
    const positions = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) { positions[3 * i] = mesh.vertProperties[np * i]; positions[3 * i + 1] = mesh.vertProperties[np * i + 1]; positions[3 * i + 2] = mesh.vertProperties[np * i + 2]; }
    out.mesh = { positions, indices: new Uint32Array(mesh.triVerts) };
    if (bridgeShapes.length || demoted) { // thin overlay on top of the bridges, for the Forge highlight
      const Bcs = k(k(CrossSection.union([...bridgeShapes, ...(demoted ? [demoted] : [])])).intersect(F.kind === 'coin' ? k(plate.offset(-1, 'Round', 2, 16)) : fA1));
      const ov = k(ext(Bcs, F.kind === 'coin' ? t3 : t1, (F.kind === 'coin' ? t3 : t1) + 0.06)).getMesh();
      const p2 = new Float32Array((ov.vertProperties.length / ov.numProp) * 3);
      for (let i = 0; i < p2.length / 3; i++) for (let j = 0; j < 3; j++) p2[3 * i + j] = ov.vertProperties[ov.numProp * i + j];
      out.bridgeMesh = { positions: p2, indices: new Uint32Array(ov.triVerts) };
    }
    timings.solid = Date.now() - t3s;
  }

  // ---------------------------------------------------------------- 11. telemetry
  let symmetryErrorPct = null;
  if (symmetric && n > 1) { // rotate the footprint by one step and compare: area(A Δ rot A) / area(A)
    const rA = k(A1.rotate(360 / n));
    const inter = k(A1.intersect(rA)).area(), a = A1.area();
    symmetryErrorPct = +(100 * (2 * a - 2 * inter) / Math.max(1e-9, a)).toFixed(3);
    if (symmetryErrorPct > 2) warnings.push('SYMMETRY_DRIFT');
  }
  if (thinLossPct > 6) warnings.push('THIN_FEATURES');
  out.telemetry = {
    schema: 'sigil-telemetry/1',
    compilerVersion: VERSION,
    hash: hashGenome(g),
    name: g.meta.name,
    symmetry: `${group}${n}`,
    form: F.kind,
    diameterMm: F.diameter,
    reliefMm: { t1, t2, t3 },
    filamentSwapsAtMm: F.kind === 'coin' ? [t1, t2] : [t1, t2],
    components,
    islandsBridged,
    debrisRemoved,
    thinLossPct: +thinLossPct.toFixed(2),
    minWallMm: mw,
    minGapMm: mg,
    symmetryErrorPct,
    footprintAreaMm2: +A1.area().toFixed(1),
    ...tel3,
    warnings,
    timingsMs: { ...timings, total: Date.now() - t0 },
  };

  if (opts.manifold && solid) {
    out.manifold = solid;                         // caller owns this one
    S.items = S.items.filter((o) => o !== solid);
  }
  S.free();
  return out;
}
