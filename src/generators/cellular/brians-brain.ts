import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Cell state encoding:
//   0          = OFF
//   1..ds      = DYING  (1 = freshest refractory state)
//   ds + 1     = ON
// where ds = dyingStates param (default 1 → classic Brian's Brain).

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _brainAnim: {
  key: string;
  grid: Uint8Array;
  next: Uint8Array;
  size: number;
} | null = null;

function initBrain(seed: number, size: number, density: number, ON: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = rng.random();
    if (r < density)           grid[i] = ON;  // ON
    else if (r < density * 2)  grid[i] = 1;   // DYING (state 1)
  }
  return { grid, next: new Uint8Array(N) };
}

// ---------------------------------------------------------------------------
// Step
//   ON      → DYING(1)
//   DYING(k)→ DYING(k+1)  …  DYING(ds) → OFF
//   OFF     → ON  iff exactly 2 Moore (or VN) neighbours are ON
// ---------------------------------------------------------------------------
function stepBrain(
  grid: Uint8Array, next: Uint8Array, size: number,
  ON: number, ds: number, useVN: boolean,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = grid[y * size + x];
      if (s === ON) {
        next[y * size + x] = 1;
      } else if (s > 0) {
        next[y * size + x] = s < ds ? s + 1 : 0;
      } else {
        let count = 0;
        if (useVN) {
          if (grid[((y - 1 + size) % size) * size + x] === ON) count++;
          if (grid[((y + 1)        % size) * size + x] === ON) count++;
          if (grid[y * size + ((x - 1 + size) % size)] === ON) count++;
          if (grid[y * size + ((x + 1)        % size)] === ON) count++;
        } else {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              if (grid[((y + dy + size) % size) * size + ((x + dx + size) % size)] === ON) count++;
            }
          }
        }
        next[y * size + x] = count === 2 ? ON : 0;
      }
    }
  }
  grid.set(next);
}

function renderBrain(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array, size: number, ON: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cOn:    [number, number, number] = colorMode === 'palette' ? colors[colors.length - 1]       : [240, 240, 255];
  const cDying: [number, number, number] = colorMode === 'palette' ? colors[(colors.length / 2) | 0] : [80,  80,  200];
  const cOff:   [number, number, number] = colorMode === 'palette' ? colors[0]                        : [8,   8,   16];

  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const s = grid[cy * size + cx];
      const [r, g, b] = s === ON ? cOn : s > 0 ? cDying : cOff;
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
    type: 'number', min: 0.05, max: 0.45, step: 0.05, default: 0.25,
    help: 'Fraction of cells starting ON (an equal fraction start DYING)',
    group: 'Composition',
  },
  warmupSteps: {
    name: 'Warmup Steps',
    type: 'number', min: 0, max: 200, step: 5, default: 30,
    help: 'Steps run before the static render snapshot',
    group: 'Composition',
  },
  dyingStates: {
    name: 'Refractory States',
    type: 'number', min: 1, max: 4, step: 1, default: 1,
    help: "Number of intermediate dying states before a cell resets to OFF. 1 = classic Brian's Brain (fast bullet gliders). 2–4 = longer refractory period → slower waves, visible spiral arms and rotating structures.",
    group: 'Geometry',
  },
  neighborhood: {
    name: 'Neighbourhood',
    type: 'select',
    options: ['moore', 'von-neumann'],
    default: 'moore',
    help: 'moore: 8-cell (classic — diagonal + cardinal) | von-neumann: 4-cell cardinal only — produces diamond-shaped wavefronts and different glider families',
    group: 'Geometry',
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
  definition: "Brian Silverman's excitable automaton — every ON cell immediately starts dying, producing perpetually moving gliders; extended refractory period and Von Neumann neighbourhood unlock spiral waves and diamond wavefronts",
  algorithmNotes:
    "Three or more states: ON → DYING(1) → … → DYING(ds) → OFF → ON (iff exactly 2 ON neighbours). Classic ds=1 with Moore neighbourhood is Brian's Brain: the strict two-neighbour birth rule means no still lifes — every structure must move or die, producing a universe of bullet gliders and compound oscillators. Increasing ds to 2–3 lengthens the refractory period, slowing wave propagation and allowing wave fronts to curve into stable spirals. Von Neumann (4-cell cardinal) neighbourhood changes the glider family: bullets travel only along axes, and wavefronts are diamond rather than circular.",
  parameterSchema,
  defaultParams: {
    gridSize: 128, initialDensity: 0.25, warmupSteps: 30,
    dyingStates: 1, neighborhood: 'moore',
    stepsPerFrame: 1, colorMode: 'classic',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size  = Math.max(16, (params.gridSize ?? 128) | 0);
    const density = params.initialDensity ?? 0.25;
    const ds    = Math.max(1, Math.min(4, (params.dyingStates ?? 1) | 0));
    const ON    = ds + 1;
    const useVN = (params.neighborhood || 'moore') === 'von-neumann';
    const colorMode = params.colorMode || 'classic';

    if (time === 0) {
      const { grid, next } = initBrain(seed, size, density, ON);
      const warmup = Math.max(0, (params.warmupSteps ?? 30) | 0);
      for (let s = 0; s < warmup; s++) stepBrain(grid, next, size, ON, ds, useVN);
      renderBrain(ctx, grid, size, ON, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}|${density}|${ds}|${useVN}`;
    if (!_brainAnim || _brainAnim.key !== key) {
      const { grid, next } = initBrain(seed, size, density, ON);
      _brainAnim = { key, grid, next, size };
    }
    const spf = Math.max(1, (params.stepsPerFrame ?? 1) | 0);
    for (let s = 0; s < spf; s++) stepBrain(_brainAnim.grid, _brainAnim.next, _brainAnim.size, ON, ds, useVN);
    renderBrain(ctx, _brainAnim.grid, _brainAnim.size, ON, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.stepsPerFrame ?? 1) * 0.002) | 0; },
};
