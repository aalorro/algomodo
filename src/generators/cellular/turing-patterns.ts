import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _turingAnim: {
  key: string;
  U: Float32Array;
  V: Float32Array;
  nU: Float32Array;
  nV: Float32Array;
  size: number;
} | null = null;

// ---------------------------------------------------------------------------
// Schnakenberg activator-inhibitor model:
//   ∂u/∂t = Du·∇²u + γ(a − u + u²v)
//   ∂v/∂t = Dv·∇²v + γ(b − u²v)
// Steady state: u₀ = a+b, v₀ = b/(a+b)²
// Turing instability requires Dv/Du > threshold and b > a.
// ---------------------------------------------------------------------------
const DT = 0.01;

function initTuring(seed: number, size: number, a: number, b: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const U = new Float32Array(N);
  const V = new Float32Array(N);
  const u0 = a + b;
  const v0 = b / (u0 * u0);
  for (let i = 0; i < N; i++) {
    U[i] = Math.max(0, u0 + (rng.random() - 0.5) * 0.1);
    V[i] = Math.max(0, v0 + (rng.random() - 0.5) * 0.1);
  }
  return { U, V, nU: new Float32Array(N), nV: new Float32Array(N) };
}

function stepTuring(
  U: Float32Array, V: Float32Array,
  nU: Float32Array, nV: Float32Array,
  size: number,
  Du: number, Dv: number, gamma: number, a: number, b: number,
): void {
  for (let y = 0; y < size; y++) {
    const yp = ((y + 1) % size) * size;
    const ym = ((y - 1 + size) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xp = (x + 1) % size;
      const xm = (x - 1 + size) % size;
      const idx = yc + x;
      const u = U[idx], v = V[idx];
      const lapU = U[yc+xp] + U[yc+xm] + U[yp+x] + U[ym+x] - 4 * u;
      const lapV = V[yc+xp] + V[yc+xm] + V[yp+x] + V[ym+x] - 4 * v;
      const uvv = u * u * v;
      nU[idx] = Math.max(0, u + DT * (Du * lapU + gamma * (a - u + uvv)));
      nV[idx] = Math.max(0, v + DT * (Dv * lapV + gamma * (b - uvv)));
    }
  }
  U.set(nU);
  V.set(nV);
}

