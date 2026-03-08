# Changelog

All notable changes to Algomodo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2026-03-08

### Added

- **MP4 video export (H.264)** — renders animation offscreen at full speed using WebCodecs API + mp4-muxer; auto-stops when animation completes or max duration is reached (8s / 15s / 30s / 45s options)
- **Generator completion signals** — `renderCanvas2D` can now return `true` to signal animation complete; DLA signals done when aggregate reaches boundary; Game of Life signals done after 3 consecutive stable frames (when perturbRate is 0)
- **Stagnation detection** — MP4 exporter samples ~3000 pixels per frame and detects when canvas stops changing for 3 seconds, stopping recording automatically
- **JSON recipe import button** — load recipe files directly from the Export tab alongside the existing Export Recipe button
- **DLA visual improvements** — glow effect, edge highlighting, background styles (solid / gradient / radial), neighbors color mode, depth shading

### Improved

- **Export tab UI redesign** — card-based sections with clear uppercase headers, descriptive helper text, and higher-contrast input fields; GIF and Video export controls separated into distinct sections for clarity; Canvas info merged into Output Settings section
- **Input field styling** — stronger borders, white/dark backgrounds, and focus ring for better visibility in both light and dark themes

---

## [1.5.0] - 2026-03-05

### Added

**New generator families:**

- **Fractals family** — 5 generators: Mandelbrot, Julia Set, Newton Fractal, IFS Barnsley Fern, Recursive Subdivision
- **Text family** — 5 generators: Concrete Poetry, Digital Rain, Typographic Grid, L-System Text, Poem Layout — all with optional custom text input
- **Graphs family** — 4 generators: Tessellations, Low-Poly, Ecosystems, Steiner Networks

**New Image family generators:**

- **Convolution** — kernel-based image filtering
- **Edge Detect** — edge detection algorithms applied to source images
- **Feedback Loop** — recursive self-referential image transformations
- **Glitch Transform** — codec-corruption-inspired visual effects
- **Distance Field** — distance field generation from source image features

**New UI features:**

- **RELOAD button** on canvas — re-renders from scratch with identical settings; replays animations that reached a stop state (e.g., Game of Life ending in still pattern)
- **GIF boomerang loop** — ping-pong playback (forward then backward) repeating forever
- **GIF endless loop** — same clip repeating forever without reversing
- **GIF resolution selector** — 600px, 800px, or 1000px export sizes
- **WebM live recording** — records directly from the canvas stream at native resolution
- **Instructions modal** — user guide accessible from the right panel footer
- Custom text input parameter type for Text generators
- Confirm dialog before deleting presets

### Improved

- GIF encoding: dynamic timeout scaling, multi-worker parallelism (4 workers for large resolutions), coarser sampling for 500K+ pixel GIFs
- GIF duration accuracy: frame delay calculated from actual recording duration instead of fixed FPS assumption
- Islamic Patterns: enhanced girih lines, inner details, additional color and animation modes

---

## [1.4.1] - 2026-03-05

### Added

- **Preset export/import** — Export all presets (or individual presets) as human-readable `.txt` files; import them back with duplicate detection by id
- **JSON recipe import** — Load JSON recipe files via a "Load JSON Recipe" button in the Source Image section to restore generator, seed, params, palette, canvas settings, and PostFX
- **Configurable export filenames** — Separate filename prefix inputs for preset exports (`algomodo-preset-<date>-<time>.txt`) and JSON recipe exports (`algomodo-json-<date>-<time>.json`)
- **Individual preset export** — Each preset card now has an Export button to download that single preset as a text file

### Changed

- Preset file format uses human-readable text (`.txt`) instead of JSON to clearly differentiate from JSON recipe files
- Save preset UI simplified to an always-visible inline input with Save button (no more two-step toggle)

---

## [1.4.0] - 2026-03-04

### Added

**New UI features:**

