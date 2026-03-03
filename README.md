# Algomodo

An open-source generative art studio that runs entirely in the browser. Pick an algorithm, tweak parameters, and export — no install, no account, no cloud.

MIT License · v1.2.0 · © 2026 ArtMondo

---

## Features

| Feature | Details |
|---|---|
| **73 generators** | Across 7 families: Cellular, Geometry, Noise, Plotter, Voronoi, Animation, Image |
| **Live animation** | requestAnimationFrame loop with persistent simulation state; per-generator steps/frame control |
| **Seeded RNG** | xorshift128+ — every output is fully reproducible from its integer seed |
| **Curated palettes** | Switchable colour palettes applied consistently across all generators |
| **PostFX pipeline** | Grain, vignette, ordered dither, and posterize as post-render ImageData pixel passes |
| **Image input** | Drop or paste any image (JPEG / PNG / URL) to activate the Image family generators |
| **Recipe save / load** | Export or import a compact JSON snapshot: generator + seed + params + palette + PostFX |
| **GIF export** | Record and download animated GIFs via gif.js |
| **Undo / Redo** | Full parameter history — Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) |
| **Dark & light theme** | Togglable; persisted to localStorage |
| **Quality modes** | Draft / Normal / Ultra — scale grid resolution for simulation generators |
| **FPS counter** | Overlay toggle for animation performance monitoring |

---

## Generators

### Cellular (14)

Simulation-based automata and physics models. All support live animation with persistent state between frames.

| Name | Key Feature |
|---|---|
| **Game of Life** | Six rule sets (Conway / HighLife / Day & Night / Seeds / Maze / Morley) as bitmasks; perturbation rate to prevent stagnation; entropy colour mode maps neighbourhood density to the palette gradient |
| **Reaction Diffusion** | Gray-Scott model (dU/dt = Du·∇²U − UV² + f·(1−U)); tunable feed/kill rates produce spots, stripes, and mazes |
| **Forest Fire** | Drossel-Schwabl 3-state CA (empty / tree / burning) — self-organised criticality when lightning rate ≪ growth rate |
| **Eden Growth** | Random frontier growth (Eden Model A) — compact organic blobs coloured by birth order, revealing concentric growth rings |
| **Percolation** | BFS cluster labeling; animation sweeps occupancy p through the critical threshold pc ≈ 0.593 to show the phase transition live |
| **Sandpile** | Abelian BTW model — grains topple outward from centre producing a self-similar fractal with exact four-fold symmetry |
| **Fluid Lite** | Seeded point-vortex velocity field advects a passive dye density on a periodic grid; no PDE solver required |
| **Cyclic CA** | K-state cyclic automaton — cells advance through a colour wheel when enough neighbours are ahead, self-organising into counter-rotating spirals and phase waves |
| **Brian's Brain** | 3-state excitable automaton (ON → DYING → OFF → ON if 2 neighbours firing) — no still lifes, only perpetually moving gliders |
| **Age Trails** | Floating-point exposure accumulation over multiple CA rules — creates luminous long-exposure trail photographs of automaton activity |
| **Turing Patterns** | Schnakenberg activator-inhibitor reaction-diffusion (du/dt = Du·∇²u + γ(a−u+u²v)) — self-organising spots and labyrinthine stripes |
| **Crystal Growth** | Kobayashi (1993) anisotropic phase-field solidification — simulates dendritic crystal growth with tunable symmetry (3/4/6/8-fold) and undercooling |
| **DLA** | Diffusion-Limited Aggregation — random walkers freeze on contact with a growing cluster, producing fractal trees of Hausdorff dimension ≈ 1.71 |
| **Elementary CA** | Wolfram's 1D automata shown as a scrolling spacetime diagram — Rule 30 (chaotic), 90 (Sierpiński), 110 (Turing-complete), and all 256 rules selectable |

### Noise (7)

Procedural terrain and surface textures driven by fractal noise algorithms. All support live animation.

| Name | Key Feature |
|---|---|
| **FBM Terrain** | Natural terrain from stacked octaves of Simplex noise with optional domain warping and palette-mapped elevation bands |
| **Domain Warped Marble** | Layered domain warping of FBM creates organic marble veining and turbulent flow structures |
| **Simplex Field** | Raw single-layer or low-octave Simplex noise — the baseline of all procedural generation; drift or rotate animation |
| **FBM** | Full fractal Brownian Motion with explicit lacunarity and gain controls; pulse animation breathes the scale |
| **Turbulence** | Absolute-value noise per octave folds the field into sharp V-shaped creases — fire, plasma, and cloud textures; churn animation drifts each octave independently |
| **Ridged Multifractal** | Ken Musgrave's cascaded ridge formula: max(0, offset−\|noise\|)² with amplitude cascade produces knife-edge mountain ridges; sculpt animation oscillates ridge sharpness |
| **Domain Warp** | Two independent noise instances — coordinates displaced by one fBm field before evaluating another; single or double-iterated warp; flow animation morphs the warp field phase |

