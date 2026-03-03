import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Rule sets — encode as bitmasks over neighbour count 0–8
// birth[n] = 1 means a dead cell with n ON neighbours is born
// survive[n] = 1 means a live cell with n ON neighbours survives
// ---------------------------------------------------------------------------
type RuleMask = { birth: number; survive: number }; // bits 0–8

function parseRuleSet(name: string): RuleMask {
  switch (name) {
    case 'highlife':    return { birth: (1<<3)|(1<<6),               survive: (1<<2)|(1<<3) };
    case 'day-night':   return { birth: (1<<3)|(1<<6)|(1<<7)|(1<<8), survive: (1<<3)|(1<<4)|(1<<6)|(1<<7)|(1<<8) };
    case 'seeds':       return { birth: (1<<2),                      survive: 0 };
    case 'maze':        return { birth: (1<<3),                      survive: (1<<1)|(1<<2)|(1<<3)|(1<<4)|(1<<5) };
    case 'morley':      return { birth: (1<<3)|(1<<6)|(1<<8),        survive: (1<<2)|(1<<4)|(1<<5) };
    default:            return { birth: (1<<3),                      survive: (1<<2)|(1<<3) }; // Conway
  }
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _anim: {
  key: string;
  grid: Uint8Array;
  next: Uint8Array;
  // positive = consecutive frames alive; negative = frames since death (trail)
  age: Int16Array;
  size: number;
} | null = null;

function initGrid(seed: number, size: number, density: number) {
  const rng = new SeededRNG(seed);
  const n = size * size;
  const grid = new Uint8Array(n);
  const age  = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    if (rng.random() < density) { grid[i] = 1; age[i] = 1; }
  }
  return { grid, next: new Uint8Array(n), age };
}

function stepGrid(
  grid: Uint8Array, next: Uint8Array, age: Int16Array,
  size: number, wrap: boolean, rule: RuleMask,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          let ny = y + dy, nx = x + dx;
          if (wrap) {
            ny = (ny + size) % size;
            nx = (nx + size) % size;
          } else {
            if (ny < 0 || ny >= size || nx < 0 || nx >= size) continue;
          }
          n += grid[ny * size + nx];
        }
      }
      const alive = grid[y * size + x];
      next[y * size + x] = alive
        ? ((rule.survive >> n) & 1)
        : ((rule.birth   >> n) & 1);
    }
  }
  for (let i = 0; i < size * size; i++) {
    if (next[i]) {
      age[i] = age[i] <= 0 ? 1 : Math.min(age[i] + 1, 32767);
    } else {
      age[i] = age[i] >= 0 ? -1 : Math.max(age[i] - 1, -60);
    }
    grid[i] = next[i];
  }
}

