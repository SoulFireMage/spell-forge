// worker.js — runs the sigil compiler off the main thread so the crucible
// grid and the orbit camera never stall while manifold-3d does booleans.
import Module from 'https://cdn.jsdelivr.net/npm/manifold-3d@3.5.4/manifold.js';
import { compileSigil } from './sigil.js?v=1.2.0';

const ready = Module().then((w) => { w.setup(); return w; });

self.onmessage = async (e) => {
  const { id, genome, opts } = e.data;
  const wasm = await ready;
  try {
    const r = compileSigil(wasm, genome, opts || {});
    const transfer = [];
    for (const m of [r.mesh, r.bridgeMesh]) if (m) transfer.push(m.positions.buffer, m.indices.buffer);
    self.postMessage({ id, ok: true, result: r }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
