import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return [r, g, b];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const s = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

// ---------------------------------------------------------------------------
// Presets — well-known Gray-Scott (f, k) parameter pairs
// ---------------------------------------------------------------------------
const PRESETS: Record<string, { f: number; k: number }> = {
  spots:       { f: 0.035, k: 0.065 },
  stripes:     { f: 0.042, k: 0.059 },
  worms:       { f: 0.058, k: 0.065 },
  maze:        { f: 0.029, k: 0.057 },
  mitosis:     { f: 0.037, k: 0.063 },
  coral:       { f: 0.055, k: 0.062 },
  solitons:    { f: 0.030, k: 0.060 },
  spirals:     { f: 0.020, k: 0.050 },
};

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _rdAnim: {
  key: string;
  U: Float32Array; V: Float32Array;
  nextU: Float32Array; nextV: Float32Array;
  // Spatially-varying f/k fields — fixed from seed, precomputed at init
  fField: Float32Array; kField: Float32Array;
  size: number;
  stepCount: number;
} | null = null;

function rdKey(
  seed: number, size: number,
  f: number, k: number, Du: number, Dv: number,
  sv: number, initMode: string,
): string {
  return `${seed}|${size}|${f.toFixed(4)}|${k.toFixed(4)}|${Du}|${Dv}|${sv.toFixed(2)}|${initMode}`;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
function initRD(
  seed: number, gridSize: number,
  f: number, k: number,
  spatialVariation: number,
  initMode: string,
) {
  const rng   = new SeededRNG(seed);
  const noise = new SimplexNoise(seed + 3);
  const N = gridSize * gridSize;

  const U = new Float32Array(N).fill(1);
  const V = new Float32Array(N).fill(0);
  const fField = new Float32Array(N);
  const kField = new Float32Array(N);

  // Precompute spatially-varying f/k from a smooth noise field.
  // Using 3–4 large-scale "zones" gives the most interesting boundary competition.
  const sv = Math.max(0, spatialVariation);
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const nx = (x / gridSize) * 4;
      const ny = (y / gridSize) * 4;
      const nf = noise.fbm(nx,       ny,       2, 2.0, 0.5); // [-1,1]
      const nk = noise.fbm(nx + 7.3, ny + 2.1, 2, 2.0, 0.5);
      fField[y * gridSize + x] = Math.max(0.003, f * (1 + sv * 0.5 * nf));
      kField[y * gridSize + x] = Math.max(0.003, k * (1 + sv * 0.4 * nk));
    }
  }

  if (initMode === 'noise') {
    // Scatter sparse random V seeds across the whole field
    const rng2 = new SeededRNG(seed + 1);
    for (let i = 0; i < N; i++) {
      if (rng2.random() < 0.015) {
        V[i] = rng2.range(0.4, 1.0);
        U[i] = 1 - V[i];
      }
    }
  } else if (initMode === 'center') {
    // Single circular seed at center
    const r  = (gridSize / 8) | 0;
    const cx = (gridSize / 2) | 0;
    const cy = (gridSize / 2) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          const idx = ((cy + dy + gridSize) % gridSize) * gridSize
                    + ((cx + dx + gridSize) % gridSize);
          U[idx] = 0; V[idx] = 1;
        }
      }
    }
  } else {
    // 'patches': several small circular seeds (default / original behaviour)
    const patchCount = rng.integer(4, 14);
    for (let p = 0; p < patchCount; p++) {
      const cx = rng.integer(0, gridSize - 1);
      const cy = rng.integer(0, gridSize - 1);
      const rad = rng.integer(2, 7);
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy <= rad * rad) {
            const idx = ((cy + dy + gridSize) % gridSize) * gridSize
                      + ((cx + dx + gridSize) % gridSize);
            U[idx] = 0; V[idx] = 1;
          }
        }
      }
    }
  }

  return { U, V, fField, kField };
}

