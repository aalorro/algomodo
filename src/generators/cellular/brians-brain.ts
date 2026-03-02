import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Cell states
const OFF = 0, DYING = 1, ON = 2;

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _brainAnim: {
  key: string;
  grid: Uint8Array;
  next: Uint8Array;
  size: number;
} | null = null;

function initBrain(seed: number, size: number, density: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = rng.random();
    grid[i] = r < density ? ON : r < density * 2 ? DYING : OFF;
  }
  return { grid, next: new Uint8Array(N) };
}

// Brian's Brain rules (Moore neighbourhood, periodic):
//   ON   → DYING
//   DYING → OFF
//   OFF  → ON  iff exactly 2 Moore neighbours are ON
function stepBrain(grid: Uint8Array, next: Uint8Array, size: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = grid[y * size + x];
      if (s === ON) {
        next[y * size + x] = DYING;
      } else if (s === DYING) {
        next[y * size + x] = OFF;
      } else {
        // Count ON neighbours (Moore, periodic)
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (grid[((y + dy + size) % size) * size + ((x + dx + size) % size)] === ON) count++;
          }
        }
        next[y * size + x] = count === 2 ? ON : OFF;
      }
    }
  }
  grid.set(next);
}

function renderBrain(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array, size: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cOn:    [number, number, number] = colorMode === 'palette' ? colors[colors.length - 1]         : [240, 240, 255];
  const cDying: [number, number, number] = colorMode === 'palette' ? colors[(colors.length / 2) | 0]   : [80,  80,  200];
  const cOff:   [number, number, number] = colorMode === 'palette' ? colors[0]                          : [8,   8,   16];

  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const [r, g, b] = grid[cy * size + cx] === ON ? cOn
        : grid[cy * size + cx] === DYING ? cDying
        : cOff;
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
    name: 'Initial ON Density',
    type: 'number', min: 0.05, max: 0.6, step: 0.05, default: 0.25,
    help: 'Fraction of cells starting in the ON state (equal fraction start DYING)',
    group: 'Composition',
  },
  warmupSteps: {
    name: 'Warmup Steps',
    type: 'number', min: 0, max: 200, step: 5, default: 30,
    help: 'Steps computed before the static render',
    group: 'Composition',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 10, step: 1, default: 1,
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['classic', 'palette'],
    default: 'classic',
    help: 'classic: white / blue / dark | palette: last / mid / first palette colours for ON / DYING / OFF',
    group: 'Color',
  },
};

export const briansBrain: Generator = {
  id: 'cellular-brians-brain',
  family: 'cellular',
  styleName: "Brian's Brain",
  definition: "Brian Silverman's 3-state excitable automaton — every ON cell immediately starts dying, producing perpetually moving gliders and complex persistent structures",
  algorithmNotes:
    "Three states: ON (firing), DYING (refractory), OFF (resting). Rules: ON → DYING always; DYING → OFF always; OFF → ON iff exactly 2 Moore neighbours are ON. The strict two-neighbour birth rule prevents static patterns — every structure must move or die, producing a universe of perpetually gliding 'bullets' and compound oscillators. Unlike Game of Life, Brian's Brain has no still lifes.",
  parameterSchema,
  defaultParams: {
    gridSize: 128, initialDensity: 0.25, warmupSteps: 30,
    stepsPerFrame: 1, colorMode: 'classic',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const density = params.initialDensity ?? 0.25;
    const colorMode = params.colorMode || 'classic';

    if (time === 0) {
      const { grid, next } = initBrain(seed, size, density);
      const warmup = Math.max(0, (params.warmupSteps ?? 30) | 0);
      for (let s = 0; s < warmup; s++) stepBrain(grid, next, size);
      renderBrain(ctx, grid, size, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}|${density}`;
    if (!_brainAnim || _brainAnim.key !== key) {
      const { grid, next } = initBrain(seed, size, density);
      _brainAnim = { key, grid, next, size };
    }
    const spf = Math.max(1, (params.stepsPerFrame ?? 1) | 0);
    for (let s = 0; s < spf; s++) stepBrain(_brainAnim.grid, _brainAnim.next, _brainAnim.size);
    renderBrain(ctx, _brainAnim.grid, _brainAnim.size, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.stepsPerFrame ?? 1) * 0.002) | 0; },
};