### Geometry (10)

Mathematical curves and tiling structures rendered as line art.

| Name | Key Feature |
|---|---|
| **Spirograph** | Hypotrochoid and epitrochoid curves; auto-scaling, layered rotation fan, solid and gradient colour modes |
| **Lissajous & Harmonographs** | Lissajous figures and inward-spiraling harmonographs via exponential decay; multi-layer phase-offset overlapping curves |
| **L-System** | Lindenmayer string rewriting — 7 presets (Tree, Plant, Dragon, Sierpinski, Hilbert, Koch, Gosper); stochastic angle jitter; tapered branch widths; depth/gradient/single colour modes |
| **MST Web** | Prim's MST over a point field; edge pruning creates organic subtree clusters; fibonacci phyllotaxis distribution; radial colour mode reveals concentric ring structure |
| **Chladni Figures** | Resonance nodal lines of a vibrating square plate; mode numbers (m, n) select distinct symmetry patterns |
| **Rosettes** | Polar rose curves r = cos(n/d · θ) — rational k = n/d controls petal count and winding; layered with staggered ratios for mandala-like interference patterns |
| **Superformula** | Johan Gielis' generalised polar equation r = (\|cos(mθ/4)/a\|^n2 + \|sin(mθ/4)/b\|^n3)^(−1/n1) — morphs continuously through every polygon, star, and organic shape |
| **Moiré** | Two overlapping periodic gratings (lines / circles / dots / radial) at a small relative angle or offset — the beating between gratings generates macroscopic fringe bands |
| **Islamic Patterns** | Star polygon tilings {n/k} arrayed on square, hexagonal, or triangular grids — inspired by classical Islamic geometric art with interlocking girih-style bands |
| **Truchet Tiles** | Each cell randomly assigned one of two orientations — quarter-circle arcs (classic Truchet 1704), diagonal lines (Smith 1987), or filled wedges; wave animation sweeps flipping boundaries across the canvas |

### Plotter (14)

Pen-plotter-inspired vector-style generators optimised for line art and print output.

| Name | Key Feature |
|---|---|
| **Stippling** | Density-adaptive dot placement driven by a noise field; variable dot size and per-dot palette colour mapping |
| **Hatching** | Parallel, contour-following, or scribble engraving lines with per-segment hand-drawn Simplex wobble |
| **Topographic Contours** | Marching Squares iso-contours extracted from an FBM height field — clean topographic map line art with hand-drawn wobble |
| **Contour Lines** | Filled elevation-band topographic map — noise field (fBm / ridged / turbulence) quantised into palette-coloured bands with optional contour outlines; visually distinct from line-only Topographic Contours |
| **Streamlines** | Evenly-spaced streamlines traced through a smooth 2D noise-derived vector field |
| **TSP Art** | Single Hamiltonian tour through density-weighted stipple points via nearest-neighbour construction + 2-opt refinement |
| **Circle Packing** | Non-overlapping circles grown to maximum radius, biased by a noise density field |
| **Offset Paths** | Concentric iso-distance rings around randomly placed seed shapes via a signed-distance field |
| **Guilloché** | Concentric hypotrochoid rings producing the interference moiré pattern of banknote security print |
| **Halftone Dots** | Regular dot grid with radii modulated by a noise density field — vector-plotter halftone |
| **Phyllotaxis** | Sunflower spiral: dots placed at successive golden-angle increments with radius growing as √i |
| **Meander / Maze Fill** | Space-filling paths via recursive-backtracker maze DFS or serpentine Greek-key meander; BFS distance colouring |
| **Scribble Shading** | Multi-pass directional hatching with FBM noise wobble — emulates organic pen-plotter scribble fill |
| **Bézier Ribbon Weaves** | Horizontal and vertical Bézier ribbon strands woven over/under in an alternating basket-weave; animated wave oscillation |

### Voronoi (11)

Voronoi and Delaunay-based spatial partitioning with diverse rendering treatments.