// ---------------------------------------------------------------------------
// Simulation step — 9-point isotropic Laplacian
// Weights: center = −1, cardinal = 0.2, diagonal = 0.05
// (4×0.2 + 4×0.05 = 1.0 ✓ → isotropic to 4th order, no diamond artifacts)
// ---------------------------------------------------------------------------
function stepRD(
  U: Float32Array, V: Float32Array,
  nextU: Float32Array, nextV: Float32Array,
  fField: Float32Array, kField: Float32Array,
  gridSize: number, Du: number, Dv: number,
): void {
  const G = gridSize;
  for (let y = 0; y < G; y++) {
    const yp = ((y + 1) % G) * G;
    const ym = ((y - 1 + G) % G) * G;
    const yc = y * G;
    for (let x = 0; x < G; x++) {
      const idx = yc + x;
      const xp = (x + 1) % G;
      const xm = (x - 1 + G) % G;

      const u = U[idx];
      const v = V[idx];

      // 9-point isotropic Laplacian
      const lapU =
        0.2  * (U[yc + xp] + U[yc + xm] + U[yp + x] + U[ym + x])
        + 0.05 * (U[yp + xp] + U[yp + xm] + U[ym + xp] + U[ym + xm])
        - u;
      const lapV =
        0.2  * (V[yc + xp] + V[yc + xm] + V[yp + x] + V[ym + x])
        + 0.05 * (V[yp + xp] + V[yp + xm] + V[ym + xp] + V[ym + xm])
        - v;

      const f   = fField[idx];
      const k   = kField[idx];
      const uvv = u * v * v;

      nextU[idx] = Math.max(0, Math.min(1, u + Du * lapU - uvv + f * (1 - u)));
      nextV[idx] = Math.max(0, Math.min(1, v + Dv * lapV + uvv - (f + k) * v));
    }
  }
  U.set(nextU);
  V.set(nextV);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
function renderRD(
  ctx: CanvasRenderingContext2D,
  U: Float32Array,
  V: Float32Array,
  gridSize: number,
  params: Record<string, unknown>,
  palette: { colors: string[] },
): void {
  const width  = ctx.canvas.width;
  const height = ctx.canvas.height;
  const img    = ctx.createImageData(width, height);
  const d      = img.data;
  const colors = palette.colors.map(hexToRgb);
  const colorMode = (params.colorMode as string) || 'palette';
  const gamma     = Math.max(0.25, (params.colorGamma as number) ?? 1.0);
  const G = gridSize;

  for (let py = 0; py < height; py++) {
    const gy = Math.min(G - 1, (py / height * G) | 0);
    for (let px = 0; px < width; px++) {
      const gx  = Math.min(G - 1, (px / width * G) | 0);
      const idx = gy * G + gx;
      const u   = U[idx];
      const v   = V[idx];

      let t: number;
      let [r, g, b] = [0, 0, 0] as [number, number, number];

      if (colorMode === 'threshold') {
        t = v > 0.25 ? 1 : 0;
        [r, g, b] = paletteSample(t, colors);

      } else if (colorMode === 'uv-mix') {
        // Color by V value, brightness modulated by U·V (reaction zone intensity)
        // High U·V = active reaction front — picks out the sharpest boundaries
        const reaction = Math.min(1, u * v * 4);
        t = v;
        if (gamma !== 1) t = Math.pow(Math.max(0, t), gamma);
        const [r0, g0, b0] = paletteSample(t, colors);
        const boost = 1 + reaction * 1.2;
        r = Math.min(255, (r0 * boost) | 0);
        g = Math.min(255, (g0 * boost) | 0);
        b = Math.min(255, (b0 * boost) | 0);

      } else if (colorMode === 'edge') {
        // Sample neighbours for gradient magnitude of V — shows reaction fronts
        const gxn = Math.min(G - 1, gx + 1);
        const gxp = Math.max(0, gx - 1);
        const gyn = Math.min(G - 1, gy + 1);
        const gyp = Math.max(0, gy - 1);
        const dvx = V[gy  * G + gxn] - V[gy  * G + gxp];
        const dvy = V[gyn * G + gx]  - V[gyp * G + gx];
        t = Math.min(1, Math.sqrt(dvx * dvx + dvy * dvy) * 4);
        if (gamma !== 1) t = Math.pow(Math.max(0, t), gamma);
        [r, g, b] = paletteSample(t, colors);

      } else {
        // 'palette' (default) — smooth palette gradient over V
        t = v;
        if (gamma !== 1) t = Math.pow(Math.max(0, t), gamma);
        [r, g, b] = paletteSample(t, colors);
      }

      const pi = (py * width + px) * 4;
      d[pi] = r; d[pi + 1] = g; d[pi + 2] = b; d[pi + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  preset: {
    name: 'Preset', type: 'select',
    options: ['custom', 'spots', 'stripes', 'worms', 'maze', 'mitosis', 'coral', 'solitons', 'spirals'],
    default: 'spots',
    help: 'Preset f/k combinations from the Gray-Scott parameter map — overrides Feed Rate and Kill Rate when not "custom"',
    group: 'Composition',
  },
  feedRate: {
    name: 'Feed Rate', type: 'number', min: 0.01, max: 0.08, step: 0.001, default: 0.035,
    help: 'Rate at which U is replenished (active only when preset = custom)',
    group: 'Composition',
  },
  killRate: {
    name: 'Kill Rate', type: 'number', min: 0.04, max: 0.075, step: 0.001, default: 0.065,
    help: 'Rate at which V is removed (active only when preset = custom)',
    group: 'Composition',
  },
  spatialVariation: {
    name: 'Spatial Variation', type: 'number', min: 0, max: 1.0, step: 0.05, default: 0.35,
    help: 'Noise-based spatial modulation of f/k — creates zones with different pattern types that compete at their borders, producing continuously evolving boundaries',
    group: 'Composition',
  },
  initMode: {
    name: 'Init Mode', type: 'select', options: ['patches', 'noise', 'center'], default: 'patches',
    help: 'patches: random circular seeds | noise: sparse scattered seeds across the whole field | center: single circular seed',
    group: 'Geometry',
  },
  diffU: {
    name: 'Diffusion U', type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 0.8,
    group: 'Texture',
  },
  diffV: {
    name: 'Diffusion V', type: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.3,
    group: 'Texture',
  },
  stepsPerFrame: {
    name: 'Steps / Frame', type: 'number', min: 1, max: 30, step: 1, default: 10,
    help: 'Simulation steps per animation frame — higher = faster evolution',
    group: 'Flow/Motion',
  },
  iterations: {
    name: 'Iterations', type: 'number', min: 100, max: 3000, step: 100, default: 800,
    help: 'Steps run for static (non-animated) render',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['palette', 'uv-mix', 'edge', 'threshold'],
    default: 'palette',
    help: 'palette: smooth V→palette | uv-mix: palette + reaction-front brightness boost | edge: gradient magnitude (boundary highlighting) | threshold: binary',
    group: 'Color',
  },
  colorGamma: {
    name: 'Color Gamma', type: 'number', min: 0.25, max: 4.0, step: 0.25, default: 1.0,
    help: '< 1: lifts dark regions (reveals low-concentration detail) | > 1: increases contrast, darkens background',
    group: 'Color',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const reactionDiffusion: Generator = {
  id: 'reaction-diffusion',
  family: 'cellular',
  styleName: 'Reaction Diffusion',
  definition: 'Gray-Scott two-chemical reaction-diffusion system — a continuous PDE that self-organises into spots, stripes, worms, and labyrinthine mazes depending on feed and kill rates',
  algorithmNotes:
    'dU/dt = Du·∇²U − UV² + f(1−U); dV/dt = Dv·∇²V + UV² − (f+k)V. The 9-point isotropic Laplacian (cardinal=0.2, diagonal=0.05, center=−1) eliminates the diamond artifacts of the 4-neighbor stencil, producing fully circular, organic pattern boundaries. Spatial variation precomputes noise-modulated f/k fields from the seed — different regions then develop different pattern types (e.g. spots in one area, worms in another) and compete at their borders, creating perpetually evolving boundary dynamics even after the patterns have settled. Named presets map to well-studied positions in the Gray-Scott parameter space (Pearson 1993, Sims 1994).',
  parameterSchema,
  defaultParams: {
    preset: 'spots', feedRate: 0.035, killRate: 0.065,
    spatialVariation: 0.35, initMode: 'patches',
    diffU: 0.8, diffV: 0.3,
    stepsPerFrame: 10, iterations: 800,
    colorMode: 'palette', colorGamma: 1.0,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width    = ctx.canvas.width;
    const height   = ctx.canvas.height;
    const gridSize = quality === 'draft' ? 100 : quality === 'ultra' ? 320 : 180;

    // Resolve f/k from preset or custom params
    const presetName = (params.preset as string) ?? 'spots';
    const preset     = PRESETS[presetName];
    const f  = preset ? preset.f : (params.feedRate as number) ?? 0.035;
    const k  = preset ? preset.k : (params.killRate as number) ?? 0.065;
    const Du = (params.diffU as number) ?? 0.8;
    const Dv = (params.diffV as number) ?? 0.3;
    const sv = (params.spatialVariation as number) ?? 0.35;
    const im = (params.initMode as string) ?? 'patches';

    // ── Static render ──────────────────────────────────────────────────────
    if (time === 0) {
      clearCanvas(ctx, width, height, '#000000');
      const { U, V, fField, kField } = initRD(seed, gridSize, f, k, sv, im);
      const N     = gridSize * gridSize;
      const nextU = new Float32Array(N);
      const nextV = new Float32Array(N);
      const iters = Math.max(1, (params.iterations as number) | 0);
      for (let i = 0; i < iters; i++) {
        stepRD(U, V, nextU, nextV, fField, kField, gridSize, Du, Dv);
      }
      renderRD(ctx, U, V, gridSize, params, palette);
      return;
    }

    // ── Animation mode ─────────────────────────────────────────────────────
    const key = rdKey(seed, gridSize, f, k, Du, Dv, sv, im);
    if (!_rdAnim || _rdAnim.key !== key) {
      const { U, V, fField, kField } = initRD(seed, gridSize, f, k, sv, im);
      const N = gridSize * gridSize;
      _rdAnim = {
        key, U, V,
        nextU: new Float32Array(N), nextV: new Float32Array(N),
        fField, kField,
        size: gridSize, stepCount: 0,
      };
    }

    const spf = Math.max(1, (params.stepsPerFrame as number | undefined) ?? 10 | 0);
    for (let s = 0; s < spf; s++) {
      stepRD(
        _rdAnim.U, _rdAnim.V,
        _rdAnim.nextU, _rdAnim.nextV,
        _rdAnim.fField, _rdAnim.kField,
        _rdAnim.size, Du, Dv,
      );
      _rdAnim.stepCount++;
    }

    renderRD(ctx, _rdAnim.U, _rdAnim.V, _rdAnim.size, params, palette);
  },

  renderWebGL2(gl) {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return ((params.iterations as number) ?? 800) * 250 | 0;
  },
};
