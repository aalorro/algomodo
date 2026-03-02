import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _edenAnim: {
  key: string;
  grid: Uint8Array;          // 1 = occupied, 0 = empty
  birthOrder: Uint32Array;   // step at which the cell was filled
  frontier: number[];        // flat indices of candidate cells
  inFrontier: Uint8Array;    // 1 if index is already in frontier
  step: number;
  rng: SeededRNG;
  size: number;
} | null = null;

function initEden(seed: number, size: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint8Array(N);
  const birthOrder = new Uint32Array(N);
  const inFrontier = new Uint8Array(N);
  const frontier: number[] = [];

  // Seed a small cluster near center (1–3 cells)
  const seeds = Math.floor(rng.range(1, 4));
  for (let s = 0; s < seeds; s++) {
    const cx = Math.floor(rng.range(size * 0.35, size * 0.65));
    const cy = Math.floor(rng.range(size * 0.35, size * 0.65));
    const idx = cy * size + cx;
    if (!grid[idx]) {
      grid[idx] = 1;
      birthOrder[idx] = 0;
      // Add its 4-connected neighbours to frontier
      const nbrs = [
        (cy - 1) * size + cx, (cy + 1) * size + cx,
        cy * size + (cx - 1), cy * size + (cx + 1),
      ];
      for (const ni of nbrs) {
        if (ni >= 0 && ni < N && !grid[ni] && !inFrontier[ni]) {
          frontier.push(ni);
          inFrontier[ni] = 1;
        }
      }
    }
  }

  return { grid, birthOrder, frontier, inFrontier, rng };
}

// Grow exactly `count` cells from the frontier
function growEden(
  grid: Uint8Array, birthOrder: Uint32Array,
  frontier: number[], inFrontier: Uint8Array,
  size: number, step: number, count: number, rng: SeededRNG,
): number {
  const N = size * size;
  let grown = 0;
  for (let g = 0; g < count && frontier.length > 0; g++) {
    // Pick a random frontier cell (swap-remove for O(1))
    const pick = rng.integer(0, frontier.length - 1);
    const idx = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();
    inFrontier[idx] = 0;

    if (grid[idx]) continue; // already filled (edge case)
    grid[idx] = 1;
    birthOrder[idx] = step + grown;
    grown++;

    const x = idx % size, y = (idx / size) | 0;
    const nbrs = [
      y > 0            ? (y - 1) * size + x : -1,
      y < size - 1     ? (y + 1) * size + x : -1,
      x > 0            ? y * size + (x - 1) : -1,
      x < size - 1     ? y * size + (x + 1) : -1,
    ];
    for (const ni of nbrs) {
      if (ni >= 0 && ni < N && !grid[ni] && !inFrontier[ni]) {
        frontier.push(ni);
        inFrontier[ni] = 1;
      }
    }
  }
  return grown;
}

function renderEden(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array, birthOrder: Uint32Array,
  size: number, maxBirth: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cEmpty: [number, number, number] = [10, 10, 10];
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      let r: number, g: number, b: number;

      if (!grid[idx]) {
        [r, g, b] = cEmpty;
      } else if (colorMode === 'birth-order') {
        // Map birth order to palette gradient
        const t = maxBirth > 0 ? birthOrder[idx] / maxBirth : 0;
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      } else if (colorMode === 'concentric') {
        // Quantize into palette bands (concentric rings)
        const t = maxBirth > 0 ? birthOrder[idx] / maxBirth : 0;
        const ci = Math.min(colors.length - 1, Math.floor(t * colors.length));
        [r, g, b] = colors[ci];
      } else {
        // monochrome: last palette color
        [r, g, b] = colors[colors.length - 1];
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
  targetFill: {
    name: 'Target Fill (%)',
    type: 'number', min: 5, max: 100, step: 5, default: 85,
    help: 'Percentage of grid to fill before stopping (static render)',
    group: 'Composition',
  },
  cellsPerFrame: {
    name: 'Cells / Frame',
    type: 'number', min: 1, max: 500, step: 10, default: 80,
    help: 'New cells grown per animation frame',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['birth-order', 'concentric', 'monochrome'],
    default: 'birth-order',
    help: 'birth-order: smooth palette gradient from first to last cell grown | concentric: quantized rings | monochrome: flat fill',
    group: 'Color',
  },
};

export const edenGrowth: Generator = {
  id: 'cellular-eden-growth',
  family: 'cellular',
  styleName: 'Eden Growth',
  definition: 'Eden Model A — random cluster growth from a seeded core, producing compact organic blobs with fractal boundary statistics',
  algorithmNotes:
    'A set of "frontier" cells (empty cells adjacent to the cluster) is maintained. Each step a frontier cell is chosen uniformly at random and added to the cluster, and its empty neighbours join the frontier. The resulting cluster is compact (Eden Model A) with a rough perimeter whose width scales as t^(1/3) — the KPZ universality class. Birth order is shown as a colour gradient revealing the concentric growth history.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, targetFill: 85, cellsPerFrame: 80, colorMode: 'birth-order',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const colorMode = params.colorMode || 'birth-order';

    if (time === 0) {
      const { grid, birthOrder, frontier, inFrontier, rng } = initEden(seed, size);
      const target = Math.floor(size * size * ((params.targetFill ?? 85) / 100));
      let step = 0;
      while (step < target && frontier.length > 0) {
        step += growEden(grid, birthOrder, frontier, inFrontier, size, step, 100, rng);
      }
      renderEden(ctx, grid, birthOrder, size, step, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}`;
    if (!_edenAnim || _edenAnim.key !== key) {
      const { grid, birthOrder, frontier, inFrontier, rng } = initEden(seed, size);
      _edenAnim = { key, grid, birthOrder, frontier, inFrontier, step: 0, rng, size };
    }
    const cpf = Math.max(1, (params.cellsPerFrame ?? 80) | 0);
    const grown = growEden(
      _edenAnim.grid, _edenAnim.birthOrder,
      _edenAnim.frontier, _edenAnim.inFrontier,
      _edenAnim.size, _edenAnim.step, cpf, _edenAnim.rng,
    );
    _edenAnim.step += grown;
    renderEden(ctx, _edenAnim.grid, _edenAnim.birthOrder, _edenAnim.size, _edenAnim.step, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.targetFill ?? 85) / 100 * 0.01) | 0; },
};
