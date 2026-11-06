#!/usr/bin/env node
// Telemetry for a preset spell, a genome .json, or free-text effects.
//   node tools/compile.mjs ember-ward
//   node tools/compile.mjs my-sigil.json
//   node tools/compile.mjs --effects "protect my home" "sustained" "sealed" [--form medallion]
import Module from 'manifold-3d';
import { readFileSync } from 'node:fs';
import { compileSigil } from '../src/sigil.js';
import { presetGenome, compileEffects, PRESET_SPELLS } from '../src/lexicon.js';

const argv = process.argv.slice(2);
const wasm = await Module(); wasm.setup();
const formI = argv.indexOf('--form');
const form = formI >= 0 ? { kind: argv[formI + 1] } : {};
let genome;
if (argv[0] === '--effects') {
  const slots = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i] !== argv[formI + 1]).map((t) => ({ text: t }));
  genome = compileEffects(slots, { form: { kind: 'openwork', bail: true, ...form } });
} else if (argv[0] && argv[0].endsWith('.json')) genome = JSON.parse(readFileSync(argv[0], 'utf8'));
else genome = presetGenome(argv[0] && PRESET_SPELLS[argv[0]] ? argv[0] : 'ember-ward', form);
const r = compileSigil(wasm, genome, { solid: true });
console.log(JSON.stringify({ genome: argv.includes('--genome') ? r.genome : undefined, telemetry: r.telemetry }, null, 2));
