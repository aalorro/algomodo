import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _isingAnim: {
  key: string;
  spins: Int8Array;   // +1 or -1
  rng: SeededRNG;
  size: number;
} | null = null;

function initSpins(seed: number, size: number): { spins: Int8Array; rng: SeededRNG } {
  const rng = new SeededRNG(seed);
  const n = size * size;
  const spins = new Int8Array(n);
  for (let i = 0; i < n; i++) spins[i] = rng.random() < 0.5 ? 1 : -1;
  return { spins, rng };
}

// One full Metropolis sweep (N² random spin-flip attempts)
function sweepIsing(spins: Int8Array, size: number, beta: number, rng: SeededRNG, periodic: boolean): void {
  // Precompute acceptance probabilities for dE ∈ {4, 8} (only positive dE needs exp)
  const acc4 = Math.exp(-4 * beta);
  const acc8 = Math.exp(-8 * beta);
  const n = size * size;

  for (let attempt = 0; attempt < n; attempt++) {
    const i = rng.integer(0, n - 1);
    const x = i % size, y = (i / size) | 0;

    let nsum = 0;
    if (periodic) {
      nsum =
        spins[((y - 1 + size) % size) * size + x] +
        spins[((y + 1) % size) * size + x] +
        spins[y * size + (x - 1 + size) % size] +
        spins[y * size + (x + 1) % size];
    } else {
      if (y > 0)        nsum += spins[(y - 1) * size + x];
      if (y < size - 1) nsum += spins[(y + 1) * size + x];
      if (x > 0)        nsum += spins[y * size + x - 1];
      if (x < size - 1) nsum += spins[y * size + x + 1];
    }

    // ΔE = 2 * s_i * nsum  (with J=1)
    const dE = 2 * spins[i] * nsum;
    if (dE <= 0 || rng.random() < (dE === 4 ? acc4 : acc8)) {
      spins[i] = -spins[i] as -1 | 1;
    }
  }
}

function renderIsing(
  ctx: CanvasRenderingContext2D,
  spins: Int8Array, size: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cUp   = colorMode === 'palette-spin' ? colors[colors.length - 1] : [245, 245, 245] as [number, number, number];
  const cDown = colorMode === 'palette-spin' ? colors[0]                 : [12,  12,  12]  as [number, number, number];

  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const [r, g, b] = spins[cy * size + cx] > 0 ? cUp : cDown;
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
  temperature: {
    name: 'Temperature (T)',
    type: 'number', min: 0.5, max: 5.0, step: 0.05, default: 2.27,
    help: 'Temperature in units where J=1, kB=1 — critical temperature ≈ 2.27; below → ferromagnetic order, above → paramagnetic disorder',
    group: 'Composition',
  },
  iterations: {
    name: 'Warmup Sweeps',
    type: 'number', min: 10, max: 2000, step: 10, default: 300,
    help: 'Monte Carlo sweeps for the static render (1 sweep = N² spin-flip attempts)',
    group: 'Composition',
  },
  sweepsPerFrame: {
    name: 'Sweeps / Frame',
    type: 'number', min: 1, max: 20, step: 1, default: 5,
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['spin', 'palette-spin'],
    default: 'spin',
    help: 'spin: white / black | palette-spin: last / first palette colour for up / down spins',
    group: 'Color',
  },
  boundary: {
    name: 'Boundary',
    type: 'select',
    options: ['periodic', 'open'],
    default: 'periodic',
    help: 'periodic: torus topology | open: spins at edges have fewer neighbours',
    group: 'Geometry',
  },
};

export const isingModel: Generator = {
  id: 'cellular-ising-model',
  family: 'cellular',
  styleName: 'Ising Model',
  definition: '2D Ising spin-lattice simulated with the Metropolis–Hastings algorithm — fractal domain boundaries emerge near the critical temperature',
  algorithmNotes:
    'Each lattice site holds a spin s∈{±1}. At each Monte Carlo sweep, N² sites are chosen at random; a spin flip at site i is accepted if ΔE=2J·sᵢ·Σneighbours ≤ 0, otherwise with probability exp(−ΔE/kT). The critical temperature Tc=2J/ln(1+√2)≈2.269 separates ordered (T<Tc) and disordered (T>Tc) phases; near Tc, fractal domain walls span all length scales.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, temperature: 2.27, iterations: 300,
    sweepsPerFrame: 5, colorMode: 'spin', boundary: 'periodic',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const T = Math.max(0.01, params.temperature ?? 2.27);
    const beta = 1 / T;
    const periodic = (params.boundary ?? 'periodic') !== 'open';
    const colorMode = params.colorMode || 'spin';

    if (time === 0) {
      const { spins, rng } = initSpins(seed, size);
      const sweeps = Math.max(1, (params.iterations ?? 300) | 0);
      for (let s = 0; s < sweeps; s++) sweepIsing(spins, size, beta, rng, periodic);
      renderIsing(ctx, spins, size, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}`;
    if (!_isingAnim || _isingAnim.key !== key) {
      const { spins, rng } = initSpins(seed, size);
      _isingAnim = { key, spins, rng, size };
    }
    const sweeps = Math.max(1, (params.sweepsPerFrame ?? 5) | 0);
    for (let s = 0; s < sweeps; s++) sweepIsing(_isingAnim.spins, _isingAnim.size, beta, _isingAnim.rng, periodic);
    renderIsing(ctx, _isingAnim.spins, _isingAnim.size, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.sweepsPerFrame ?? 5) * 0.002) | 0; },
};
