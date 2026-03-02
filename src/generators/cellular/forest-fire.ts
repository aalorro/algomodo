import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

const EMPTY = 0, TREE = 1, BURNING = 2;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _ffAnim: {
  key: string;
  grid: Uint8Array;
  next: Uint8Array;
  rng: SeededRNG;
  size: number;
} | null = null;

function initFF(seed: number, size: number, initDensity: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    grid[i] = rng.random() < initDensity ? TREE : EMPTY;
  }
  return { grid, rng };
}

function stepFF(
  grid: Uint8Array, next: Uint8Array, size: number,
  p: number, f: number, rng: SeededRNG,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const s = grid[i];
      if (s === BURNING) {
        next[i] = EMPTY;
      } else if (s === TREE) {
        const fire =
          (y > 0        && grid[i - size] === BURNING) ||
          (y < size - 1 && grid[i + size] === BURNING) ||
          (x > 0        && grid[i - 1]    === BURNING) ||
          (x < size - 1 && grid[i + 1]    === BURNING);
        next[i] = fire || rng.random() < f ? BURNING : TREE;
      } else {
        next[i] = rng.random() < p ? TREE : EMPTY;
      }
    }
  }
  grid.set(next);
}

function renderFF(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array, size: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cE: [number, number, number] = colorMode === 'palette' ? colors[0]                          : [12, 14, 12];
  const cT: [number, number, number] = colorMode === 'palette' ? colors[(colors.length / 2) | 0]   : [38, 150, 38];
  const cB: [number, number, number] = colorMode === 'palette' ? colors[colors.length - 1]         : [220, 72, 12];

  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const st = grid[cy * size + cx];
      const [r, g, b] = st === BURNING ? cB : st === TREE ? cT : cE;
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
  initialDensity: {
    name: 'Initial Tree Density',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.7,
    group: 'Composition',
  },
  growthProb: {
    name: 'Growth Rate (p)',
    type: 'number', min: 0.001, max: 0.05, step: 0.001, default: 0.01,
    help: 'Probability an empty cell grows a tree each step',
    group: 'Texture',
  },
  lightningProb: {
    name: 'Lightning Rate (f)',
    type: 'number', min: 0.0001, max: 0.003, step: 0.0001, default: 0.0005,
    help: 'Probability a tree spontaneously ignites each step',
    group: 'Texture',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 10, step: 1, default: 3,
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['classic', 'palette'],
    default: 'classic',
    help: 'classic: dark / forest-green / orange-red | palette: first / mid / last palette colours',
    group: 'Color',
  },
};

export const forestFire: Generator = {
  id: 'cellular-forest-fire',
  family: 'cellular',
  styleName: 'Forest Fire',
  definition: 'Drossel-Schwabl three-state cellular automaton exhibiting self-organised criticality through recursive growth and fire cycles',
  algorithmNotes:
    'Cells cycle: burning → empty (probability 1), empty → tree (probability p), tree → burning if a neighbour is burning or by spontaneous lightning (probability f). When f ≪ p the system self-organises to a critical state where fire-cluster sizes follow a power-law distribution — analogous to sand avalanches and earthquakes.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, initialDensity: 0.7,
    growthProb: 0.01, lightningProb: 0.0005,
    stepsPerFrame: 3, colorMode: 'classic',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const p = params.growthProb ?? 0.01;
    const f = params.lightningProb ?? 0.0005;
    const colorMode = params.colorMode || 'classic';
    const initDensity = params.initialDensity ?? 0.7;

    if (time === 0) {
      const { grid, rng } = initFF(seed, size, initDensity);
      const next = new Uint8Array(size * size);
      for (let s = 0; s < 500; s++) stepFF(grid, next, size, p, f, rng);
      renderFF(ctx, grid, size, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}`;
    if (!_ffAnim || _ffAnim.key !== key) {
      const { grid, rng } = initFF(seed, size, initDensity);
      _ffAnim = { key, grid, next: new Uint8Array(size * size), rng, size };
    }
    const steps = Math.max(1, (params.stepsPerFrame ?? 3) | 0);
    for (let s = 0; s < steps; s++) stepFF(_ffAnim.grid, _ffAnim.next, _ffAnim.size, p, f, _ffAnim.rng);
    renderFF(ctx, _ffAnim.grid, _ffAnim.size, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0.05, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.stepsPerFrame ?? 3) * 0.001) | 0; },
};
