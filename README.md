# Soulfire Mage's Spellforge

Specify, design, and evolve 3D-printable physical spells for a myriad of
fantastical effects and magical concepts. Not suitable for use in matters of
national security, crime, crime detection, birth prevention, or serious
healthcare. One's tongue should be firmly within one's cheek when using.

**Live:** https://starship-whisperer.com/spell-forge/

## How it works

1. **Bind 1–3 effects.** Choose them from the grimoire's taxonomy (Clarity,
   Ignition, Bulwark… Sustained, Piercing… Sealed, Radiating…) or speak them
   in your own words. Slot I shapes the core and its symmetry, slot II the
   spokes and lattice, slot III the containing ring.
2. **Compile.** The Thaumaturgical Compiler reads the effects as weights over
   four domains (ward, kinetic, focus, entropy) and writes a **Sigil Genome**
   under the Laws of Sympathetic Geometry: warding wants dihedral D6/D8 and
   inward teeth; kinetic wants odd, chiral C3/C5/C7 and spirals; focus wants
   mirror symmetry and golden-ratio rings; entropy wants lightning and broken
   rings. Same words, same sigil. An optional Oracle lets Claude do the
   reading with your own API key.
3. **Breed in the Crucible.** Nine candidates in a 3×3 grid. Choose one or
   two parents, set the volatility from *Harmonic Refinement* to *Wild Surge*,
   and mutate. Children only use primitives their effects allow. Lineage lets
   you roll back.
4. **Forge.** The live 3D view shows the three relief tiers glowing hotter as
   they rise, and the structural bridges the solver added. Choose open-work
   talisman, raised medallion or engraved coin; diameter; your printer's wall
   size; a bail loop or a desk plinth.
5. **Export.** A watertight STL (or 3MF with coloured tiers), a layered SVG, the
   genome, a share link, a spell card with the inscription and the
   filament-swap heights, or a ManifoldCAD script.

6. **Keep and share (optional account).** Sign in to save sigils to a private
   **Spellbook** and to visit the **Hall of Sigils**, where members publish
   sigils for others to breed from. Accounts are kept by
   [Skapi](https://www.skapi.com) in the same project as Starship Whisperer,
   so one login works on both. Without an account nothing changes, and Skapi
   isn't contacted at all.

## Built solid

The geometry engine is the pattern from
[Starship Drydock](https://github.com/SoulFireMage/starship-builder): a pure
compiler from genome to [manifold-3d](https://github.com/elalish/manifold),
which guarantees watertight solids. Here it works 2D-first:

- the genome describes **one wedge**, and the compiler lifts it to the disc
  with the symmetry group, so mutation can't break the symmetry;
- every tier is pre-unioned in 2D with `CrossSection`, then walls and gaps are
  clamped to your nozzle with morphological opening and closing;
- an **island solver** finds floating pieces and bridges them at tier-1 height,
  around the whole symmetry orbit;
- every tier is extruded from the bed, so one connected footprint means one
  connected solid.

`npm test` checks the contract (one watertight body, no leaked WASM handles)
over every primitive, random free-text spells and long Wild-Surge breeding
walks. See [`AGENT_SPEC.md`](AGENT_SPEC.md) for the genome schema, the
compiler, the mutation logic and the agent API, and §9 there for where and
why the build departs from [the original brief](docs/requirements.md).

> **An AI project.** Built by **Claude** (Anthropic) for Soulfire Mage, from the
> brief in [`docs/requirements.md`](docs/requirements.md) and the mythos in
> [`docs/theme.md`](docs/theme.md).

## Run it

Zero-build static site. Locally, ES modules and workers need `http://`:

```bash
node tools/serve.mjs 8080     # → http://localhost:8080/
```

## Agent / developer tools

```bash
npm install                    # installs manifold-3d for the Node tools only
npm test                       # printability contract, leak check, symmetry, determinism, exporters
node tools/ui-test.mjs         # browser UI regression test (needs Playwright + Chromium)
node tools/compile.mjs ember-ward
node tools/compile.mjs --effects "protect my home" sustained sealed --form medallion
node tools/sheet.mjs           # contact sheet PNG of the presets (needs Playwright)
node tools/manifoldcad.mjs still-water > s.mjs && npx manifold-cad s.mjs s.3mf
node tools/version.mjs         # bump the release version (stamped into every module URL)
```

## Deploying on GitHub Pages

Pages is set to deploy from GitHub Actions: `.github/workflows/deploy.yml`
runs `npm test` on every push to `main`, then publishes `index.html`, `src/`
and `version.json` as they are (there's no build step). three.js, manifold-3d
and, only when used, the Skapi SDK and the Anthropic SDK load from jsDelivr at
pinned versions.

## Layout

| Path | Role |
|---|---|
| `index.html` | The workbench: effect slots, crucible, forge, lineage, export |
| `src/genome.js` | Schema, gene ranges, the Laws, normalise / mutate / crossover / brood / hash / encode |
| `src/lexicon.js` | Effects taxonomy, free-text reading, Gen-0 compiler, names and inscriptions, presets |
| `src/sigil.js` | Genome → 2D tiers → island solver → watertight solid + telemetry (pure; Node or browser) |
| `src/geom.js` | Polygons, strokes, seeded RNG, WASM `Scope` |
| `src/export.js` | SVG, binary STL, 3MF |
| `src/llm.js` | The optional Oracle (Claude, bring-your-own-key) |
| `src/cloud.js` | Skapi: accounts, private Spellbook, members' Hall of Sigils (tables `spellforge_*`) |
| `src/viewer.js` | Three.js Forge view |
| `src/worker.js` | Compiler off the main thread |
| `src/manifoldcad.js` | Self-contained ManifoldCAD script from the real sources |
| `src/app.js` | UI wiring and `window.spellforge` |
| `tools/` | `test`, `ui-test`, `compile`, `sheet`, `manifoldcad`, `serve`, `version` |
| `docs/` | The original brief and theme |
