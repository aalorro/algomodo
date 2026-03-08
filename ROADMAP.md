# Algomodo Roadmap

A living document of planned enhancements, organized by priority and theme. Current version: **1.6.0**.

---

## Near-Term

### Rendering Performance
- [ ] **WebGL2 rendering backend** — infrastructure and stubs exist (`src/renderers/webgl2/utils.ts`); implement GPU-accelerated rendering for noise, Voronoi, and fractal generators to dramatically reduce render times
- [ ] **WebGPU compute shaders** — detection code ready (`src/renderers/webgpu/utils.ts`); enable massively parallel rendering for generators like Reaction Diffusion, Turing Patterns, and Flow Fields
- [ ] **Activate performance mode** — `performanceMode` flag exists in the store but is unused; wire it to auto-reduce resolution, skip PostFX, and lower FPS during parameter scrubbing for smooth interaction

### Generators
- [ ] **Complete Apollonius Gasket generator** — partially implemented (`geoApolloian`), currently commented out
- [ ] **New families** — Physics simulations (cloth, fluid, n-body), Audio-reactive (frequency spectrum visualization), Tiling (Penrose, Wang tiles, aperiodic monotiles)
- [ ] **More generators per family** — Cellular: Langton's Ant, Wireworld; Fractals: Sierpinski, Dragon Curve, Burning Ship; Geometry: Spirograph stacking, Penrose tiling

### Export & Output
- [ ] **WEBP export** — smaller file size than PNG with near-lossless quality
- [ ] **Batch export** — render N random seeds and save all outputs at once
- [ ] **Export resolution selector** — let users choose output dimensions beyond fixed 1080×1080
- [ ] **GIF optimization** — palette quantization and frame deduplication for smaller file sizes

---

## Mid-Term

### Collaboration & Sharing
- [ ] **Community preset gallery** — browse, share, and download presets from other users
- [ ] **Shareable URL state** — encode seed + generator + params in a URL for one-click sharing
- [ ] **Social image cards** — auto-generate Open Graph preview images for shared links

### User Experience
- [ ] **Parameter keyframing** — define start and end values for parameters to create smooth animated transitions between states
- [ ] **Favourites / pinned generators** — star generators for quick access without scrolling through families
- [ ] **Comparison view** — side-by-side preview of two seeds or parameter sets
- [ ] **Search** — filter generators by name, family, or keyword across all families
- [ ] **Touch gesture controls** — pinch-to-zoom and pan on the canvas for mobile users
- [ ] **Keyboard shortcuts** — hotkeys for common actions (randomize, export, toggle animation, switch generators)

### Rendering & Quality
- [ ] **Anti-aliased rendering** — supersampling or MSAA for smoother edges on geometric generators
- [ ] **HDR / wide-gamut colour** — support Display P3 and Rec.2020 colour spaces for modern displays
- [ ] **PostFX expansion** — bloom, chromatic aberration, film grain with temporal variation, halftone overlay, colour grading LUTs

---

## Long-Term

### Platform
- [ ] **Programmatic API** — JavaScript/TypeScript SDK for headless generation (Node.js + browser), enabling automated pipelines and integrations
- [ ] **Plugin system** — allow third-party generators to be loaded at runtime via a standard interface
- [ ] **PWA offline install** — full Progressive Web App with service worker caching for true offline-first experience
- [ ] **Desktop app** — Electron or Tauri wrapper for native file system access and GPU passthrough

### Advanced Features
- [ ] **Layer compositing** — stack multiple generators with blend modes (multiply, screen, overlay) and per-layer opacity
- [ ] **Mask / region system** — apply different generators to different regions of the canvas using shapes or Voronoi boundaries
- [ ] **Procedural animation timeline** — keyframe-based parameter animation with easing curves, enabling complex choreographed animations
- [ ] **Audio-reactive mode** — drive generator parameters from microphone or audio file frequency data in real time
- [ ] **3D export** — generate height maps or mesh geometry from generators for 3D printing or game assets

### Data & Analytics
- [ ] **Render history gallery** — persistent visual history of all rendered images with metadata
- [ ] **Parameter space explorer** — automated grid search or random sampling to discover interesting parameter regions
- [ ] **Generation statistics** — render time, pixel complexity, entropy metrics per generator

---

## Completed

- [x] MP4 video export with auto-stop on animation completion (v1.6.0)
- [x] Generator completion signals for DLA and Game of Life (v1.6.0)
- [x] Export tab UI redesign (v1.6.0)
- [x] JSON recipe import/export (v1.6.0)
- [x] DLA visual improvements (v1.6.0)
- [x] Fractals, Text, Graphs families (v1.5.0)
- [x] GIF boomerang/endless loop modes (v1.5.0)
- [x] WebM live recording (v1.5.0)
- [x] SURPRISE ME / SAVE / RELOAD canvas buttons (v1.4.0–1.5.0)
- [x] Undo/Redo with 50-step history (v1.4.0)
- [x] Preset export/import (v1.4.1)
- [x] 93 generators across 10 families (v1.0.0–1.5.0)
- [x] PostFX pipeline: grain, vignette, dither, posterize (v1.0.0)
- [x] Dark/light theme (v1.0.0)
