// geom.js — pure geometry helpers shared by the sigil compiler.
// No DOM, no Three.js: runs identically in the browser, the worker, Node and
// ManifoldCAD.

/**
 * WASM lifetime scope. manifold-3d objects live in WebAssembly memory that the
 * JS garbage collector cannot see, so every Manifold / CrossSection we create
 * is registered here and freed in one go with `free()`.
 *
 *   const S = new Scope();
 *   const a = S.k(CrossSection.circle(10));   // tracked
 *   const b = S.k(a.offset(-1));              // every intermediate is tracked too
 *   S.free();                                 // deletes a and b
 */
export class Scope {
  constructor() { this.items = []; }
  k(obj) { this.items.push(obj); return obj; }
  free() {
    for (const o of this.items) { try { o.delete(); } catch (_) { /* already gone */ } }
    this.items.length = 0;
  }
}

export const TAU = Math.PI * 2;
export const PHI = (1 + Math.sqrt(5)) / 2;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Seeded randomness (deterministic: same seed → same sigil, everywhere)
// ---------------------------------------------------------------------------

/** mulberry32: tiny, fast, good enough for design variation. */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
  next.gauss = () => { // Box–Muller
    const u = Math.max(1e-12, next()), v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  next.chance = (p) => next() < p;
  return next;
}

/** FNV-1a 32-bit string hash. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Polygons: arrays of [x, y]. Outer contours are CCW (positive area).
// ---------------------------------------------------------------------------

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]);
  return a / 2;
}
export const ccw = (poly) => (signedArea(poly) < 0 ? poly.slice().reverse() : poly);
export const cw = (poly) => (signedArea(poly) > 0 ? poly.slice().reverse() : poly);

export const rot = ([x, y], a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
export const rotPoly = (poly, a) => poly.map((p) => rot(p, a));
/** Mirror across the X axis (the θ = 0 line), keeping CCW orientation. */
export const mirrorPoly = (poly) => poly.map(([x, y]) => [x, -y]).reverse();
export const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

export function circlePoly(cx, cy, r, seg = 0) {
  const n = seg || Math.max(12, Math.min(96, Math.ceil(r * 6)));
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}

/**
 * Stroke an open polyline into a closed ribbon polygon of width w (with round
 * caps). Ribbons are built from per-vertex normals, so gentle curves stay
 * clean; any self-overlap is resolved by the Positive-fill union downstream.
 */
export function strokePath(pts, w, { capSeg = 6 } = {}) {
  if (pts.length < 2) return circlePoly(pts[0][0], pts[0][1], w / 2);
  const h = w / 2, n = pts.length;
  const L = [], R = [];
  const nrm = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  for (let i = 0; i < n; i++) {
    const [nx, ny] = nrm(i);
    L.push([pts[i][0] + nx * h, pts[i][1] + ny * h]);
    R.push([pts[i][0] - nx * h, pts[i][1] - ny * h]);
  }
  const cap = (p, [nx, ny], dir) => { // half circle from +n to -n around p, bulging along dir
    const out = [];
    const a0 = Math.atan2(ny, nx);
    for (let k = 1; k < capSeg; k++) {
      const a = a0 + dir * Math.PI * (k / capSeg);
      out.push([p[0] + h * Math.cos(a), p[1] + h * Math.sin(a)]);
    }
    return out;
  };
  const nEnd = nrm(n - 1), nStart = nrm(0);
  const poly = [...L, ...cap(pts[n - 1], nEnd, -1), ...R.reverse(), ...cap(pts[0], [-nStart[0], -nStart[1]], -1)];
  return ccw(poly);
}

/** Sample a function t∈[0,1] → [x,y] into a polyline. */
export function sample(f, n) { const out = []; for (let i = 0; i <= n; i++) out.push(f(i / n)); return out; }

/** Bounding box of many polygons. */
export function bounds(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

/** Closest pair of points between two point sets (brute force on subsamples, then refined). */
export function closestPair(A, B) {
  const sub = (P, m) => (P.length <= m ? P : P.filter((_, i) => i % Math.ceil(P.length / m) === 0));
  const best = (P, Q) => {
    let d = Infinity, a = null, b = null;
    for (const p of P) for (const q of Q) {
      const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      if (dd < d) { d = dd; a = p; b = q; }
    }
    return { d: Math.sqrt(d), a, b };
  };
  const coarse = best(sub(A, 300), sub(B, 300));
  // refine within a neighbourhood of the coarse pair
  const near = (P, c, r) => P.filter((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < r);
  const r = coarse.d * 2 + 1;
  const fine = best(near(A, coarse.a, r).concat([coarse.a]), near(B, coarse.b, r).concat([coarse.b]));
  return fine.d <= coarse.d ? fine : coarse;
}
