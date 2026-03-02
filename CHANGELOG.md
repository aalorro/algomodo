# Changelog

All notable changes to Algomodo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
