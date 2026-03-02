import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TOPPLE_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _sandAnim: {
  key: string;
  grains: Int32Array;
  toppleCount: Uint32Array;
  size: number;
  totalDropped: number;
} | null = null;

function initSandpile(size: number) {
  const N = size * size;
  return {
    grains: new Int32Array(N),
    toppleCount: new Uint32Array(N),
  };
}

// Add `amount` grains at center and topple to stability.
// Returns number of topples performed (capped at maxTopples).
function addAndTopple(
  grains: Int32Array, toppleCount: Uint32Array,
  size: number, cx: number, cy: number,
  amount: number, maxTopples: number,
  rng: SeededRNG | null, spreadRandom: boolean,
): number {
  // Drop grains at a point (or randomly spread if spreadRandom)
  for (let g = 0; g < amount; g++) {
    let dx = cx, dy = cy;
    if (spreadRandom && rng) {
      dx = rng.integer(0, size - 1);
      dy = rng.integer(0, size - 1);
    }
    grains[dy * size + dx]++;
  }

  // Topple via stack (non-recursive)
  const stack: number[] = [];
  const N = size * size;
  // Seed stack with any already-unstable cells
  for (let i = 0; i < N; i++) {
    if (grains[i] >= TOPPLE_THRESHOLD) stack.push(i);
  }

  let topples = 0;
  while (stack.length > 0 && topples < maxTopples) {
    const i = stack.pop()!;
    if (grains[i] < TOPPLE_THRESHOLD) continue;
    const x = i % size, y = (i / size) | 0;
    const fall = (grains[i] / TOPPLE_THRESHOLD) | 0;
    grains[i] -= fall * TOPPLE_THRESHOLD;
    toppleCount[i] += fall;
    topples += fall;

    const nbrs = [
      y > 0        ? (y - 1) * size + x : -1,
      y < size - 1 ? (y + 1) * size + x : -1,
      x > 0        ? y * size + (x - 1) : -1,
      x < size - 1 ? y * size + (x + 1) : -1,
    ];
    for (const ni of nbrs) {
      if (ni < 0) continue; // grains lost off edge
      grains[ni] += fall;
      if (grains[ni] >= TOPPLE_THRESHOLD) stack.push(ni);
    }
  }
  return topples;
}

function renderSandpile(
  ctx: CanvasRenderingContext2D,
  grains: Int32Array, toppleCount: Uint32Array,
  size: number, maxTopple: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;
  const logMax = maxTopple > 1 ? Math.log(maxTopple) : 1;

  // Fixed colors for grain-count mode (0–3 grains)
  const grainColors: [number, number, number][] = [
    [10, 10, 14],   // 0
    colors[0] || [60, 30, 120],
    colors[Math.floor(colors.length / 2)] || [180, 90, 20],
    colors[colors.length - 1] || [240, 230, 80],
  ];

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      let r: number, g: number, b: number;

      if (colorMode === 'topple-count') {
        const tc = toppleCount[idx];
        if (tc === 0) {
          r = 10; g = 10; b = 14;
        } else {
          const t = Math.log(tc) / logMax;
          const scaled = Math.min(1, t) * (colors.length - 1);
          const i0 = Math.floor(scaled);
          const i1 = Math.min(colors.length - 1, i0 + 1);
          const frac = scaled - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
        }
      } else {
        // grain-count: 0,1,2,3 → 4 fixed colors
        const gc = Math.min(3, grains[idx]);
        [r, g, b] = grainColors[gc];
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
    group: 'Composition',
  },
  totalGrains: {
    name: 'Total Grains (static)',
    type: 'number', min: 1000, max: 500000, step: 1000, default: 100000,
    help: 'Grains dropped at center before static render',
    group: 'Composition',
  },
  grainsPerFrame: {
    name: 'Grains / Frame',
    type: 'number', min: 1, max: 200, step: 5, default: 20,
    help: 'Grains added per animation frame',
    group: 'Flow/Motion',
  },
  maxTopples: {
    name: 'Max Topples / Frame',
    type: 'number', min: 100, max: 100000, step: 100, default: 5000,
    help: 'Cap on toppling per frame — prevents frame drops; pattern will catch up over time',
    group: 'Flow/Motion',
  },
  dropMode: {
    name: 'Drop Mode',
    type: 'select',
    options: ['center', 'random'],
    default: 'center',
    help: 'center: classic sandpile self-similar pattern | random: uniform random drops produce a rougher textured heap',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['grain-count', 'topple-count'],
    default: 'grain-count',
    help: 'grain-count: 4-level palette by grains (0–3) | topple-count: log-palette by how many times each cell has toppled',
    group: 'Color',
  },
};

export const sandpile: Generator = {
  id: 'cellular-sandpile',
  family: 'cellular',
  styleName: 'Sandpile',
  definition: 'Abelian BTW sandpile model — grains dropped at centre topple outward producing a self-similar fractal pattern with exact four-fold symmetry',
  algorithmNotes:
    'Any cell with ≥ 4 grains fires: it loses 4 grains and each of its four neighbours gains 1 (grains at boundaries are lost). The Abelian property means the final stable state is independent of toppling order. Dropping millions of grains at the centre produces the famous identity element of the sandpile group — a fractal structure with striking four-fold symmetry and power-law avalanche size distributions.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, totalGrains: 100000, grainsPerFrame: 20,
    maxTopples: 5000, dropMode: 'center', colorMode: 'grain-count',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const colorMode = params.colorMode || 'grain-count';
    const dropMode = params.dropMode || 'center';
    const cx = (size / 2) | 0, cy = (size / 2) | 0;

    if (time === 0) {
      const { grains, toppleCount } = initSandpile(size);
      const total = Math.max(1, (params.totalGrains ?? 100000) | 0);
      const rng = new SeededRNG(seed);
      addAndTopple(grains, toppleCount, size, cx, cy, total, 100_000_000, dropMode === 'random' ? rng : null, dropMode === 'random');
      const maxTopple = toppleCount.reduce((a, b) => Math.max(a, b), 0);
      renderSandpile(ctx, grains, toppleCount, size, maxTopple, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}|${dropMode}`;
    if (!_sandAnim || _sandAnim.key !== key) {
      const { grains, toppleCount } = initSandpile(size);
      _sandAnim = { key, grains, toppleCount, size, totalDropped: 0 };
    }

    const gpf = Math.max(1, (params.grainsPerFrame ?? 20) | 0);
    const maxT = Math.max(100, (params.maxTopples ?? 5000) | 0);
    const rng = dropMode === 'random' ? new SeededRNG(seed ^ (_sandAnim.totalDropped * 6364136223846793005 | 0)) : null;
    addAndTopple(_sandAnim.grains, _sandAnim.toppleCount, _sandAnim.size, cx, cy, gpf, maxT, rng, dropMode === 'random');
    _sandAnim.totalDropped += gpf;

    const maxTopple = _sandAnim.toppleCount.reduce((a, b) => Math.max(a, b), 0);
    renderSandpile(ctx, _sandAnim.grains, _sandAnim.toppleCount, _sandAnim.size, maxTopple, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.totalGrains ?? 100000) * 0.001) | 0; },
};
