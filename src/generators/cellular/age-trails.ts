import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Birth/survive bitmasks — bit n is set when the rule fires with n alive neighbours.
// Usage: alive = (survive >> neighbourCount) & 1
const RULE_DEFS: Record<string, { birth: number; survive: number }> = {
  life:     { birth: 1 << 3,                                   survive: (1 << 2) | (1 << 3) },
  highlife: { birth: (1 << 3) | (1 << 6),                     survive: (1 << 2) | (1 << 3) },
  maze:     { birth: 1 << 3,                                   survive: (1<<1)|(1<<2)|(1<<3)|(1<<4)|(1<<5) },
  daynight: { birth: (1<<3)|(1<<6)|(1<<7)|(1<<8),             survive: (1<<3)|(1<<4)|(1<<6)|(1<<7)|(1<<8) },
  seeds:    { birth: 1 << 2,                                   survive: 0 },
};

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _ageAnim: {
  key: string;
  grid: Uint8Array;
  next: Uint8Array;
  acc: Float32Array;
  size: number;
  stasisCount: number;   // consecutive frames with zero changes
  perturbRng: SeededRNG;  // RNG for perturbation injection
} | null = null;

function initState(seed: number, size: number, density: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint8Array(N);
  const acc = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (rng.random() < density) grid[i] = 1;
  }
  return { grid, next: new Uint8Array(N), acc };
}

// Advance the CA by one step (periodic boundaries) and update the accumulation buffer.
// acc[i] = acc[i] * decay  +  (alive ? exposure : 0)
// Returns the number of cells that changed state.
function stepAndAccum(
  grid: Uint8Array, next: Uint8Array, acc: Float32Array, size: number,
  birth: number, survive: number, exposure: number, decay: number,
): number {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          n += grid[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        }
      }
      const was = grid[y * size + x];
      next[y * size + x] = was ? ((survive >> n) & 1) : ((birth >> n) & 1);
    }
  }
  let changed = 0;
  for (let i = 0, N = size * size; i < N; i++) {
    if (grid[i] !== next[i]) changed++;
    grid[i] = next[i];
    acc[i] = acc[i] * decay + (next[i] ? exposure : 0);
  }
  return changed;
}