| Name | Key Feature |
|---|---|
| **Voronoi Cells** | Classic nearest-seed Voronoi regions with palette fill and adjustable seed count / jitter |
| **Crackle** | f₂−f₁ Voronoi distance gap rendered as cracked ceramic or dried-mud texture |
| **Ridges** | Multi-octave Voronoi f₂−f₁ noise stacked to produce mountain-ridge terrain profiles |
| **Voronoi Mosaic** | Each Voronoi cell rendered as a coloured tile with grout lines and optional bevel shading |
| **Delaunay Triangulation** | Delaunay triangulation of seed points with per-triangle palette colour fill |
| **Centroidal Voronoi** | Lloyd relaxation iterates seeds toward cell centroids, converging to near-hexagonal regular tiling |
| **Contour Bands** | Concentric topographic rings drawn around each seed via the nearest-distance field |
| **Fractured** | Two-scale Voronoi fracture simulating shattered glass or stone with directional per-shard shading |
| **3D-ish** | Per-cell random surface normals shaded with Phong diffuse + specular for a 3D foam aesthetic |
| **Weighted Voronoi** | Random per-site weights distort region sizes, producing irregular organic cells |
| **Neighbor Bands** | Pixels coloured by Voronoi boundary hop-count from the nearest seed — concentric ring patterns across the diagram |

### Animation (8)

Real-time animated generators with continuous frame-by-frame evolution.

| Name | Key Feature |
|---|---|
| **Orbital Mechanics** | Multiple bodies in nested circular orbits with palette-mapped persistent trails |
| **Flowing Particles** | Particles advected through a time-varying Simplex noise vector field |
| **Flow Field Ink** | Ink-style particles leave persistent canvas trails as they drift through a noise flow field |
| **Attractor Trails** | Clifford, De Jong, and Bedhead strange attractors; optional parameter drift animates chaotic morphing between forms |
| **Curl Fluid** | Particles driven by the curl (divergence-free component) of a Perlin noise field — smooth fluid swirling motion |
| **Plasma Feedback** | Layered noise fields warped into themselves — glowing plasma and lava-lamp feedback loop aesthetics |
| **Kaleidoscope** | Noise or palette texture reflected through N-fold radial symmetry with continuous rotation |
| **Wave Interference** | Multiple point wave-sources summed and colour-mapped — evolving moiré ripple patterns |

### Image (9)

Generative transformations applied to a user-supplied source image. Drop or paste any image onto the canvas to activate this family.

| Name | Key Feature |
|---|---|
| **Pixel Sort** | Column or row sort by luminance, hue, or saturation — streaked glitch aesthetic with threshold and segment controls |
| **Mosaic** | Grid pixelation with optional palette colour quantisation per tile |
| **Halftone** | Brightness-modulated dot grid simulating classic print halftone screens |
| **Data Mosh** | Codec-corruption aesthetics via macro-block scrambling, RGB channel offset, and scan-line displacement |
| **Luma Mesh** | Low-poly Delaunay mesh where each triangle face is coloured by source pixel luminance |
| **Optical Flow** | Image brightness gradient visualised as a directed vector flow field of line segments |
| **Lino Cut** | Two-tone linocut / woodblock print via luminance thresholding and edge detection |
| **Dither** | Floyd-Steinberg and ordered dithering snapping colours to the active palette |
| **ASCII Art** | Source image rendered as a grid of ASCII or Unicode block characters scaled by local luminance |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build tool | Vite 7 |
| State management | Zustand (persisted to localStorage) |
| Styling | Tailwind CSS v4 |
| Rendering | Canvas 2D — ImageData pixel ops for grid generators, path drawing for vector styles |
| Randomness | xorshift128+ `SeededRNG` + 2D Simplex noise / FBM from `src/core/rng.ts` |
| GIF recording | gif.js via `src/utils/recorder.ts` |

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server (opens http://localhost:5173)
npm run dev

# Type check (no emit)
npx tsc --noEmit

# Lint
npm run lint

# Production build → dist/
npm run build

# Preview production build locally
npm run preview
```

---

## Deployment

Algomodo uses a **Pull Request workflow** with automatic deployment from the `main` branch.

**Development Flow:**
1. Create a feature branch: `git checkout -b feature/my-feature`
2. Test locally: `npm run dev` (runs on http://localhost:5173/algomodo/)
3. Push your branch and create a **Pull Request** to `main`
4. Once merged to `main`, GitHub Actions automatically builds and deploys to GitHub Pages
5. Site is live at: **https://aalorro.github.io/algomodo**

For detailed deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Adding a Generator

1. Create `src/generators/<family>/<name>.ts` implementing the `Generator` interface from `src/types/index.ts`
2. Implement `renderCanvas2D(ctx, params, seed, palette, quality, time?)` — `time > 0` signals animation mode
3. For animated generators, store simulation state at module level (`let _state: ... | null = null`) keyed by seed + params
4. Import and call `registerGenerator(myGen)` in `src/generators/index.ts`
5. The generator family is auto-created on first registration; for a custom display name call `registerFamily()` from `src/core/registry.ts`

**Parameter groups** control which UI accordion section a control appears in:
`Composition` · `Geometry` · `Flow/Motion` · `Texture` · `Color` · `PostFX`

---

## License

MIT © 2026 ArtMondo. Algomodo is open-source software.
