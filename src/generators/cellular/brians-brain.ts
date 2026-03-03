import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// States: 0 = OFF, 1..dyingStates = DYING (1 = freshest), dyingStates+1 = ON
// ---------------------------------------------------------------------------
function onState(ds: number): number { return ds + 1; }

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _brainAnim: {
  key: string;
  grid: Uint8Array;
  next: Uint8Array;
  age: Int16Array;   // >0: consecutive ON frames; <0: frames since last ON
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
      // Distribute initial dying cells uniformly across all dying states.
      // For dyingStates === 1 this always gives 1 (no ambiguity).
      grid[i] = dyingStates === 1
        ? 1
        : 1 + ((rng.random() * dyingStates) | 0);
    }
    // else: OFF — stays 0
  }
  return { grid, next: new Uint8Array(N), age };
}

// ---------------------------------------------------------------------------
// Step — generalised excitable automaton
//   ON           → DYING(1)
//   DYING(k)     → DYING(k+1)  …  DYING(dyingStates) → OFF
//   OFF          → ON  iff  birthMin ≤ ON-neighbours ≤ birthMax
// neighbourhood: 'moore' = 8-cell, 'von-neumann' = 4-cell (periodic boundary)
// ---------------------------------------------------------------------------
function stepBrain(
  grid: Uint8Array, next: Uint8Array, age: Int16Array,
  size: number, dyingStates: number,
  birthMin: number, birthMax: number,
  neighborhood: string,
): void {
  const ON = onState(dyingStates);
  const useMoore = neighborhood !== 'von-neumann';

  // --- compute next state (reads grid, writes next; grid untouched) ---------
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = grid[y * size + x];
      if (s === ON) {
        next[y * size + x] = 1;                                      // → DYING(1)
      } else if (s > 0) {
        next[y * size + x] = s < dyingStates ? s + 1 : 0;           // advance or → OFF
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
          if (grid[((y - 1 + size) % size) * size + x] === ON) count++;
          if (grid[((y + 1)        % size) * size + x] === ON) count++;
          if (grid[y * size + ((x - 1 + size) % size)] === ON) count++;
          if (grid[y * size + ((x + 1)        % size)] === ON) count++;
        }
        next[y * size + x] = (count >= birthMin && count <= birthMax) ? ON : 0;
      }
    }
  }

  // --- update age (reads OLD grid + next, writes age) ----------------------
  const N = size * size;
  for (let i = 0; i < N; i++) {
    const nv = next[i];
    const ov = grid[i];
    if (nv === ON) {
      age[i] = ov === ON ? Math.min(age[i] + 1, 32767) : 1;
    } else if (nv === 0) {
      age[i] = ov !== 0 ? -1 : Math.max(age[i] >= 0 ? -1 : age[i] - 1, -60);
    }
    // dying states: leave age unchanged (still shows the last ON age value)
  }

  // --- copy next → grid (atomic) ------------------------------------------
  grid.set(next);
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

  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      const s   = grid[idx];
      const a   = age[idx];
      let rv: number, gv: number, bv: number;

      if (colorMode === 'classic') {
        if (s === ON) {
          rv = 240; gv = 240; bv = 255;           // bright white-blue
        } else if (s > 0) {
          rv = 80;  gv = 80;  bv = 200;           // mid blue (dying)
        } else {
          rv = 8;   gv = 8;   bv = 16;            // near-black (off)
        }
      } else if (colorMode === 'palette') {
        if (s === ON) {
          [rv, gv, bv] = colors[colors.length - 1];
        } else if (s > 0) {
          // Dying: linearly interpolate from last-palette (fresh) toward
          // first-palette (old). t ranges from (ds)/(ds+1) down to 1/(ds+1).
          const t  = (dyingStates - s + 1) / (dyingStates + 1);
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f  = ci - i0;
          rv = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          gv = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          bv = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        } else {
          [rv, gv, bv] = colors[0];
        }
      } else if (colorMode === 'age') {
        if (s === ON) {
          const t  = Math.min(1, a / 80);
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f  = ci - i0;
          rv = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          gv = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          bv = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        } else if (s > 0) {
          const mid = colors[(colors.length / 2) | 0];
          rv = (mid[0] * 0.55) | 0; gv = (mid[1] * 0.55) | 0; bv = (mid[2] * 0.55) | 0;
        } else {
          rv = 8; gv = 8; bv = 8;
        }
      } else {
        // trails
        const ac = colors[colors.length - 1];
        if (s === ON) {
          [rv, gv, bv] = ac;
        } else if (s > 0) {
          const t = (dyingStates - s + 1) / (dyingStates + 1);
          rv = (ac[0] * t * 0.5) | 0; gv = (ac[1] * t * 0.5) | 0; bv = (ac[2] * t * 0.5) | 0;
        } else if (a < 0) {
          const t = Math.max(0, 1 + a / 30);
          rv = (8 + (ac[0] - 8) * t) | 0; gv = (8 + (ac[1] - 8) * t) | 0; bv = (8 + (ac[2] - 8) * t) | 0;
        } else {
          rv = 8; gv = 8; bv = 8;
        }
      }

      const x0 = Math.floor(cx * cw), x1 = Math.floor((cx + 1) * cw);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const pi = (py * w + px) * 4;
          d[pi] = rv; d[pi + 1] = gv; d[pi + 2] = bv; d[pi + 3] = 255;
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
    type: 'number', min: 0.05, max: 0.5, step: 0.05, default: 0.25,
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
    help: "Refractory period length. 1 = classic Brian's Brain. Higher values slow wave speed and produce longer visible afterglows and spiral waves instead of bullet-like gliders.",
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
    help: 'Maximum ON neighbours for birth (classic = 2; increasing creates denser turbulent patterns)',
    group: 'Geometry',
  },
  neighborhood: {
    name: 'Neighbourhood',
    type: 'select',
    options: ['moore', 'von-neumann'],
    default: 'moore',
    help: 'moore: 8-cell diagonal+cardinal (classic) | von-neumann: 4-cell cardinal only — diamond wavefronts and different glider families',
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
    help: 'classic: white/blue/dark | palette: ON/dying/OFF mapped to palette gradient | age: ON cells tinted by consecutive firing streak | trails: recently-dead cells leave a fading glow',
    group: 'Color',
  },
};