// Map the float accumulation buffer to pixels using the steady-state maximum as the
// white point, then apply a gamma curve and colour-map to ImageData.
function renderAcc(
  ctx: CanvasRenderingContext2D,
  acc: Float32Array, size: number,
  palette: { colors: string[] }, colorMode: string,
  exposure: number, decay: number, gamma: number,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;
  const colors = palette.colors.map(hexToRgb);

  // A cell permanently alive reaches this steady-state value: exposure / (1 - decay).
  const whitePoint = exposure / Math.max(1e-4, 1 - decay);

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      // Normalise [0, whitePoint] → [0, 1] then apply gamma
      const raw = Math.min(1, acc[cy * size + cx] / whitePoint);
      const t = gamma !== 1 ? Math.pow(raw, gamma) : raw;

      let r: number, g: number, b: number;
      if (colorMode === 'heat') {
        // Black → deep red → orange → yellow → white
        if (t < 0.25) {
          const f = t / 0.25;
          r = (f * 180) | 0; g = 0; b = 0;
        } else if (t < 0.5) {
          const f = (t - 0.25) / 0.25;
          r = (180 + f * 75) | 0; g = (f * 80) | 0; b = 0;
        } else if (t < 0.75) {
          const f = (t - 0.5) / 0.25;
          r = 255; g = (80 + f * 175) | 0; b = 0;
        } else {
          const f = (t - 0.75) / 0.25;
          r = 255; g = 255; b = (f * 255) | 0;
        }
      } else {
        // Palette gradient
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      }

      const x0 = Math.floor(cx * cw), x1 = Math.floor((cx + 1) * cw);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * w + px) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  gridSize: {
    name: 'Grid Size',
    type: 'number', min: 32, max: 256, step: 16, default: 128,
    help: 'Cell grid resolution',
    group: 'Composition',
  },
  density: {
    name: 'Initial Density',
    type: 'number', min: 0.1, max: 0.40, step: 0.05, default: 0.35,
    help: 'Fraction of cells alive at start — above 0.40 the initial density is too high for patterns to emerge',
    group: 'Composition',
  },
  rule: {
    name: 'CA Rule',
    type: 'select',
    options: ['life', 'highlife', 'maze', 'daynight', 'seeds'],
    default: 'life',
    help: 'Life B3/S23 | HighLife B36/S23 (self-replicators) | Maze B3/S12345 | Day & Night B3678/S34678 | Seeds B2/S (explosive, nothing survives)',
    group: 'Composition',
  },
  warmupSteps: {
    name: 'Exposure Frames',
    type: 'number', min: 50, max: 2000, step: 50, default: 400,
    help: 'CA steps blended into the static render — more frames = denser historical record',
    group: 'Composition',
  },
  decay: {
    name: 'Trail Decay',
    type: 'number', min: 0.80, max: 0.999, step: 0.005, default: 0.95,
    help: 'Per-step decay multiplier on accumulated brightness — lower = short crisp trails, higher = long ghostly halos',
    group: 'Flow/Motion',
  },
  exposure: {
    name: 'Exposure',
    type: 'number', min: 0.05, max: 2.0, step: 0.05, default: 0.5,
    help: 'Brightness added per alive-cell frame — raise to saturate stable regions faster',
    group: 'Flow/Motion',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 10, step: 1, default: 1,
    help: 'CA steps advanced per animation frame',
    group: 'Flow/Motion',
  },
  gamma: {
    name: 'Gamma',
    type: 'number', min: 0.3, max: 3.0, step: 0.1, default: 0.7,
    help: 'Tone-map exponent — < 1 lifts dim trails into view, > 1 compresses midtones for starker contrast',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'heat'],
    default: 'palette',
    help: 'palette: map brightness through the active colour ramp | heat: fixed black → red → orange → white heat map',
    group: 'Color',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const ageTrails: Generator = {
  id: 'cellular-age-trails',
  family: 'cellular',
  styleName: 'Age Trails',
  definition:
    'Long-exposure time-lapse of a cellular automaton — each cell accumulates brightness across hundreds of generations, painting a photographic record of the entire evolutionary history',
  algorithmNotes:
    'Runs a 2-state outer-totalistic CA (selectable: Life, HighLife, Maze, Day & Night, or Seeds) under periodic boundary conditions. A floating-point accumulation buffer is updated every step: acc[i] = acc[i] × decay + (alive ? exposure : 0). The buffer is normalised against the steady-state white-point (exposure ÷ (1 − decay)) and tone-mapped with a gamma curve before rendering. Stable structures leave solid saturated marks; oscillators produce soft halos; gliders and wave-fronts leave luminous comet trails. In animation mode the accumulation continues indefinitely, letting new structure emerge over old.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, density: 0.35, rule: 'life', warmupSteps: 400,
    decay: 0.95, exposure: 0.5, stepsPerFrame: 1, gamma: 0.7, colorMode: 'palette',
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size    = Math.max(16, (params.gridSize   ?? 128)  | 0);
    const density = Math.min(0.40, params.density ?? 0.35);
    const ruleKey = params.rule      ?? 'life';
    const { birth, survive } = RULE_DEFS[ruleKey] ?? RULE_DEFS.life;
    const decay    = Math.max(0.5, Math.min(0.999, params.decay    ?? 0.95));
    const exposure = Math.max(0.01, params.exposure ?? 0.5);
    const gamma    = Math.max(0.1,  params.gamma    ?? 0.7);
    const colorMode = params.colorMode ?? 'palette';

    // ── Static render ────────────────────────────────────────────────────────
    if (time === 0) {
      const { grid, next, acc } = initState(seed, size, density);
      const steps = Math.max(1, (params.warmupSteps ?? 400) | 0);
      for (let s = 0; s < steps; s++) {
        stepAndAccum(grid, next, acc, size, birth, survive, exposure, decay);
      }
      renderAcc(ctx, acc, size, palette, colorMode, exposure, decay, gamma);
      return;
    }

    // ── Animation: persistent state ──────────────────────────────────────────
    const key = `${seed}|${size}|${density}|${ruleKey}|${params._renderKey ?? 0}`;
    if (!_ageAnim || _ageAnim.key !== key) {
      const { grid, next, acc } = initState(seed, size, density);
      _ageAnim = { key, grid, next, acc, size, stasisCount: 0, perturbRng: new SeededRNG(seed + 9999) };
    }
    const spf = Math.max(1, (params.stepsPerFrame ?? 1) | 0);
    for (let s = 0; s < spf; s++) {
      const changed = stepAndAccum(_ageAnim.grid, _ageAnim.next, _ageAnim.acc, _ageAnim.size, birth, survive, exposure, decay);
      if (changed === 0) {
        _ageAnim.stasisCount++;
      } else {
        _ageAnim.stasisCount = 0;
      }
      // If CA has been static for 3+ frames, inject perturbation to restart dynamics
      if (_ageAnim.stasisCount >= 3) {
        const N = _ageAnim.size * _ageAnim.size;
        const flipCount = Math.max(4, (N * 0.02) | 0); // flip ~2% of cells
        for (let f = 0; f < flipCount; f++) {
          const idx = (_ageAnim.perturbRng.random() * N) | 0;
          _ageAnim.grid[idx] ^= 1;
        }
        _ageAnim.stasisCount = 0;
      }
    }
    renderAcc(ctx, _ageAnim.acc, _ageAnim.size, palette, colorMode, exposure, decay, gamma);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },

  estimateCost(params) {
    const size  = (params.gridSize   ?? 128) | 0;
    const steps = (params.warmupSteps ?? 400) | 0;
    return (size * size * steps * 0.001) | 0;
  },
};
