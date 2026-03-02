# Changelog

All notable changes to Algomodo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
