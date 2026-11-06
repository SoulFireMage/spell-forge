# Soulfire Mage's Spellforge — Agent & Architect Specification (v1)

> Written by Claude from the owner's brief ([`docs/requirements.md`](docs/requirements.md))
> and theme ([`docs/theme.md`](docs/theme.md)), on the engine pattern of
> [Starship Drydock](https://github.com/SoulFireMage/starship-builder). §9
> lists where this departs from the brief, and why.

## 1. Core idea: printability in the compiler, variety in the genome

A sigil is a **genome** (a small JSON document) compiled by a **pure
function** into a watertight `manifold-3d` solid.

- **The genome describes one wedge plus a symmetry group.** The compiler
  builds the primitives of one fundamental wedge (π/n wide for Dₙ, 2π/n for
  Cₙ) and lifts them to the whole disc: Cₙ rotates, Dₙ mirrors across θ = 0,
  then rotates. Symmetry is a construction, not a parameter, so no mutation
  can break it. (Structurally, the genome lives in the quotient — disc / G —
  and the compiler is the lift back to the disc.) Entropy's "fracture" is the
  one deliberate exception, applied after the lift.
- **The compiler owns printability.** Strokes are built at ≥ the minimum
  wall; gaps and slivers are clamped morphologically; islands are bridged;
  everything is pre-unioned in 2D before extrusion. *Any* genome inside the
  ranges compiles to one connected, watertight body. `npm test` checks this
  over every primitive, random free-text spells and long Wild-Surge
  mutation / crossover walks.
- **The effects own the vocabulary.** The Laws of Sympathetic Geometry
  (`LAWS` in `src/genome.js`) say which primitives each domain may use;
  mutation substitutes only within what the bound effects allow, so children
  stay on-spell.
- **Selection supplies taste.** The crucible shows nine children; a human
  (or an agent with snapshots) picks one or two parents and breeds again.

## 2. Coordinates and units

- Millimetres. `+Z` up from the print bed; every tier is extruded from Z = 0.
- `+Y` is "up" on the talisman (the bail sits at +Y; the plinth at −Y).
- Symmetry mirror axis is θ = 0 (the +X axis).
- Genome lengths are fractions of the sigil radius R = diameter / 2.

## 3. Compiler pipeline (`src/sigil.js`)

`compileSigil(wasm, genome, { solid, manifold }) → { genome, tiers, bridges, plate, radius, mesh?, bridgeMesh?, telemetry }`

Pure: no DOM, no Three.js, every WASM object goes through `Scope.k()` and is
freed in `finally`-style at the end. Only `Manifold` and `CrossSection` are
used, so the same source runs in Node, the browser worker and ManifoldCAD.

| Stage | What happens | Rule |
|---|---|---|
| 0. Normalise | `normalize(genome)` clamps every gene, repairs structure, pins ring 0 to the rim | The compiler never trusts input |
| 1. Lift | Core (tier 3), rings (tier 2), spokes (tier 2) + terminals (tier 3), lattice (tier 2), motifs (tier 2/3) built in the wedge, lifted by the group | Spoke and motif counts are multiples of n, so they can't break the group |
| 2. Pre-union | Per tier: one Clipper union (`Positive` fill) of polygons + CrossSections; nest t3 ⊂ t2 ⊂ t1; clip to the disc | 2D booleans before any 3D |
| 3. Demote | Ring gaps (`split`), runic notches (`notched`) and fracture cracks are *lowered to tier 1*, not cut through | Connected by construction: a split ring is "bridged by a lower Z-layer bar" |
| 4. Clamp | Closing by the min gap, then opening by 0.9 × the min wall, per tier; simplify below 0.02 mm | Walls ≥ min wall, gaps ≥ min gap; `thinLossPct` reports what was smoothed |
| 5. Islands | Open-work only. `decompose()` the footprint; drop debris < 2 × wall²; bridge the nearest island to the main body along the closest pair of points (extended into both), width ≥ 1.3 × wall, at tier-1 height; replicate the bridge over the symmetry orbit; repeat | Because every tier starts at Z = 0, the solid is connected iff its footprint is |
| 6. Housing | Bail (4.5 mm ID, 2.5 mm wall, in the plane so it prints flat); plinth (flat foot for a desk totem); medallion plate (bevelled by `extrude(scaleTop)`) or engraved coin | Hardware is exact; never morphed |
| 7. Solid | Extrude tiers (t1 0→t1, t2 t1→t2, t3 t2→t3), `Manifold.union`, telemetry | One body, status `NoError` |

### Tiers (requirements §2 Stage 4)
| Tier | Default height | Holds |
|---|---|---|
| 1 | 0 – 1.8 mm | Bridges, lowered gaps / cracks; the plate on a medallion |
| 2 | 0 – 3.0 mm | Rings, spokes, lattice, tier-2 motifs, the bail |
| 3 | 0 – 4.0 mm | Core glyph, terminals, tier-3 motifs, the "over" strand of a braid |

Swap filament at t1 and t2 for a three-colour print. On a **coin** the sigil
is engraved instead: the plate rises to t3, tier-2 shapes are cut down to t2
and tier-3 shapes down to t1.

## 4. Sigil Genome schema (`sigil-genome/1`, `src/genome.js`)

```jsonc
{
  "schema": "sigil-genome/1",
  "meta": { "name": "Sigil of Bulwark, Sustained & Sealed", "inscription": "…", "generation": 0,
            "lineage": ["SF1-…"], "seed": 123456, "compiler": "lexicon" },     // or "oracle:<model>"
  "effects": [                                   // 1–3; slot 1 = Core, 2 = Flow, 3 = Binding
    { "slot": 1, "id": "bulwark", "text": "", "label": "Bulwark",
      "w": { "ward": 1, "kinetic": 0, "focus": 0, "entropy": 0 } }        // normalised domain weights
  ],
  "symmetry": { "group": "D", "n": 8 },          // C = rotations only (chiral), D = rotations + mirror; n 1–12
  "core":    { "glyph": "wardarms", "r": 0.26, "inner": 0.5, "w": 0.05, "twist": 0, "mult": 1, "well": false },
  "spokes":  { "style": "wave", "mult": 1, "r0": 0.16, "r1": 1, "w": 0.045, "amp": 0.04, "waves": 2,
               "twist": 0.4, "phase": 0, "terminal": "fork", "termSize": 0.08 },   // count = n × mult
  "lattice": { "kind": "chords", "r": 0.55, "size": 0.3, "w": 0.035, "step": 2, "mult": 1 },
  "rings": [                                     // 1–4; ring 0 is the rim (pinned to the edge)
    { "style": "braid", "r": 0.96, "w": 0.085, "count": 2, "depth": 0.05, "phase": 0, "gaps": 1, "gapDeg": 12, "inward": true }
  ],
  "motifs":  [ { "kind": "diamond", "r": 0.7, "phase": 0.5, "size": 0.08, "tier": 3 } ],  // 0–4, phase = fraction of the wedge
  "fracture": { "cuts": 0, "w": 0.045, "jag": 0.5, "seed": 7 },  // entropy's lowered lightning cracks
  "relief":  { "t1": 1.8, "t2": 3.0, "t3": 4.0 },                // mm
  "form":    { "kind": "openwork", "shape": "disc", "diameter": 45, "minWall": 1.6, "minGap": 0.8,
               "bevel": 0.8, "bail": true, "plinth": false, "plinthDepth": 12 },
  "palette": { "t1": "#3b1830", "t2": "#d0643a", "t3": "#ffcf6e", "bridge": "#9fe6ff" }
}
```

Ranges are in `GENES`; categorical options in `CATALOG`; the domain → primitive
laws in `LAWS`. `form`, `relief`, `palette` and `effects` are the user's
choices, not genes: mutation never touches them.

**Genome hash** (`hashGenome`): `SF1-` + FNV-1a of the canonical design
(everything except `meta`), so two identical sigils share a hash regardless
of name or lineage. **Share links**: `#g=` + URL-safe base64 of the genome.

### The Laws of Sympathetic Geometry (`LAWS`)
| Domain | Symmetry | Core | Spokes / terminals | Rings | Lattice | Motifs |
|---|---|---|---|---|---|---|
| ward | D6, D8 | wardarms, polygon, star | bar, wave / fork, orb | teeth (inward), plain, braid, notched | chords, web | diamond, ringlet, orb |
| kinetic | C3, C5, C7 | swirl, star, flame, polygon | spiral, wave, bar / spear, flame | wave, teeth, plain | none, chords | tri, swirl, flame |
| focus | D2, D4, D1 | eye, rosette, seed, star | bar, wave, none / orb | plain, braid, wave (φ spacing) | vesica, web | orb, ringlet, diamond |
| entropy | C1, D3, C2 | wedge, star, flame | zigzag, bar / spear, fork | split, notched, teeth | none, chords | wedge, tri |

A layer may use the union of the options of every domain holding ≥ 20 % of
its slot's weight (the top domain always counts). Slot 1 governs symmetry and
core; slot 2 spokes, terminals, lattice and motifs; slot 3 rings. A missing
slot inherits slot 1's weights. All motifs are *inspired by* traditions
(cuneiform wedge, comma swirl, warding arms, vesica), never reproductions of
living sacred symbols.

## 5. The Thaumaturgical Compiler

### 5a. Deterministic lexicon (default, `src/lexicon.js`)
`compileEffects(slots, opts) → genome`. Each slot is a curated effect
(`EFFECTS`, 24 of them, with domain weights) and/or free text. Free text is
scored by word stems per domain; unknown words add a small hashed nudge, so
every phrase gets a stable, distinct reading. The seed is a hash of the
effects, so **the same words always forge the same Generation 0**. Focus
spaces inner rings by 1/φ; ward thickens the rim; entropy above 45 % adds
fracture cracks. Names and inscriptions come from small templated pools in
the soulfire voice.

### 5b. Optional Oracle (`src/llm.js`)
Off by default. With the user's own Claude API key (kept in the browser), the
Oracle reads the effects and returns the **same intermediate form** the
lexicon produces, never a genome:

```jsonc
{ "name": "…", "inscription": "…",
  "effects": [ { "slot": 1, "label": "…", "weights": { "ward": 0.2, "kinetic": 0.7, "focus": 0.1, "entropy": 0 } } ],
  "hints": { "symmetry": "C5", "core": "flame", "spokes": "spiral", "terminal": "spear",
             "ring": "wave", "lattice": "none", "motifs": ["tri"] } }
```

That goes back through `compileEffects()`, which ignores any hint the
effects' laws don't allow. So the LLM can colour the reading, but it cannot
produce an invalid or unprintable sigil, and the printability contract stays
testable without a network. The request uses structured output
(`output_config.format` with a JSON schema), low effort, server-side refusal
fallback, and a system prompt (in `llm.js`) that explains the slots, the four
domains and the inscription voice, and asks that harmful requests be
gently reinterpreted.

## 6. Mutation and breeding (`mutate`, `crossover`, `brood` in `src/genome.js`)

```
mutate(parent, { seed, volatility v ∈ [0.05, 0.5] }):
  rate = 0.35 + v                        # chance each numeric gene drifts
  drift = gauss × v × (max − min)        # "5 % drift" at v = 0.05
  integer genes step ±1 with chance 2v   # spoke multiplier, teeth count, waves…
  sub = v ≤ 0.12 ? 0 : 1.4 (v − 0.12)    # primitive substitution chance
  with chance sub: swap core glyph / spoke style / terminal / lattice / ring style / motif kind,
                   each drawn from allowed(genome, layer) — the effects' laws
  with chance sub/2: move symmetry within the primary effect's groups (n changes by group, never n ± 1)
  with chance sub/2: add or remove an inner ring or a motif
  normalize()                            # re-clamp: printability is restored by the compiler anyway

crossover(A, B):  each layer block (core+symmetry together, spokes, lattice, rings, motifs, fracture,
                  relief) comes whole from A or B; core and spokes sometimes blend numerically.
                  Form, effects and palette follow A.

brood(parents, { seed, volatility }) → 9 children:
  child i uses volatility × (0.6 + 0.8 i/8)   # gentle → wild across the grid
  two parents: crossover (alternating lead) then mutate
```

Why *n* never steps by ±1: changing n alone changes the symmetry group, which
is slot 1's job. Spoke counts are `n × mult`, so "more spokes" is a step in
`mult` (6 → 12 → 18), which keeps the group.

Generation 0 is the compiled seed at the centre of the grid with eight
variants around it (volatility ≥ 0.3), so the first crucible already shows a
range.

## 7. Telemetry (`sigil-telemetry/1`)

| Field | Meaning |
|---|---|
| `status`, `bodies` | Manifold status (`NoError`) and solid components. **Bodies must be 1** |
| `components` | 2D footprint components after the island solver (= bodies) |
| `islandsBridged`, `debrisRemoved` | What the solver did |
| `thinLossPct` | Footprint area removed by the min-wall opening |
| `symmetryErrorPct` | area(A Δ rot(A, 360°/n)) / area(A); null with fracture |
| `volumeMm3`, `massG` | PLA at 1.24 g/cm³ |
| `dimensionsMm`, `triangles`, `genus` | From the final solid |
| `filamentSwapsAtMm` | t1 and t2 |
| `warnings[]` | `DISCONNECTED`, `THIN_FEATURES` (> 6 % smoothed), `SYMMETRY_DRIFT` (> 2 %) |
| `hash`, `compilerVersion`, `timingsMs` | |

## 8. Interfaces for agents

```bash
npm install                                    # only manifold-3d, for the Node tools
npm test                                       # contract + leak + symmetry + determinism + exporters
node tools/ui-test.mjs                         # browser UI regression (Playwright + Chromium)
node tools/compile.mjs ember-ward              # telemetry for a preset or a genome .json
node tools/compile.mjs --effects "protect my home" sustained sealed --form medallion
node tools/sheet.mjs                           # contact sheet of the presets → snapshots/sheet.png
node tools/sheet.mjs --brood phoenix-spark 0.5 # nine Wild-Surge children
node tools/manifoldcad.mjs still-water > s.mjs # self-contained ManifoldCAD script
npx manifold-cad s.mjs s.3mf                   # …which the official CLI runs
node tools/serve.mjs 8080                      # local server
```

In the browser, `window.spellforge`: `bind(slots)`, `breed(indices, volatility)`,
`load(genome)` resolve to telemetry; `compile(genome)` evaluates without
showing; `snapshot()`, `view('top'|'tilt'|'side'|'low')`, `manifoldCadScript()`;
`genome`, `telemetry`, `grid`, `effects`, `presets` are readable.

Agent loop: bind → read telemetry → breed → reject children with warnings →
snapshot survivors → choose → repeat. Record intent in `meta.lineage`.

### 8b. Accounts, Spellbook and the Hall (`src/cloud.js`, Skapi)

Optional, and outside the compiler: nothing in §1–7 depends on it.

- Project: the shared Starship Whisperer Skapi project (`SKAPI_PROJECT_ID`),
  the owner's choice, so one login works on both sites. Tables are prefixed
  `spellforge_` so neither app reads the other's data.
- SDK: `skapi-js@2.2.28` UMD build from jsDelivr, injected only on first use.
  Skapi isn't contacted until someone signs in, or a browser that signed in
  before returns (`localStorage['spellforge.cloud']`).
- `spellforge_spellbook` (access group `private`): your saved sigils.
- `spellforge_hall` (access group `public`): published sigils, withdrawable by
  their author. The project only answers **signed-in** readers (a project-wide
  setting it shares with Starship Whisperer), so the Hall is members-only; the
  UI asks a signed-out visitor to sign in first.
- Record data (< 2 KB): `{ v: 1, name, hash, symmetry, form, effects[], by?, g }`
  where `g` is the share-link encoding of the genome. `fromRecord()` decodes
  through `normalize()`, so a malformed or hostile record can't produce a bad
  genome; names and labels are clipped and HTML-escaped before display.
- `tools/ui-test.mjs` drives sign-in → save → publish → Hall → open → sign out
  against a stand-in Skapi (it never writes to the real project), and probes the
  live project read-only.

**WASM hygiene** is as in the Drydock: every handle through `Scope.k()`, and
`npm test` instruments the bindings and fails on any leak (it found two
during development).

**Releases**: `node tools/version.mjs` stamps `?v=` on every module URL;
`npm test` fails if they disagree; the page offers a reload when a newer
`version.json` is live.

## 9. Departures from the brief, and why

| Brief | Built | Reason |
|---|---|---|
| LLM compiler outputs the genome JSON | LLM is optional and outputs domain weights + hints; the deterministic compiler makes the genome | GitHub Pages can't hold a key; the printability contract must not depend on a network or on model output |
| Spoke counts n ± 1 | Spoke count = n × mult; mult steps | n ± 1 silently changes the symmetry group Slot 1 chose |
| Island bridge from the island's centroid | Bridge along the closest pair of points, replicated over the orbit | A centroid can lie outside a ring- or crescent-shaped island |
| Clamp stroke widths to the nozzle | Build strokes ≥ min wall *and* morphologically open/close each tier | Two legal strokes can still meet in a sliver or leave a sub-nozzle gap |
| Bridges at Z = 1.6 mm, tier 1 at 1.8 mm | Bridges are tier 1 (one number) | One source of truth; every tier starts at Z = 0 so connectivity is 2D |
| Volatility 5–45 % / 0.05–0.50 | 0.05–0.50 | The two sections disagreed |
| TypeScript mutation logic | Plain ES modules with JSDoc | Zero-build static site, like the Drydock |
| Crucible tab / Forge tab | Both on screen together (side by side on wide screens, stacked otherwise) | Watching the forge while breeding is the draw |
| Bail orientation unspecified | Bail lies in the plane of the coin | A loop standing off the face would need supports |
| Size unspecified | 20–120 mm, default 45 mm | Wall sizes mean nothing without it |
