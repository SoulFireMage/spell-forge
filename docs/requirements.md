

# Master Requirements Brief: Soulfire Mage’s Spellforge
**System Archetype:** Programmable Vector-to-3D Sigil Compiler & Evolutionary Forge  
**Target Output:** Watertight, manifold 3D meshes (`.STL` / `.3MF`) and parametric 2D vectors (`.SVG`) for physical 3D printing.

---

## 1. Core Concept & "Magic as Code" Paradigm
**Soulfire Mage’s Spellforge** treats sigil crafting as an engineering discipline. Users construct a physical spell (talisman, medallion, coin, desk totem, or wall ornament) by binding **1 to 3 Active Effects**—either selected from a curated taxonomy or typed as freeform natural language prompts.

A **Thaumaturgical Compiler** (powered by a fast LLM + deterministic geometric rules) translates those 1–3 effects into a mathematical **Sigil Genome** composed of mythological and sacred-geometry vector primitives. Users then breed and mutate variations of that genome in an interactive evolutionary grid before extruding the final design into a guaranteed-printable 3D mesh via our existing 3D library.

---

## 2. System Architecture & Functional Pipeline

### Stage 1: The Three-Slot Effect Input
The user defines between **1 and 3 Effects**, mapped to structural layers of the sigil:
1. **Slot 1 — Primary Intent (The Core / Anchor):** Governs the central glyph, primary symmetry order ($C_n$ or $D_n$), and foundational topology (e.g., *Clarity, Ignition, Bulwark*).
2. **Slot 2 — Secondary Modifier (The Vector / Flow):** Governs radial spokes, harmonic waveforms, internal lattices, and directional energy between core and edge (e.g., *Sustained, Reflecting, Piercing, Cycling*).
3. **Slot 3 — Tertiary Binding (The Containment / Grounding):** Governs the outer boundary ring, runic notches, interlocking knots, and structural framing (e.g., *Sealed, Radiating, Grounded*).

### Stage 2: The Thaumaturgical Compiler (Natural Language to Genome)
When the user inputs custom text prompts or selects presets, the LLM acts strictly as a **semantic-to-parameter compiler** (never generating raw raster images). It outputs a structured **Sigil Genome JSON** governed by the **Laws of Sympathetic Geometry**:

| Magical Domain / Intent | Symmetry Group | Geometric & Mythological Primitives | Structural Expression |
| :--- | :--- | :--- | :--- |
| **Warding / Protection / Stasis** | High polygonal ($D_6, D_8$) | Celtic knot borders, Norse *ægishjálmur* shield bars, Bagua octagons | Thick unbroken outer containment rings, inward-facing teeth, overlapping lattice shields |
| **Kinetic / Catalyst / Projection** | Prime / odd ($C_3, C_5, C_7$) | Alchemical fire/sulfur triangles, spear/arrow terminals, Shinto *tomoe* swirls | Asymmetric directional vectors, sharp acute angles, vortex rotational offsets |
| **Focus / Harmony / Wisdom** | Bilateral or Harmonic ($D_2, D_4$) | Sacred geometry (vesica piscis, Metatron lines), Mesopotamian solar discs | Concentric golden-ratio ($\phi$) ring spacing, balanced intersections, deep central well |
| **Entropy / Disruption / Banishing** | Asymmetric or Fractured ($C_1, D_3$) | Cuneiform wedges, jagged lightning-step paths, broken Ouroboros | Split boundary rings (bridged by lower Z-layer bars), high-frequency angular notches |

### Stage 3: The Evolutionary Crucible (Mutation & Breeding Engine)
Once the Compiler produces the initial **Generation 0** genome from the user's 1–3 effects, the system spawns a **3×3 grid of candidate sigils** by applying controlled variance around that seed:
* **Selection:** The user selects **1 or 2 parent sigils** from the grid.
* **Crossover & Mutation:** Clicking **"Mutate Generation"** breeds 9 new children by swapping layer primitives between parents and perturbing numeric genes (rotating inner rings, shifting spoke counts $n \pm 1$, adjusting curve tension, or swapping terminal glyphs) *while respecting the constraints of the 1–3 active effects*.
* **Volatility Slider:** Controls mutation step size from *Harmonic Refinement* (5% parameter drift) to *Wild Surge* (45% drift + primitive substitution).