// ---------------------------------------------------------------------------
// Perturb — randomly flip a small fraction of cells to prevent stagnation
// ---------------------------------------------------------------------------
function perturbGrid(grid: Uint8Array, age: Int16Array, rng: SeededRNG, rate: number): void {
  const n = grid.length;
  const count = (n * rate) | 0;
  for (let i = 0; i < count; i++) {
    const idx = (rng.random() * n) | 0;
    grid[idx] ^= 1;
    age[idx] = grid[idx] ? 1 : -1;
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderGoL(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array, age: Int16Array, size: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const aliveColor = colors[Math.min(1, colors.length - 1)];
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      const alive = grid[idx];
      const a = age[idx];
      let r: number, g: number, b: number;

      if (colorMode === 'age') {
        if (alive) {
          const t = Math.min(1, a / 120);
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        } else { r = 8; g = 8; b = 8; }
      } else if (colorMode === 'trails') {
        if (alive) {
          [r, g, b] = aliveColor;
        } else if (a < 0) {
          const t = Math.max(0, 1 + a / 30);
          r = (8 + (aliveColor[0] - 8) * t) | 0;
          g = (8 + (aliveColor[1] - 8) * t) | 0;
          b = (8 + (aliveColor[2] - 8) * t) | 0;
        } else { r = 8; g = 8; b = 8; }
      } else if (colorMode === 'entropy') {
        // Color by local ON density in Moore neighbourhood (0–8 → palette gradient)
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ny = (cy + dy + size) % size;
            const nx = (cx + dx + size) % size;
            count += grid[ny * size + nx];
          }
        }
        const t = count / 8;
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        if (!alive) { r = (r * 0.3) | 0; g = (g * 0.3) | 0; b = (b * 0.3) | 0; }
      } else {
        // binary
        if (alive) [r, g, b] = aliveColor; else { r = 8; g = 8; b = 8; }
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
// Parameter schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  gridSize: {
    name: 'Grid Size',
    type: 'number', min: 16, max: 512, step: 16, default: 128,
    help: 'Width/height of cell grid',
    group: 'Composition',
  },
  density: {
    name: 'Initial Density',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Proportion of cells alive at start',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations (static)',
    type: 'number', min: 1, max: 500, step: 1, default: 100,
    help: 'Simulation steps for the static (non-animated) render',
    group: 'Composition',
  },
  ruleSet: {
    name: 'Rule Set',
    type: 'select',
    options: ['conway', 'highlife', 'day-night', 'seeds', 'maze', 'morley'],
    default: 'conway',
    help: 'conway: B3/S23 (classic) | highlife: B36/S23 (replicators) | day-night: B3678/S34678 (day/night symmetry) | seeds: B2/S (explosive) | maze: B3/S12345 (grows mazes) | morley: B368/S245 (complex gliders)',
    group: 'Composition',
  },
  wrapEdges: {
    name: 'Wrap Edges',
    type: 'boolean', default: true,
    help: 'Torus topology — edges wrap around',
    group: 'Geometry',
  },
  perturbRate: {
    name: 'Perturb Rate',
    type: 'number', min: 0, max: 0.02, step: 0.001, default: 0.0,
    help: 'Fraction of cells randomly flipped each frame — prevents stagnation and continuously seeds new activity into stable regions',
    group: 'Flow/Motion',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 10, step: 1, default: 1,
    help: 'GoL steps per animation frame — higher = faster simulation',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['binary', 'age', 'trails', 'entropy'],
    default: 'binary',
    help: 'binary: two-colour | age: alive cells coloured by longevity | trails: dying cells leave a fading afterimage | entropy: cells coloured by local neighbourhood density — reveals activity gradients',
    group: 'Color',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const gameOfLife: Generator = {
  id: 'game-of-life',
  family: 'cellular',
  styleName: 'Game of Life',
  definition: "Conway's Game of Life and related outer-totalistic automata — six rule sets, configurable perturbation to prevent stagnation, and four colour modes including entropy neighbourhood colouring",
  algorithmNotes:
    'Outer-totalistic rules encoded as birth/survival bitmasks over Moore neighbourhood count (0–8). Rule sets: Conway B3/S23 (classic balance of creation and destruction); Highlife B36/S23 (adds replicators that copy themselves diagonally); Day & Night B3678/S34678 (live and dead regions are symmetric — inverting the grid gives the same evolution); Seeds B2/S (every cell dies immediately but explosively births new ones — rapid space-filling); Maze B3/S12345 (live cells rarely die, growing dense labyrinthine corridors); Morley B368/S245 (rich glider ecosystem). Perturb rate randomly flips a fraction of cells each frame, continuously seeding new activity and preventing eventual heat death. Entropy colour mode maps the 8-neighbour ON count to the palette gradient regardless of cell state, revealing clusters and wavefronts as continuous colour fields.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, density: 0.3, iterations: 100,
    ruleSet: 'conway', wrapEdges: true,
    perturbRate: 0.0, stepsPerFrame: 1, colorMode: 'binary',
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size     = Math.max(16, (params.gridSize ?? 128) | 0);
    const density  = params.density  ?? 0.3;
    const wrap     = params.wrapEdges ?? true;
    const colorMode = params.colorMode || 'binary';
    const rule     = parseRuleSet(params.ruleSet || 'conway');

    // ── Static render ────────────────────────────────────────────────────────
    if (time === 0) {
      const { grid, next, age } = initGrid(seed, size, density);
      const iters = Math.max(1, (params.iterations ?? 100) | 0);
      for (let i = 0; i < iters; i++) stepGrid(grid, next, age, size, wrap, rule);
      renderGoL(ctx, grid, age, size, colorMode, palette);
      return;
    }

    // ── Animation mode ────────────────────────────────────────────────────────
    const key = `${seed}|${size}|${density}|${wrap}|${params.ruleSet ?? 'conway'}`;
    if (!_anim || _anim.key !== key) {
      const { grid, next, age } = initGrid(seed, size, density);
      _anim = { key, grid, next, age, size };
    }

    const spf         = Math.max(1, (params.stepsPerFrame  ?? 1)   | 0);
    const perturbRate = params.perturbRate ?? 0;
    const perturbRng  = new SeededRNG(seed ^ (time | 0));

    for (let s = 0; s < spf; s++) {
      if (perturbRate > 0) perturbGrid(_anim.grid, _anim.age, perturbRng, perturbRate);
      stepGrid(_anim.grid, _anim.next, _anim.age, _anim.size, wrap, rule);
    }

    renderGoL(ctx, _anim.grid, _anim.age, _anim.size, colorMode, palette);
  },

  renderWebGL2(gl) {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return (params.gridSize * params.gridSize) / (4 - (params.density ?? 0.3) * 2);
  },
};