export const briansBrain: Generator = {
  id: 'cellular-brians-brain',
  family: 'cellular',
  styleName: "Brian's Brain",
  definition: "Brian Silverman's generalised excitable automaton — configurable refractory period, birth threshold range, and neighbourhood type; produces perpetually moving gliders, spirals, and compound oscillators",
  algorithmNotes:
    "Generalised excitable CA with dyingStates refractory states and configurable birth threshold. States: ON → DYING(1) → … → DYING(dyingStates) → OFF. OFF → ON iff birthMin ≤ ON-neighbours ≤ birthMax (classic: both = 2). dyingStates=1 with Moore neighbourhood is classic Brian's Brain — the strict two-neighbour birth rule prevents still lifes; every structure must move. Increasing dyingStates to 2–3 lengthens the refractory period, slowing wave velocity and producing richer spiral waves. Widening birthMin–birthMax (e.g. 1–3) creates turbulent boiling patterns. Von Neumann neighbourhood restricts propagation to cardinal directions, yielding diamond wavefronts.",
  parameterSchema,
  defaultParams: {
    gridSize: 128, initialDensity: 0.25, warmupSteps: 30,
    dyingStates: 1, birthMin: 2, birthMax: 2,
    neighborhood: 'moore', stepsPerFrame: 1, colorMode: 'classic',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size        = Math.max(16, (params.gridSize      ?? 128) | 0);
    const density     = Math.min(0.5, params.initialDensity ?? 0.25);
    const dyingStates = Math.max(1, Math.min(5, (params.dyingStates ?? 1) | 0));
    const birthMin    = Math.max(1, (params.birthMin ?? 2) | 0);
    const birthMax    = Math.max(birthMin, (params.birthMax ?? 2) | 0);
    const nbhood      = params.neighborhood || 'moore';
    const colorMode   = params.colorMode    || 'classic';

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
