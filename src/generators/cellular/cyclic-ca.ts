import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _cyclicAnim: {
  key: string;
  grid: Uint8Array;
  next: Uint8Array;
  size: number;
  K: number;
} | null = null;

function initCyclic(seed: number, size: number, K: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint8Array(N);
  for (let i = 0; i < N; i++) grid[i] = rng.integer(0, K - 1);
  return { grid, next: new Uint8Array(N) };
}

// One step of Cyclic CA.
// A cell at state s advances to (s+1)%K if it has ≥ threshold neighbours at (s+1)%K.
function stepCyclic(
  grid: Uint8Array, next: Uint8Array,
  size: number, K: number, threshold: number, moore: boolean,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = grid[y * size + x];
      const target = (s + 1) % K;
      let count = 0;

      if (moore) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ny = ((y + dy) + size) % size;
            const nx = ((x + dx) + size) % size;
            if (grid[ny * size + nx] === target) count++;
          }
        }
      } else {
        // Von Neumann (4-connected)
        if (grid[((y - 1 + size) % size) * size + x] === target) count++;
        if (grid[((y + 1) % size) * size + x]         === target) count++;
        if (grid[y * size + (x - 1 + size) % size]    === target) count++;
        if (grid[y * size + (x + 1) % size]            === target) count++;
      }

      next[y * size + x] = count >= threshold ? target : s;
    }
  }
  grid.set(next);
}

function renderCyclic(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array, size: number, K: number,
  palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const s = grid[cy * size + cx];
      // Map state 0..K-1 to palette
      const t = K > 1 ? s / (K - 1) : 0;
      const scaled = t * (colors.length - 1);
      const i0 = Math.floor(scaled);
      const i1 = Math.min(colors.length - 1, i0 + 1);
      const frac = scaled - i0;
      const r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
      const g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
      const b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;

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
    group: 'Composition',
  },
  states: {
    name: 'States (K)',
    type: 'number', min: 3, max: 16, step: 1, default: 8,
    help: 'Number of distinct cell states — higher K makes larger, slower spirals',
    group: 'Composition',
  },
  threshold: {
    name: 'Threshold',
    type: 'number', min: 1, max: 4, step: 1, default: 2,
    help: 'Minimum neighbours in the successor state required for a cell to advance — threshold 1 → waves, 2 → spirals',
    group: 'Texture',
  },
  neighborhood: {
    name: 'Neighbourhood',
    type: 'select',
    options: ['moore', 'vonneumann'],
    default: 'moore',
    help: 'moore: 8 neighbours | vonneumann: 4 neighbours (up/down/left/right)',
    group: 'Geometry',
  },
  warmupSteps: {
    name: 'Warmup Steps',
    type: 'number', min: 0, max: 500, step: 10, default: 100,
    help: 'Steps computed before the static render is shown',
    group: 'Composition',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 10, step: 1, default: 2,
    group: 'Flow/Motion',
  },
};

export const cyclicCA: Generator = {
  id: 'cellular-cyclic-ca',
  family: 'cellular',
  styleName: 'Cyclic CA',
  definition: 'K-state cyclic cellular automaton — cells advance through a colour wheel when enough neighbours are ahead of them, spontaneously self-organising into counter-rotating spirals and phase waves',
  algorithmNotes:
    'Each cell holds a state s ∈ {0, …, K−1}. At each step a cell advances to (s+1)%K if at least threshold neighbours are already at (s+1)%K; otherwise it stays at s. From a random initial condition the system self-organises into rotating spiral waves that are analogous to the Belousov-Zhabotinsky chemical oscillator. Threshold 1 produces fast propagating waves; threshold 2 produces stable multi-armed spirals.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, states: 8, threshold: 2,
    neighborhood: 'moore', warmupSteps: 100, stepsPerFrame: 2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const K = Math.max(3, Math.min(16, (params.states ?? 8) | 0));
    const threshold = Math.max(1, (params.threshold ?? 2) | 0);
    const moore = (params.neighborhood ?? 'moore') !== 'vonneumann';

    if (time === 0) {
      const { grid, next } = initCyclic(seed, size, K);
      const warmup = Math.max(0, (params.warmupSteps ?? 100) | 0);
      for (let s = 0; s < warmup; s++) stepCyclic(grid, next, size, K, threshold, moore);
      renderCyclic(ctx, grid, size, K, palette);
      return;
    }

    const key = `${seed}|${size}|${K}|${params._renderKey ?? 0}`;
    if (!_cyclicAnim || _cyclicAnim.key !== key) {
      const { grid, next } = initCyclic(seed, size, K);
      _cyclicAnim = { key, grid, next, size, K };
    }
    const spf = Math.max(1, (params.stepsPerFrame ?? 2) | 0);
    for (let s = 0; s < spf; s++) stepCyclic(_cyclicAnim.grid, _cyclicAnim.next, _cyclicAnim.size, _cyclicAnim.K, threshold, moore);
    renderCyclic(ctx, _cyclicAnim.grid, _cyclicAnim.size, _cyclicAnim.K, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.stepsPerFrame ?? 2) * 0.002) | 0; },
};