- **SURPRISE ME button** on the canvas toolbar — randomizes generator, seed, parameters, and colour palette in one click
- **SAVE button** on the canvas — exports static images as 1080×1080 PNG and animations as 1080×1080 WebM video
- **Undo / Redo buttons** in the toolbar — Ctrl+Z / Ctrl+Y with 50-step parameter history
- **Style name overlay** on the canvas showing the active generator name
- **Animation duration selector** in the Export tab — choose 3, 5, or 8 second recording durations

### Changed

**15 generators improved** with new parameters, rendering modes, and algorithm enhancements:

- **Noise / FBM Terrain** — Domain warping now actually applied (was previously ignored); new `style` param (smooth / ridged / terraced) with `terraceLevels` for plateau contour effects
- **Noise / Domain Warped Marble** — Added `veinSharpness` (pow curve for thinner/wider veins) and `turbulence` toggle (abs-value noise for chaotic patterns)
- **Noise / Simplex Field** — Added `style` param (smooth / ridged / turbulent) and `warpAmount` for organic domain distortion
- **Noise / FBM, Turbulence, Ridged Multifractal, Domain Warp** — Algorithm refinements and parameter tuning across all four noise generators
- **Plotter / Hatching** — Algorithm improvements for stroke quality and density
- **Plotter / Stippling** — Enhanced dot placement and density field
- **Plotter / TSP Art** — Improved nearest-neighbour construction and 2-opt refinement
- **Plotter / Guilloché** — Added `curveType` (hypotrochoid / epitrochoid / rose / lissajous), `linesPerRing` (1–6) for moiré weaving, `waveModulation`, and `gradient-sweep` colour mode
- **Plotter / Halftone Dots** — Added `gridType` (square / hex / diamond), `dotShape` (circle / square / diamond / line), `gridAngle` (0–45°), and `animSpeed` with animation support
- **Plotter / Phyllotaxis** — Added `angleOffset` for dramatic spiral arm patterns, `sizeMode` (uniform / grow / shrink / wave), `shape` (circle / petal / star / square), `connectLines`, and `palette-fibonacci` colour mode
- **Plotter / Meander / Maze Fill** — Four maze algorithms (DFS / Kruskal / Binary Tree / Sidewinder), `wallStyle` (straight / rounded / wobbly), `showSolution` BFS path, and `fillCells` distance heatmap
- **Plotter / Scribble Shading** — Added `strokeStyle` (straight / wavy / zigzag / loop), `densityStyle` (fbm / ridged / radial / turbulent), `variableWidth`, and `animSpeed` with animation support
- **Plotter / Bézier Ribbon Weaves** — Added `weavePattern` (basket / twill / satin) with distinct over/under crossing logic, and `ribbonStyle` (flat / shaded / striped) with 3D highlight/shadow rendering
- **Voronoi / Ridges** — Rewrote with spatial hash grid for O(1) nearest-neighbor lookup enabling full-pixel resolution; added `distanceMetric` (euclidean / manhattan / chebyshev) for distinct crystal structures
- **Animation / Plasma Feedback, Geometry / Chladni Figures, Geometry / Superformula, Geometry / Truchet Tiles** — Algorithm improvements and parameter enhancements

### Fixed

- **DLA line-bottom mode** not rendering — `maxRadius` was initialized to 0 instead of `size - 1`, causing the particle growth loop to never execute and walkers to spawn at the wrong end of the grid
- **Age Trails Maze rule** not animating — Maze (B3/S12345) stabilizes into a static state; added stasis detection with automatic cell perturbation to restart CA dynamics
- **Voronoi Ridges** rendering blank/blurred — grid was too fine with too-small search radius causing Infinity values; fixed grid sizing, widened neighbor search to 7×7, and added Infinity guard
- **GIF export** cropping to top-left quarter — `drawImage()` was not scaling the 2160×2160 source canvas to fit the recording canvas dimensions
- **Parameter lock** feature broken — `Set<string>` not serializable by Zustand's localStorage persistence; replaced with `string[]`
- **Gray-Scott model** (Reaction Diffusion) rendering fix
- **Canvas save** on mobile devices — image render compatibility fix

---

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
