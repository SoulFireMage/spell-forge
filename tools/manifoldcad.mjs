#!/usr/bin/env node
// ManifoldCAD script for a preset spell or a genome .json, on stdout.
//   node tools/manifoldcad.mjs ember-ward > ember.mjs && npx manifold-cad ember.mjs ember.3mf
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifoldCadScript, SOURCE_FILES } from '../src/manifoldcad.js';
import { presetGenome, PRESET_SPELLS } from '../src/lexicon.js';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const arg = process.argv[2] || 'ember-ward';
const genome = arg.endsWith('.json') ? JSON.parse(readFileSync(arg, 'utf8')) : presetGenome(PRESET_SPELLS[arg] ? arg : 'ember-ward');
const sources = Object.fromEntries(SOURCE_FILES.map((f) => [f, readFileSync(join(src, f), 'utf8')]));
process.stdout.write(buildManifoldCadScript({ sources, genome }));
