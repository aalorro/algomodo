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
  team: Uint8Array;          // which seed cluster owns this cell
  birthOrder: Uint32Array;   // step at which the cell was filled
  // frontier entries encode team + index: (teamId << 20) | cellIdx
  frontier: number[];
  inFrontier: Uint8Array;    // 1 if index is already in frontier
  step: number;
  rng: SeededRNG;
  size: number;
  seedCount: number;
} | null = null;

function initEden(seed: number, size: number, seedCount: number, connectivity: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint8Array(N);
  const team = new Uint8Array(N);
  const birthOrder = new Uint32Array(N);
  const inFrontier = new Uint8Array(N);
  const frontier: number[] = [];

  const count = Math.max(1, Math.min(6, seedCount));

  // Place each seed cluster in a roughly evenly-distributed position
  for (let s = 0; s < count; s++) {
    const angle = (s / count) * Math.PI * 2 + rng.random() * 0.3;
    const dist = size * (0.2 + rng.random() * 0.15);
    const cx = Math.round(size / 2 + Math.cos(angle) * dist);
    const cy = Math.round(size / 2 + Math.sin(angle) * dist);
    const clampedX = Math.max(1, Math.min(size - 2, cx));
    const clampedY = Math.max(1, Math.min(size - 2, cy));
    const idx = clampedY * size + clampedX;
    if (!grid[idx]) {
      grid[idx] = 1;
      team[idx] = s;
      birthOrder[idx] = 0;
      addNeighboursToFrontier(clampedX, clampedY, s, size, N, grid, inFrontier, frontier, connectivity);
    }
  }

  return { grid, team, birthOrder, frontier, inFrontier, rng };
}

function addNeighboursToFrontier(
  x: number, y: number, teamId: number,
  size: number, N: number,
  grid: Uint8Array, inFrontier: Uint8Array, frontier: number[],
  connectivity: number,
): void {
  const nbrs4 = [
    y > 0            ? (y - 1) * size + x : -1,
    y < size - 1     ? (y + 1) * size + x : -1,
    x > 0            ? y * size + (x - 1) : -1,
    x < size - 1     ? y * size + (x + 1) : -1,
  ];
  const nbrs8 = connectivity === 8 ? [
    (y > 0 && x > 0)            ? (y - 1) * size + (x - 1) : -1,
    (y > 0 && x < size - 1)     ? (y - 1) * size + (x + 1) : -1,
    (y < size - 1 && x > 0)     ? (y + 1) * size + (x - 1) : -1,
    (y < size - 1 && x < size - 1) ? (y + 1) * size + (x + 1) : -1,
  ] : [];

  for (const ni of [...nbrs4, ...nbrs8]) {
    if (ni < 0 || ni >= N || grid[ni] || inFrontier[ni]) continue;
    frontier.push((teamId << 20) | ni);
    inFrontier[ni] = 1;
  }
}

// Grow exactly `count` cells from the frontier
function growEden(
  grid: Uint8Array, team: Uint8Array, birthOrder: Uint32Array,
  frontier: number[], inFrontier: Uint8Array,
  size: number, step: number, count: number, rng: SeededRNG,
  connectivity: number,
): number {
  const N = size * size;
  let grown = 0;
  for (let g = 0; g < count && frontier.length > 0; g++) {
    const pick = rng.integer(0, frontier.length - 1);
    const entry = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();

    const idx = entry & 0xFFFFF;
    const teamId = (entry >> 20) & 0xFF;
    inFrontier[idx] = 0;

    if (grid[idx]) continue; // already filled (race condition between seeds)
    grid[idx] = 1;
    team[idx] = teamId;
    birthOrder[idx] = step + grown;
    grown++;

    const x = idx % size, y = (idx / size) | 0;
    addNeighboursToFrontier(x, y, teamId, size, N, grid, inFrontier, frontier, connectivity);
  }
  return grown;
}

