# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development server (auto-opens browser at http://localhost:5173)
npm run dev

# Type check only (no emit)
npx tsc --noEmit

# Lint
npm run lint

# Production build (runs tsc -b then vite build → dist/)
npm run build

# Serve production build locally
npm run preview
```

**Deployment:** Automatic via GitHub Actions when PRs are merged to `main`. See [DEPLOYMENT.md](./DEPLOYMENT.md) for workflow details.

**Workflow:**
- Feature branches: Test locally with `npm run dev`
- Create PR to `main`
- When merged, GitHub Actions auto-deploys to https://aalorro.github.io/algomodo
- Only the `main` branch triggers deployments

**Build:**
- Output: `dist/` folder (in .gitignore, never committed)
- Base path: `/algomodo/` for GitHub Pages subpath routing
- Build command runs TypeScript check, minification via Terser, and asset bundling
- `.nojekyll` file disables Jekyll processing on GitHub Pages

## Architecture

**Stack**: React 19 + TypeScript, Zustand (state), Tailwind CSS v4, Vite 7, Canvas2D rendering (no WebGL in active use).

### Data Flow

1. `src/main.tsx` → mounts `<App />`
2. `src/App.tsx` → calls `initializeGenerators()` at module load, renders 3-panel layout
3. `src/generators/index.ts` → `initializeGenerators()` registers all generators with the registry
4. `src/core/registry.ts` → global `Map<string, Generator>` and `Map<string, GeneratorFamily>`; families auto-created on first registration
5. `src/store.ts` → Zustand store (persisted via `localStorage` as `algomodo-store`; `sourceImage` is excluded from persistence due to size)
6. `src/components/CanvasRenderer.tsx` → reads store, calls `generator.renderCanvas2D()` on any state change; runs `requestAnimationFrame` loop when `isAnimating` is true; applies PostFX (`grain`, `vignette`, `dither`, `posterize`) as `ImageData` pixel passes after each static render

### Plugin System — Adding a Generator

Every generator implements the `Generator` interface from `src/types/index.ts`:

- **Required**: `id`, `family`, `styleName`, `definition`, `algorithmNotes`, `parameterSchema`, `defaultParams`, `supportsVector`, `supportsWebGPU`, `supportsAnimation`, `renderWebGL2` (signature exists but currently Canvas2D is used), `estimateCost`
- **Optional**: `renderCanvas2D`, `renderVector`, `renderWebGPU`
- In practice, all current generators implement `renderCanvas2D`; `renderWebGL2` is a no-op stub or shares the Canvas2D path

**Steps to add a new generator**:
1. Create `src/generators/<family>/<name>.ts` implementing the `Generator` interface
2. Import and call `registerGenerator(myGen)` in `src/generators/index.ts`
3. The family is auto-registered if new; to set a custom family name/description, call `registerFamily()` from `src/core/registry.ts`

### Key Modules

| Path | Purpose |
|---|---|
| `src/core/rng.ts` | `SeededRNG` (xorshift128+) and `SimplexNoise` (2D Perlin + FBM) — use for all deterministic randomness |
| `src/core/registry.ts` | Generator and family lookup |
| `src/core/recipe.ts` | JSON save/load for `Recipe` (generatorId + seed + params + palette + canvasSettings + postFX) |
| `src/data/palettes.ts` | `CURATED_PALETTES` array of `Palette` |
| `src/renderers/canvas2d/utils.ts` | Drawing helpers + PostFX pixel operations |
| `src/renderers/svg/builder.ts` | SVG path generation for vector export |
| `src/utils/recorder.ts` | `CanvasRecorder` — GIF recording via `gif.js` |

### Parameter Schema

Parameters use `group` to control UI section grouping. Valid groups: `'Composition' | 'Geometry' | 'Flow/Motion' | 'Texture' | 'Color' | 'PostFX'`.

### Source Image Support

Image generators (`pixel-sort`, `mosaic`, `halftone`) receive the loaded image via `finalParams._sourceImage` (an `HTMLImageElement`). The canvas accepts drop/paste of images or URLs.

### Rendering Architecture Note

Despite `renderWebGL2` being required in the `Generator` interface type, the `CanvasRenderer` component only calls `renderCanvas2D`. The WebGL2 interface exists for future use; implement `renderCanvas2D` for any generator to work.

### Canvas Save vs Export Tab

The canvas SAVE button exports at a fixed 1080×1080 resolution (PNG for static, WebM for animations). The Export tab's GIF/WebM export uses the user-configured dimensions and duration settings (3/5/8 seconds). These are independent code paths in `CanvasRenderer.tsx`.
