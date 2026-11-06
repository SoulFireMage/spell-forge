// manifoldcad.js — turn a genome into a self-contained ManifoldCAD script.
//
// The script is the Spellforge's *actual* compiler source (geom.js,
// genome.js, sigil.js, with import/export lines stripped) plus the genome,
// ending in `export default <Manifold>`. Paste it into https://manifoldcad.org,
// or run:  npx manifold-cad sigil.mjs sigil.3mf
// Nothing is paraphrased, so what you read is exactly what built the sigil.

export const SOURCE_FILES = ['version.js', 'geom.js', 'genome.js', 'sigil.js'];

const strip = (src) => src
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
  .replace(/^export\s+(?=(const|let|function|class|async)\b)/gm, '');

/**
 * @param {object} p
 * @param {Record<string,string>} p.sources  file name → source text (SOURCE_FILES)
 * @param {object} p.genome
 */
export function buildManifoldCadScript({ sources, genome }) {
  const version = (sources['version.js'].match(/VERSION = '([^']+)'/) || [])[1] || '?';
  const name = (genome.meta && genome.meta.name) || 'Sigil';
  const genomeJson = JSON.stringify(genome, (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v), 2);
  const body = SOURCE_FILES.map((f) => `// ${'='.repeat(70)}\n// src/${f}\n// ${'='.repeat(70)}\n${strip(sources[f])}`).join('\n\n');
  return `// ${name} — ManifoldCAD script exported from Soulfire Mage's Spellforge v${version}
// https://github.com/SoulFireMage/spell-forge
//
// Paste into https://manifoldcad.org, or run:  npx manifold-cad sigil.mjs sigil.3mf
//
// Everything below GENOME is the Spellforge's real compiler, inlined
// unchanged. How it uses Manifold:
//   • 2D first: every primitive is a polygon, lifted to the full disc by the
//     symmetry group, pre-unioned per relief tier with CrossSection (Clipper)
//   • offset() closing + opening clamp gaps and walls to the nozzle
//   • decompose() finds islands; tier-1 bridges join them to the body
//   • extrude() each tier from Z = 0 and Manifold.union() them: watertight
// Units are millimetres.

import { Manifold, CrossSection } from 'manifold-3d/manifoldCAD';

const GENOME = ${genomeJson};

${body}

// ${'='.repeat(70)}
// build
// ${'='.repeat(70)}
const built = compileSigil({ Manifold, CrossSection }, GENOME, { manifold: true });
console.log(JSON.stringify(built.telemetry, null, 2));
export default built.manifold;
`;
}
