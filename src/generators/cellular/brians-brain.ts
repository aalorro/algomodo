import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// States: 0=OFF, 1..dyingStates=DYING (1=freshest), dyingStates+1=ON
// We always use dyingStates+2 distinct values.
// ---------------------------------------------------------------------------

function onState(dyingStates: number): number { return dyingStates + 1; }

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _brainAnim: {
  key: string;
  grid: Uint8Array;
  next: Uint8Array;
  // age: positive = consecutive ON frames, negative = frames since last ON
  age: Int16Array;
  size: number;
} | null = null;

function initBrain(seed: number, size: number, density: number, dyingStates: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const ON = onState(dyingStates);
  const grid = new Uint8Array(N);
  const age  = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const r = rng.random();
    if (r < density) {
      grid[i] = ON; age[i] = 1;
    } else if (r < density * (1 + dyingStates)) {
      // Spread initial dying cells across all dying states
      grid[i] = 1 + ((rng.random() * dyingStates) | 0);
    }
  }
  return { grid, next: new Uint8Array(N), age };
}

// ---------------------------------------------------------------------------
// Step — generalised excitable automaton
//   ON → DYING(1)
//   DYING(k) → DYING(k+1) … DYING(dyingStates) → OFF
//   OFF → ON  iff  birthMin ≤ ON-neighbours ≤ birthMax
// neighbourhood: 'moore' = 8-cell, 'von-neumann' = 4-cell
// ---------------------------------------------------------------------------
function stepBrain(
  grid: Uint8Array, next: Uint8Array, age: Int16Array,
  size: number, dyingStates: number,
  birthMin: number, birthMax: number,
  neighborhood: string,
): void {
  const ON = onState(dyingStates);
  const useMoore = neighborhood !== 'von-neumann';

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = grid[y * size + x];
      if (s === ON) {
        next[y * size + x] = 1; // enter first dying state
      } else if (s > 0) {
        // Advance through dying states
        next[y * size + x] = s < dyingStates ? s + 1 : 0;
      } else {
        // OFF — count ON neighbours
        let count = 0;
        if (useMoore) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              if (grid[((y + dy + size) % size) * size + ((x + dx + size) % size)] === ON) count++;
            }
          }
        } else {
          // Von Neumann — only cardinal directions
          if (grid[((y - 1 + size) % size) * size + x] === ON) count++;
          if (grid[((y + 1)        % size) * size + x] === ON) count++;
          if (grid[y * size + ((x - 1 + size) % size)] === ON) count++;
          if (grid[y * size + ((x + 1)        % size)] === ON) count++;
        }
        next[y * size + x] = (count >= birthMin && count <= birthMax) ? ON : 0;
      }
    }
  }

  const N = size * size;
  for (let i = 0; i < N; i++) {
    if (next[i] === ON) {
      age[i] = age[i] <= 0 ? 1 : Math.min(age[i] + 1, 32767);
    } else if (next[i] === 0 && grid[i] !== 0) {
      // Just transitioned off
      age[i] = -1;
    } else if (next[i] === 0) {
      age[i] = age[i] >= 0 ? -1 : Math.max(age[i] - 1, -60);
    }
    grid[i] = next[i];
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderBrain(
  ctx: CanvasRenderingContext2D,
  grid: Uint8Array, age: Int16Array, size: number,
  dyingStates: number, colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const ON = onState(dyingStates);

  // Classic hardcoded colors
  const cOnClassic:    [number, number, number] = [240, 240, 255];
  const cDyingClassic: [number, number, number] = [80,  80,  200];
  const cOffClassic:   [number, number, number] = [8,   8,   16];

  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      const s = grid[idx];
      const a = age[idx];
      let r: number, g: number, b: number;

      if (colorMode === 'classic') {
        if (s === ON)      [r, g, b] = cOnClassic;
        else if (s > 0)    [r, g, b] = cDyingClassic;
        else               [r, g, b] = cOffClassic;
      } else if (colorMode === 'palette') {
        if (s === ON) {
          [r, g, b] = colors[colors.length - 1];
        } else if (s > 0) {
          // Dying: fade from last to first color based on dying progress
          const t = 1 - (s - 1) / dyingStates;
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        } else {
          [r, g, b] = colors[0];
        }
      } else if (colorMode === 'age') {
        if (s === ON) {
          const t = Math.min(1, a / 80);
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        } else if (s > 0) {
          // Dying — dimmed midpoint color
          const mid = colors[(colors.length / 2) | 0];
          r = (mid[0] * 0.6) | 0; g = (mid[1] * 0.6) | 0; b = (mid[2] * 0.6) | 0;
        } else { r = 8; g = 8; b = 8; }
      } else {
        // trails — ON bright, dying dim, recently-off fading
        const aliveColor = colors[colors.length - 1];
        if (s === ON) {
          [r, g, b] = aliveColor;
        } else if (s > 0) {
          const t = 1 - (s - 1) / dyingStates;
          r = (aliveColor[0] * t * 0.5) | 0;
          g = (aliveColor[1] * t * 0.5) | 0;
          b = (aliveColor[2] * t * 0.5) | 0;
        } else if (a < 0) {
          const t = Math.max(0, 1 + a / 30);
          r = (8 + (aliveColor[0] - 8) * t) | 0;
          g = (8 + (aliveColor[1] - 8) * t) | 0;
          b = (8 + (aliveColor[2] - 8) * t) | 0;
        } else { r = 8; g = 8; b = 8; }
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
  initialDensity: {
    name: 'Initial ON Density',
    type: 'number', min: 0.05, max: 0.6, step: 0.05, default: 0.25,
    help: 'Fraction of cells starting ON; an equal total fraction start in random dying states',
    group: 'Composition',
  },
  warmupSteps: {
    name: 'Warmup Steps',
    type: 'number', min: 0, max: 200, step: 5, default: 30,
    help: 'Steps run before the static render snapshot',
    group: 'Composition',
  },
  dyingStates: {
    name: 'Dying States',
    type: 'number', min: 1, max: 5, step: 1, default: 1,
    help: 'Refractory period — number of intermediate dying states before a cell returns to OFF. 1 = classic Brian\'s Brain; higher values slow wave propagation and produce longer, more visible afterglows',
    group: 'Geometry',
  },
  birthMin: {
    name: 'Birth Min',
    type: 'number', min: 1, max: 8, step: 1, default: 2,
    help: 'Minimum ON neighbours required to birth a new ON cell (classic = 2)',
    group: 'Geometry',
  },
  birthMax: {
    name: 'Birth Max',
    type: 'number', min: 1, max: 8, step: 1, default: 2,
    help: 'Maximum ON neighbours allowed for birth (classic = 2; increasing creates denser, more turbulent patterns)',
    group: 'Geometry',
  },
  neighborhood: {
    name: 'Neighbourhood',
    type: 'select',
    options: ['moore', 'von-neumann'],
    default: 'moore',
    help: 'moore: 8-cell diagonal+cardinal (classic) | von-neumann: 4-cell cardinal only — produces different glider shapes and slower, more directional wave propagation',
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
    options: ['classic', 'palette', 'age', 'trails'],
    default: 'classic',
    help: 'classic: white/blue/dark | palette: ON/dying/OFF mapped to palette gradient | age: ON cells tinted by consecutive ON streak | trails: dying/recently-dead cells leave fading glow',
    group: 'Color',
  },
};

export const briansBrain: Generator = {
  id: 'cellular-brians-brain',
  family: 'cellular',
  styleName: "Brian's Brain",
  definition: "Brian Silverman's generalised excitable automaton — configurable refractory period, birth threshold range, and neighbourhood type; produces perpetually moving gliders, spirals, and compound oscillators",
  algorithmNotes:
    "Generalised excitable CA with dyingStates refractory states and configurable birth threshold. States: ON (firing) → DYING(1) → DYING(2) → … → DYING(dyingStates) → OFF. An OFF cell becomes ON iff birthMin ≤ ON-neighbours ≤ birthMax (classic: both = 2). Classic dyingStates=1 with Moore neighbourhood gives Brian's Brain: the strict two-neighbour birth rule prevents still lifes — every stable structure must move. Increasing dyingStates to 2–3 extends the refractory period, slowing wave velocity and producing longer visible trails of dying cells; this creates richer spiral waves rather than bullet-like gliders. Widening birthMin–birthMax (e.g. 1–3) allows denser birth conditions, producing turbulent boiling patterns. Von Neumann neighbourhood restricts propagation to cardinal directions, yielding diamond-shaped wavefronts and different glider families.",
  parameterSchema,
  defaultParams: {
    gridSize: 128, initialDensity: 0.25, warmupSteps: 30,
    dyingStates: 1, birthMin: 2, birthMax: 2,
    neighborhood: 'moore', stepsPerFrame: 1, colorMode: 'classic',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size        = Math.max(16, (params.gridSize     ?? 128) | 0);
    const density     = params.initialDensity ?? 0.25;
    const dyingStates = Math.max(1, Math.min(5, (params.dyingStates ?? 1) | 0));
    const birthMin    = Math.max(1, (params.birthMin ?? 2) | 0);
    const birthMax    = Math.max(birthMin, (params.birthMax ?? 2) | 0);
    const nbhood      = params.neighborhood || 'moore';
    const colorMode   = params.colorMode || 'classic';

    if (time === 0) {
      const { grid, next, age } = initBrain(seed, size, density, dyingStates);
      const warmup = Math.max(0, (params.warmupSteps ?? 30) | 0);
      for (let s = 0; s < warmup; s++) stepBrain(grid, next, age, size, dyingStates, birthMin, birthMax, nbhood);
      renderBrain(ctx, grid, age, size, dyingStates, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}|${density}|${dyingStates}|${birthMin}|${birthMax}|${nbhood}`;
    if (!_brainAnim || _brainAnim.key !== key) {
      const { grid, next, age } = initBrain(seed, size, density, dyingStates);
      _brainAnim = { key, grid, next, age, size };
    }
    const spf = Math.max(1, (params.stepsPerFrame ?? 1) | 0);
    for (let s = 0; s < spf; s++) {
      stepBrain(_brainAnim.grid, _brainAnim.next, _brainAnim.age, _brainAnim.size, dyingStates, birthMin, birthMax, nbhood);
    }
    renderBrain(ctx, _brainAnim.grid, _brainAnim.age, _brainAnim.size, dyingStates, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.stepsPerFrame ?? 1) * 0.002) | 0; },
};