function renderEden(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array, team: Uint8Array, birthOrder: Uint32Array,
  size: number, maxBirth: number,
  colorMode: string, seedCount: number, palette: { colors: string[] },
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
      } else if (colorMode === 'team') {
        // Each seed cluster gets a distinct palette color
        const count = Math.max(1, seedCount);
        const ci = Math.round((team[idx] / (count - 1 || 1)) * (colors.length - 1));
        [r, g, b] = colors[Math.min(colors.length - 1, ci)];
      } else if (colorMode === 'birth-order') {
        const t = maxBirth > 0 ? birthOrder[idx] / maxBirth : 0;
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      } else if (colorMode === 'concentric') {
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
  seedCount: {
    name: 'Seed Count',
    type: 'number', min: 1, max: 6, step: 1, default: 1,
    help: 'Number of competing seed clusters — each grows simultaneously and is shown in a different palette color when colorMode is "team"',
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
  connectivity: {
    name: 'Connectivity',
    type: 'select',
    options: ['4', '8'],
    default: '4',
    help: '4-connected: cardinal directions only | 8-connected: diagonals included, producing rounder, denser clusters',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['birth-order', 'concentric', 'team', 'monochrome'],
    default: 'birth-order',
    help: 'birth-order: smooth palette gradient | concentric: quantized rings | team: competing seeds in distinct colors | monochrome: flat fill',
    group: 'Color',
  },
};

export const edenGrowth: Generator = {
  id: 'cellular-eden-growth',
  family: 'cellular',
  styleName: 'Eden Growth',
  definition: 'Eden Model A — random cluster growth from one or more seeded cores, producing compact organic blobs with fractal boundary statistics',
  algorithmNotes:
    'A set of "frontier" cells (empty cells adjacent to any cluster) is maintained as a flat array with O(1) swap-remove. Each step a frontier cell is chosen uniformly at random, added to its owning cluster, and its empty neighbours join the frontier. With multiple seeds, competing clusters race to fill the grid — boundaries form where clusters meet. 8-connectivity allows diagonal growth, producing denser, rounder blobs. The KPZ universality class governs perimeter roughness scaling (width ~ t^{1/3}). Animation auto-restarts when the grid is fully filled.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, seedCount: 1, targetFill: 85,
    cellsPerFrame: 80, connectivity: '4', colorMode: 'birth-order',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const colorMode = params.colorMode || 'birth-order';
    const seedCount = Math.max(1, Math.min(6, (params.seedCount ?? 1) | 0));
    const connectivity = params.connectivity === '8' ? 8 : 4;

    if (time === 0) {
      const { grid, team, birthOrder, frontier, inFrontier, rng } = initEden(seed, size, seedCount, connectivity);
      const target = Math.floor(size * size * ((params.targetFill ?? 85) / 100));
      let step = 0;
      while (step < target && frontier.length > 0) {
        step += growEden(grid, team, birthOrder, frontier, inFrontier, size, step, 100, rng, connectivity);
      }
      renderEden(ctx, grid, team, birthOrder, size, step, colorMode, seedCount, palette);
      return;
    }

    const key = `${seed}|${size}|${seedCount}|${connectivity}`;
    if (!_edenAnim || _edenAnim.key !== key) {
      const { grid, team, birthOrder, frontier, inFrontier, rng } = initEden(seed, size, seedCount, connectivity);
      _edenAnim = { key, grid, team, birthOrder, frontier, inFrontier, step: 0, rng, size, seedCount };
    }

    // Auto-restart when fully filled
    if (_edenAnim.frontier.length === 0) {
      const { grid, team, birthOrder, frontier, inFrontier, rng } = initEden(seed ^ (_edenAnim.step * 2654435761 | 0), size, seedCount, connectivity);
      _edenAnim = { key: _edenAnim.key, grid, team, birthOrder, frontier, inFrontier, step: 0, rng, size, seedCount };
    }

    const cpf = Math.max(1, (params.cellsPerFrame ?? 80) | 0);
    const grown = growEden(
      _edenAnim.grid, _edenAnim.team, _edenAnim.birthOrder,
      _edenAnim.frontier, _edenAnim.inFrontier,
      _edenAnim.size, _edenAnim.step, cpf, _edenAnim.rng, connectivity,
    );
    _edenAnim.step += grown;
    renderEden(ctx, _edenAnim.grid, _edenAnim.team, _edenAnim.birthOrder, _edenAnim.size, _edenAnim.step, colorMode, _edenAnim.seedCount, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.targetFill ?? 85) / 100 * 0.01) | 0; },
};
