# Changelog

All notable changes to Algomodo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-03

### Changed

**6 existing generators improved** with new parameters, colour modes, and algorithm enhancements:

- **Cellular / Game of Life** — Added 5 additional rule sets (HighLife B36/S23, Day & Night B3678/S34678, Seeds B2/S, Maze B3/S12345, Morley B368/S245) encoded as bitmasks; `perturbRate` parameter randomly flips a fraction of cells each frame to prevent stagnation; new `entropy` colour mode maps the 8-neighbour ON count to the palette gradient regardless of cell state, revealing activity gradients as continuous colour fields
- **Geometry / Spirograph** — Added `mode` parameter (hypotrochoid / epitrochoid) for rolling-circle-outside curves producing rose petals and limaçons; `colorMode` (solid / gradient) with per-segment lerpColor sweep; auto-scaling so curves always fit the canvas regardless of R, r, d values; fixed layer distribution — layers are now evenly fanned by rotation angle rather than stacked identically
- **Geometry / Lissajous & Harmonographs** — Added `decay` parameter (harmonograph damping via `exp(−δt)`) that transforms the closed figure into an inward-spiraling harmonograph; `layers` parameter adds phase-offset overlapping curves; proper period calculation using `2π / gcd(fx, fy)` instead of fixed `2π`; gradient alpha fades with amplitude for harmonograph depth effect
- **Geometry / L-System** — Replaced duplicate Fern preset with three new presets (Plant, Koch snowflake, Gosper flowsnake) for a total of 7 distinct presets; `stochastic` parameter adds seeded random angle jitter on each turn for organic variation; `taper` parameter scales line width by `(1 − depth/maxDepth)^0.7` giving trunk-to-tip thickness; `colorMode` (depth / gradient / single) replaces boolean `colorize`
- **Geometry / MST Web** — Added `prunePercent` parameter (0–70 %) removes the longest edges from the MST, fragmenting the spanning tree into organic subtree clusters; `fibonacci` distribution option uses phyllotaxis golden-angle spiral for the most spatially uniform point layout; new `radial` colour mode maps edge midpoint distance from canvas centre to the palette gradient, revealing concentric ring structure; fixed node radius (was drawing circles at `nodeSize` diameter, now correctly uses `nodeSize / 2`)
- **Cellular / Brian's Brain** — Stabilised: hardened `initialDensity` cap at 0.20 and default to 0.15 to prevent empty-canvas renders at high densities; simplified to pure 3-state classic logic (ON → DYING → OFF → ON if exactly 2 Moore neighbours) removing previously broken experimental parameters

---

## [1.1.0] - 2026-03-02

### Added

**14 new generators** (total now 74 across 7 families):

- **Cellular** — Age Trails: floating-point exposure accumulator over configurable CA rules (Life / HighLife / Maze / Day & Night / Seeds) producing luminous long-exposure trail photographs
- **Cellular** — Turing Patterns: Schnakenberg activator-inhibitor PDE producing self-organising spots and labyrinthine stripes
- **Cellular** — Crystal Growth: Kobayashi (1993) anisotropic phase-field solidification with tunable n-fold symmetry and undercooling
- **Noise** — Simplex Field: raw single-layer or low-octave simplex noise with drift/rotate animation
- **Noise** — FBM: full fractal Brownian Motion with lacunarity and gain controls; pulse animation
- **Noise** — Turbulence: absolute-value fractal noise with per-octave churn animation and heat colormap
- **Noise** — Ridged Multifractal: Ken Musgrave's cascaded ridge formula; sculpt animation oscillates ridge sharpness
- **Noise** — Domain Warp: two independent noise instances with single/double-iterated coordinate displacement; flow animation
- **Geometry** — Rosettes: polar rose curves r = cos(n/d · θ) with multi-layer staggered ratios; spin/bloom/morph animation
- **Geometry** — Superformula: Gielis generalised polar curve morphing through every polygon and organic shape; morph animation
- **Geometry** — Moiré: two overlapping periodic gratings (lines/circles/dots/radial) producing interference fringe bands
- **Geometry** — Islamic Patterns: star polygon tilings {n/k} on square/hexagonal/triangular grids with fill and spin/kaleidoscope animation
- **Geometry** — Truchet Tiles: classic quarter-circle arc, diagonal, and wedge tile variants with wave animation that sweeps flipping boundaries across the canvas
- **Plotter** — Contour Lines: filled elevation-band topographic map with palette-coloured bands and optional contour outlines; distinct from the existing line-only Topographic Contours

**Animation support added** to all 5 new Noise generators and both original Noise generators (FBM Terrain, Domain Warped Marble) — all now have `supportsAnimation: true` with mode and speed controls.

### Changed

- **Params toolbar**: Reset button replaced with an Animate toggle button — green when animation is on, grey when off, disabled for generators that don't support animation. Syncs with the Animate checkbox in Settings.

---

## [1.0.0] - 2026-03-02

### Added
- Initial release of Algomodo
- Generator families: Cellular Automata, Noise, Geometry, Image Processing, Animation, Plotter, and Voronoi
- 50+ algorithmic art generators
- Deterministic seeded randomness with xorshift128+ RNG
- Beautiful 3-panel UI with generator browser, parameter controls, and canvas preview
- Seed locking for reproducible results
- 5-color palette customization with curated palette presets
- Canvas settings (resolution, background color, transparency, DPR, quality levels)
- Post-effects (grain, vignette, dither, posterize, outline)
- SVG vector export support for selected generators
- GIF animation recording with configurable FPS
- Preset saving and loading system
- Undo/redo with 50-step history
- Dark mode support
- Fully offline, works entirely in browser
- localStorage persistence for settings and presets
- Responsive design with keyboard shortcuts (Ctrl+Z/Ctrl+Y for undo/redo)
- About page with app information
- Privacy notice explaining offline-only operation
- Open source under MIT license

### Technical Features
- Built with React 19 + TypeScript
- State management with Zustand
- Canvas2D rendering with PostFX pipeline
- SVG export via builder utilities
- Web Worker support for GIF encoding
- Responsive UI built with Tailwind CSS v4
- Vite 7 for fast builds
- ESLint configuration for code quality

## [Unreleased]

### Planned
- WebGL2 rendering optimization
- WebGPU support for next-gen graphics
- More advanced image processing generators
- Extended animation capabilities
- Community preset sharing
- API for programmatic generator access
