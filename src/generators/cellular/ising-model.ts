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
  spins: Int8Array;       // +1 or -1
  flipAge: Float32Array;  // sweeps since last flip (0 = just flipped)
  rng: SeededRNG;
  size: number;
  sweepCount: number;
} | null = null;

function initSpins(seed: number, size: number): { spins: Int8Array; flipAge: Float32Array; rng: SeededRNG } {
  const rng = new SeededRNG(seed);
  const n = size * size;
  const spins = new Int8Array(n);
  const flipAge = new Float32Array(n).fill(999);
  for (let i = 0; i < n; i++) spins[i] = rng.random() < 0.5 ? 1 : -1;
  return { spins, flipAge, rng };
}

// One full Metropolis sweep (N² random spin-flip attempts)
// H = external field strength
function sweepIsing(
  spins: Int8Array, flipAge: Float32Array,
  size: number, beta: number, H: number, rng: SeededRNG, periodic: boolean,
): void {
  const n = size * size;
  // For H=0 we can use precomputed acceptance probs; otherwise compute on the fly
  const usePrecomp = H === 0;
  const acc4 = usePrecomp ? Math.exp(-4 * beta) : 0;
  const acc8 = usePrecomp ? Math.exp(-8 * beta) : 0;

  // Age all existing flips
  for (let i = 0; i < n; i++) { if (flipAge[i] < 999) flipAge[i]++; }

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

    // ΔE = 2 * s_i * (nsum + H)
    const dE = 2 * spins[i] * (nsum + H);
    let accept: boolean;
    if (dE <= 0) {
      accept = true;
    } else if (usePrecomp) {
      accept = rng.random() < (dE === 4 ? acc4 : acc8);
    } else {
      accept = rng.random() < Math.exp(-dE * beta);
    }
    if (accept) {
      spins[i] = -spins[i] as -1 | 1;
      flipAge[i] = 0;
    }
  }
}

function renderIsing(
  ctx: CanvasRenderingContext2D,
  spins: Int8Array, flipAge: Float32Array,
  size: number, displayMode: string,
  palette: { colors: string[] }, periodic: boolean,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      let r: number, g: number, b: number;

      if (displayMode === 'palette') {
        // up spin → last palette color, down spin → first
        const [pr, pg, pb] = spins[idx] > 0
          ? colors[colors.length - 1]
          : colors[0];
        r = pr; g = pg; b = pb;
      } else if (displayMode === 'local-mag') {
        // 3×3 neighbourhood average magnetization → palette position
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (periodic) {
              const ny = ((cy + dy + size) % size) * size;
              const nx = (cx + dx + size) % size;
              sum += spins[ny + nx];
            } else {
              const ny = cy + dy, nx = cx + dx;
              if (ny >= 0 && ny < size && nx >= 0 && nx < size)
                sum += spins[ny * size + nx];
            }
            cnt++;
          }
        }
        const t = (sum / cnt) * 0.5 + 0.5; // 0..1
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      } else if (displayMode === 'flip-age') {
        // Recently-flipped cells glow bright; decay over ~40 sweeps
        const age = flipAge[idx];
        const glow = age < 40 ? Math.max(0, 1 - age / 40) : 0;
        const base = spins[idx] > 0 ? colors[colors.length - 1] : colors[0];
        r = Math.min(255, (base[0] + (255 - base[0]) * glow)) | 0;
        g = Math.min(255, (base[1] + (255 - base[1]) * glow)) | 0;
        b = Math.min(255, (base[2] + (255 - base[2]) * glow)) | 0;
      } else {
        // 'spin': white / black
        const v = spins[idx] > 0 ? 245 : 12;
        r = v; g = v; b = v;
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
  temperature: {
    name: 'Temperature (T)',
    type: 'number', min: 0.5, max: 5.0, step: 0.05, default: 2.27,
    help: 'Temperature in units where J=1, kB=1 — critical temperature ≈ 2.27; below → ferromagnetic order, above → paramagnetic disorder',
    group: 'Composition',
  },
  externalField: {
    name: 'External Field (H)',
    type: 'number', min: -1.5, max: 1.5, step: 0.05, default: 0,
    help: 'Applied magnetic field — positive values favour up-spins, negative values favour down-spins',
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
  displayMode: {
    name: 'Display Mode',
    type: 'select',
    options: ['spin', 'palette', 'local-mag', 'flip-age'],
    default: 'spin',
    help: 'spin: white/black | palette: palette first/last | local-mag: 3×3 average → palette gradient | flip-age: recently flipped cells glow',
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
    'Each lattice site holds a spin s∈{±1}. At each Monte Carlo sweep, N² sites are chosen at random; a spin flip at site i is accepted if ΔE=2·sᵢ·(Σneighbours+H)≤0, otherwise with probability exp(−ΔE/kT). The critical temperature Tc≈2.269 separates ordered and disordered phases. An external field H biases the equilibrium magnetisation. The flip-age display mode highlights the active domain-wall dynamics by glowing each cell immediately after it flips.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, temperature: 2.27, externalField: 0, iterations: 300,
    sweepsPerFrame: 5, displayMode: 'spin', boundary: 'periodic',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const T = Math.max(0.01, params.temperature ?? 2.27);
    const beta = 1 / T;
    const H = params.externalField ?? 0;
    const periodic = (params.boundary ?? 'periodic') !== 'open';
    const displayMode = params.displayMode || 'spin';

    if (time === 0) {
      const { spins, flipAge, rng } = initSpins(seed, size);
      const sweeps = Math.max(1, (params.iterations ?? 300) | 0);
      for (let s = 0; s < sweeps; s++) sweepIsing(spins, flipAge, size, beta, H, rng, periodic);
      renderIsing(ctx, spins, flipAge, size, displayMode, palette, periodic);
      return;
    }

    const key = `${seed}|${size}|${params._renderKey ?? 0}`;
    if (!_isingAnim || _isingAnim.key !== key) {
      const { spins, flipAge, rng } = initSpins(seed, size);
      // Run warmup sweeps so animation starts from a partially-equilibrated state
      const warmup = Math.max(1, (params.iterations ?? 300) | 0);
      for (let s = 0; s < warmup; s++) sweepIsing(spins, flipAge, size, beta, H, rng, periodic);
      _isingAnim = { key, spins, flipAge, rng, size, sweepCount: warmup };
    }
    const sweeps = Math.max(1, (params.sweepsPerFrame ?? 5) | 0);
    for (let s = 0; s < sweeps; s++) {
      sweepIsing(_isingAnim.spins, _isingAnim.flipAge, _isingAnim.size, beta, H, _isingAnim.rng, periodic);
      _isingAnim.sweepCount++;
    }
    renderIsing(ctx, _isingAnim.spins, _isingAnim.flipAge, _isingAnim.size, displayMode, palette, periodic);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * (params.sweepsPerFrame ?? 5) * 0.002) | 0; },
};