### Stage 4: Physicality & Printability Constraint Solver
Every mutated 2D vector genome must pass through a deterministic geometric validation step before 3D extrusion:
1. **Connectedness & Island Prevention:** In *Open-Work Stencil Mode* (no solid backplate), all inner rings and floating glyphs must geometrically intersect the radial spoke lattice. If a mutation creates an isolated island, the solver automatically injects a recessed structural bridge (`Z = 1.6mm`) connecting the island's centroid to the nearest anchor ring.
2. **Minimum Wall Clamping:** All stroke weights and boolean gaps clamp to a user-configurable nozzle tolerance (default `1.6mm` minimum wall thickness for 0.4mm FDM nozzles; `0.8mm` for resin).
3. **2D Boolean Pre-Union:** All overlapping vector paths within the same Z-layer must be unioned and cleaned in 2D polygon space *before* extrusion to guarantee watertight, manifold 3D geometry.
4. **Multi-Tier Z-Relief:** To give physical depth and allow easy multi-color filament swaps at layer heights:
   * **Tier 1 (Baseplate / Structural Bridges):** `0.0mm – 1.8mm`
   * **Tier 2 (Containment Rings & Secondary Lattice):** `0.0mm – 3.0mm`
   * **Tier 3 (Primary Core Sigil & High-Relief Terminals):** `0.0mm – 4.0mm`

### Stage 5: Artifact Housing & Export
Users select the physical form factor before exporting via the 3D library:
* **Open-Work Talisman:** Cut-through structural lattice.
* **Embossed Medallion / Coin:** Recessed or raised sigil on a bevelled solid disc or polygon.
* **Hardware Attachments:** Toggleable parametric top bail loop (`4.5mm` ID, `2.5mm` wall) for pendants/keyrings, or a flat bottom plinth for vertical desk totems.
* **Deterministic Seed & Lore Export:** Outputs the `.STL`/`.SVG` alongside a copyable Genome Hash and a brief compiled inscription summarizing the 1–3 bound effects.

---

## 3. UI Layout Requirements (Single-Screen Dense Workbench)
* **Left Column (Compiler & Controls):** 3 Effect Slots (dropdown + freeform text input), "Compile Base Sigil" button, Mutation Volatility slider, and Physical Form Factor / Nozzle Tolerance controls.
* **Center Stage (Dual-Mode Viewport):**
  * *Crucible Tab:* 3×3 interactive SVG/2.5D breeding grid with parent selection toggles and generation counter.
  * *3D Forge Tab:* Interactive 3D mesh inspector showing extruded layer tiers, island-bridge highlights, and attachment previews.
* **Right Column (Lineage & Export):** Generation rollback history, live JSON Genome editor/inspector, compiled spell inscription, and `.STL` / `.SVG` download buttons.

---

## 4. Initial System Prompt Directive for Claude
*(Paste this instruction block alongside your existing 3D framework specifications when starting the coding session)*

> **System Directive:**  
> Act as a Senior Systems Architect and Computational Geometry Designer. Review the Master Requirements Brief above alongside my existing 3D framework specifications. Do not write boilerplate UI code yet. First, design:
> 1. The exact **JSON Schema for the Sigil Genome** (defining rings, radial symmetry, primitive nodes, curve parameters, and Z-tier heights).
> 2. The **System Prompt & JSON Schema** for the LLM 'Thaumaturgical Compiler' that translates 1–3 user text effects into a valid Generation 0 Sigil Genome.
> 3. The **Mutation Function logic** (in TypeScript/JavaScript) that takes 1–2 parent Genomes and a volatility float (`0.05` to `0.50`) and outputs 9 mutated child Genomes while preserving physical printability constraints.