function renderTuring(
  ctx: CanvasRenderingContext2D,
  U: Float32Array, size: number,
  a: number, b: number,
  palette: { colors: string[] }, colorMode: string,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;
  const colors = palette.colors.map(hexToRgb);
  // Map [0, 2·u₀] → [0, 1]; peaks sit at 2·u₀, troughs near 0
  const uMax = 2 * (a + b);

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const raw = Math.min(1, Math.max(0, U[cy * size + cx] / uMax));
      const t = colorMode === 'binary' ? (raw > 0.5 ? 1 : 0) : raw;

      const scaled = t * (colors.length - 1);
      const i0 = Math.floor(scaled);
      const i1 = Math.min(colors.length - 1, i0 + 1);
      const frac = scaled - i0;
      const r  = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
      const g  = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
      const b2 = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;

      const x0 = Math.floor(cx * cw), x1 = Math.floor((cx + 1) * cw);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * w + px) * 4;
          d[i] = r; d[i+1] = g; d[i+2] = b2; d[i+3] = 255;
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
  a: {
    name: 'Source a',
    type: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.1,
    help: 'Activator source — must be smaller than b for Turing instability; very low a → stripes',
    group: 'Composition',
  },
  b: {
    name: 'Source b',
    type: 'number', min: 0.3, max: 1.8, step: 0.05, default: 0.9,
    help: 'Inhibitor source — higher b relative to a pushes toward isolated spots',
    group: 'Composition',
  },
  gamma: {
    name: 'Reaction Rate γ',
    type: 'number', min: 20, max: 300, step: 10, default: 100,
    help: 'Overall reaction speed — higher γ produces finer, denser patterns',
    group: 'Composition',
  },
  Du: {
    name: 'Diffusion u',
    type: 'number', min: 0.005, max: 0.1, step: 0.005, default: 0.02,
    help: 'Activator diffusion — must be much smaller than Dv to maintain Turing instability',
    group: 'Texture',
  },
  Dv: {
    name: 'Diffusion v',
    type: 'number', min: 0.1, max: 2.0, step: 0.1, default: 0.5,
    help: 'Inhibitor diffusion — the Dv/Du ratio drives pattern formation (target ratio ≥ 10)',
    group: 'Texture',
  },
  warmupSteps: {
    name: 'Warm-up Steps',
    type: 'number', min: 50, max: 1200, step: 50, default: 400,
    help: 'Steps computed before the static render — more steps → more fully-developed patterns',
    group: 'Composition',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 20, step: 1, default: 5,
    help: 'Simulation steps advanced per animation frame',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'binary'],
    default: 'palette',
    help: 'palette: smooth gradient across activator concentration | binary: hard threshold at midpoint for a two-tone animal-coat look',
    group: 'Color',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const turingPatterns: Generator = {
  id: 'cellular-turing-patterns',
  family: 'cellular',
  styleName: 'Turing Patterns',
  definition:
    "Alan Turing's 1952 reaction-diffusion morphogenesis — an activator-inhibitor system that spontaneously self-organizes into animal coat spots, stripes, and labyrinthine mazes",
  algorithmNotes:
    'Implements the Schnakenberg activator-inhibitor model: ∂u/∂t = Du·∇²u + γ(a − u + u²v), ∂v/∂t = Dv·∇²v + γ(b − u²v). The grid is seeded near the spatially uniform steady state (u₀ = a+b, v₀ = b/(a+b)²) with small random perturbations. When Dv/Du is large (≥10) and b > a, the steady state is unstable to spatially periodic perturbations (Turing instability), producing self-organised patterns whose wavelength scales as ∝1/√γ. Low a/b ratio (≈0.05/1.0) produces parallel stripes; near-equal a and b produces spots; intermediate ratios produce mixed morphologies. Periodic boundaries are used throughout; dt = 0.01 fixed.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, a: 0.1, b: 0.9, gamma: 100,
    Du: 0.02, Dv: 0.5, warmupSteps: 400, stepsPerFrame: 5, colorMode: 'palette',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size  = Math.max(16, (params.gridSize ?? 128) | 0);
    const a     = params.a     ?? 0.1;
    const b     = params.b     ?? 0.9;
    const gamma = params.gamma ?? 100;
    const Du    = params.Du    ?? 0.02;
    const Dv    = params.Dv    ?? 0.5;
    const colorMode = params.colorMode ?? 'palette';

    if (time === 0) {
      const { U, V, nU, nV } = initTuring(seed, size, a, b);
      const steps = Math.max(1, (params.warmupSteps ?? 400) | 0);
      for (let s = 0; s < steps; s++) stepTuring(U, V, nU, nV, size, Du, Dv, gamma, a, b);
      renderTuring(ctx, U, size, a, b, palette, colorMode);
      return;
    }

    const key = `${seed}|${size}|${a}|${b}`;
    if (!_turingAnim || _turingAnim.key !== key) {
      const { U, V, nU, nV } = initTuring(seed, size, a, b);
      _turingAnim = { key, U, V, nU, nV, size };
    }
    const spf = Math.max(1, (params.stepsPerFrame ?? 5) | 0);
    for (let s = 0; s < spf; s++) {
      stepTuring(_turingAnim.U, _turingAnim.V, _turingAnim.nU, _turingAnim.nV,
        _turingAnim.size, Du, Dv, gamma, a, b);
    }
    renderTuring(ctx, _turingAnim.U, _turingAnim.size, a, b, palette, colorMode);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    return (((params.gridSize ?? 128) ** 2) * (params.warmupSteps ?? 400) * 0.002) | 0;
  },
};
