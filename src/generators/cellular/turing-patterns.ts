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
  animTime: number; // internal step counter for parameter drift
} | null = null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DT_SCHNAKENBERG = 0.01;
const DT_GRAY_SCOTT   = 1.0;

// ---------------------------------------------------------------------------
// Laplacian helper — 5-point or 9-point isotropic stencil
//
// 9-point weights: cardinal = 0.2, diagonal = 0.05, center = -1.0
// (sum = 4×0.2 + 4×0.05 − 1 = 0  ✓  isotropic to O(h⁴))
// ---------------------------------------------------------------------------
function laplacian5(
  F: Float32Array, idx: number,
  xp: number, xm: number, yp_row: number, ym_row: number, yc_row: number,
): number {
  return F[yc_row + xp] + F[yc_row + xm] + F[yp_row + (idx % (Math.sqrt(F.length) | 0))]
    + F[ym_row + (idx % (Math.sqrt(F.length) | 0))] - 4 * F[idx];
}

// We inline the 5/9-point choice inside each step function for performance.

// ---------------------------------------------------------------------------
// Schnakenberg model:
//   ∂u/∂t = Du·∇²u + γ(a − u + u²v)
//   ∂v/∂t = Dv·∇²v + γ(b − u²v)
// ---------------------------------------------------------------------------
function initSchnakenberg(seed: number, size: number, a: number, b: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const U = new Float32Array(N), V = new Float32Array(N);
  const u0 = a + b, v0 = b / (u0 * u0);
  for (let i = 0; i < N; i++) {
    U[i] = Math.max(0, u0 + (rng.random() - 0.5) * 0.1);
    V[i] = Math.max(0, v0 + (rng.random() - 0.5) * 0.1);
  }
  return { U, V, nU: new Float32Array(N), nV: new Float32Array(N) };
}

function stepSchnakenberg(
  U: Float32Array, V: Float32Array,
  nU: Float32Array, nV: Float32Array,
  size: number,
  Du: number, Dv: number, gamma: number, a: number, b: number,
  stencil9: boolean, paramGradient: number, animTime: number, paramDrift: number,
): void {
  for (let y = 0; y < size; y++) {
    const yp = ((y + 1) % size) * size;
    const ym = ((y - 1 + size) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xp = (x + 1) % size, xm = (x - 1 + size) % size;
      const idx = yc + x;
      const u = U[idx], v = V[idx];

      let lapU: number, lapV: number;
      if (stencil9) {
        const xpp = (x + 1) % size, xmm = (x - 1 + size) % size;
        const ypp = ((y + 1) % size) * size, ymm = ((y - 1 + size) % size) * size;
        lapU = 0.2 * (U[yc + xpp] + U[yc + xmm] + U[ypp + x] + U[ymm + x])
             + 0.05 * (U[ypp + xpp] + U[ypp + xmm] + U[ymm + xpp] + U[ymm + xmm])
             - U[idx];
        lapV = 0.2 * (V[yc + xpp] + V[yc + xmm] + V[ypp + x] + V[ymm + x])
             + 0.05 * (V[ypp + xpp] + V[ypp + xmm] + V[ymm + xpp] + V[ymm + xmm])
             - V[idx];
      } else {
        lapU = U[yc + xp] + U[yc + xm] + U[yp + x] + U[ym + x] - 4 * u;
        lapV = V[yc + xp] + V[yc + xm] + V[yp + x] + V[ym + x] - 4 * v;
      }

      const uvv = u * u * v;
      // Spatial gradient: vary 'a' across x-axis (low a → stripes, high a → spots)
      const localA = a * (1 + paramGradient * (x / (size - 1) - 0.5) * 2);
      // Slow parameter drift: oscillate 'b' during animation
      const driftB = b + paramDrift * b * Math.sin(animTime * 0.008);

      nU[idx] = Math.max(0, u + DT_SCHNAKENBERG * (Du * lapU + gamma * (localA - u + uvv)));
      nV[idx] = Math.max(0, v + DT_SCHNAKENBERG * (Dv * lapV + gamma * (driftB - uvv)));
    }
  }
  U.set(nU); V.set(nV);
}

// ---------------------------------------------------------------------------
// Gray-Scott model:
//   ∂u/∂t = Du·∇²u − u·v² + F·(1−u)
//   ∂v/∂t = Dv·∇²v + u·v² − (F+k)·v
//
// Canonical parameter ranges (Pearson 1993):
//   solitons:  F≈0.037, k≈0.060
//   worms:     F≈0.035, k≈0.065
//   spots:     F≈0.025, k≈0.050
//   rings:     F≈0.039, k≈0.058
// ---------------------------------------------------------------------------
function initGrayScott(seed: number, size: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const U = new Float32Array(N).fill(1);
  const V = new Float32Array(N);
  // Seed small random patches of V
  const numPatches = 4 + (rng.random() * 8) | 0;
  for (let p = 0; p < numPatches; p++) {
    const cx = (rng.random() * size) | 0;
    const cy = (rng.random() * size) | 0;
    const r = 2 + (rng.random() * 5) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          const nx = ((cx + dx) % size + size) % size;
          const ny = ((cy + dy) % size + size) % size;
          U[ny * size + nx] = 0.5 + (rng.random() - 0.5) * 0.1;
          V[ny * size + nx] = 0.25 + (rng.random() - 0.5) * 0.05;
        }
      }
    }
  }
  return { U, V, nU: new Float32Array(N), nV: new Float32Array(N) };
}

function stepGrayScott(
  U: Float32Array, V: Float32Array,
  nU: Float32Array, nV: Float32Array,
  size: number,
  Du: number, Dv: number, F: number, k: number,
  stencil9: boolean, paramGradient: number, animTime: number, paramDrift: number,
): void {
  for (let y = 0; y < size; y++) {
    const yp = ((y + 1) % size) * size;
    const ym = ((y - 1 + size) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xp = (x + 1) % size, xm = (x - 1 + size) % size;
      const idx = yc + x;
      const u = U[idx], v = V[idx];

      let lapU: number, lapV: number;
      if (stencil9) {
        const xpp = (x + 1) % size, xmm = (x - 1 + size) % size;
        const ypp = ((y + 1) % size) * size, ymm = ((y - 1 + size) % size) * size;
        lapU = 0.2 * (U[yc + xpp] + U[yc + xmm] + U[ypp + x] + U[ymm + x])
             + 0.05 * (U[ypp + xpp] + U[ypp + xmm] + U[ymm + xpp] + U[ymm + xmm])
             - U[idx];
        lapV = 0.2 * (V[yc + xpp] + V[yc + xmm] + V[ypp + x] + V[ymm + x])
             + 0.05 * (V[ypp + xpp] + V[ypp + xmm] + V[ymm + xpp] + V[ymm + xmm])
             - V[idx];
      } else {
        lapU = U[yc + xp] + U[yc + xm] + U[yp + x] + U[ym + x] - 4 * u;
        lapV = V[yc + xp] + V[yc + xm] + V[yp + x] + V[ym + x] - 4 * v;
      }

      const uvv = u * v * v;
      // Spatial gradient: vary k across x-axis (left = low k = spots/solitons, right = high k = decay)
      const localK = k * (1 + paramGradient * (x / (size - 1) - 0.5) * 1.4);
      // Slow drift: oscillate F (feed rate) during animation to evolve pattern morphology
      const driftF = F + paramDrift * F * Math.sin(animTime * 0.005);

      nU[idx] = Math.max(0, Math.min(1, u + DT_GRAY_SCOTT * (Du * lapU - uvv + driftF * (1 - u))));
      nV[idx] = Math.max(0, Math.min(1, v + DT_GRAY_SCOTT * (Dv * lapV + uvv - (driftF + localK) * v)));
    }
  }
  U.set(nU); V.set(nV);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderTuring(
  ctx: CanvasRenderingContext2D,
  U: Float32Array, V: Float32Array,
  size: number,
  a: number, b: number, F: number,
  model: string,
  palette: { colors: string[] }, colorMode: string,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;
  const colors = palette.colors.map(hexToRgb);

  // For Schnakenberg: map U ∈ [0, 2·u₀] → [0,1]
  // For Gray-Scott: map V ∈ [0, 0.5] → [0,1] (V shows the spots)
  const isGS = model === 'gray-scott';
  const field = isGS ? V : U;
  const fieldMax = isGS ? 0.5 : 2 * (a + b);

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const raw = Math.min(1, Math.max(0, field[cy * size + cx] / fieldMax));
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
          d[i] = r; d[i + 1] = g; d[i + 2] = b2; d[i + 3] = 255;
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
  model: {
    name: 'Model',
    type: 'select',
    options: ['schnakenberg', 'gray-scott'],
    default: 'schnakenberg',
    help: 'schnakenberg: activator-inhibitor, produces spots/stripes/labyrinths | gray-scott: substrate-catalyst, produces solitons, worms, annular rings, coral-like growths',
    group: 'Composition',
  },
  a: {
    name: 'Source a',
    type: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.1,
    help: 'Schnakenberg: activator source — low a → stripes, higher a → spots',
    group: 'Composition',
  },
  b: {
    name: 'Source b',
    type: 'number', min: 0.3, max: 1.8, step: 0.05, default: 0.9,
    help: 'Schnakenberg: inhibitor source — higher b relative to a pushes toward isolated spots',
    group: 'Composition',
  },
  gamma: {
    name: 'Reaction Rate γ',
    type: 'number', min: 20, max: 300, step: 10, default: 100,
    help: 'Schnakenberg: overall reaction speed — higher γ produces finer, denser patterns',
    group: 'Composition',
  },
  F: {
    name: 'Feed Rate F',
    type: 'number', min: 0.010, max: 0.080, step: 0.001, default: 0.037,
    help: 'Gray-Scott: feed rate of substrate U — F≈0.037 → solitons, F≈0.035 → worms, F≈0.025 → spots',
    group: 'Composition',
  },
  k: {
    name: 'Kill Rate k',
    type: 'number', min: 0.040, max: 0.075, step: 0.001, default: 0.060,
    help: 'Gray-Scott: kill rate of catalyst V — k≈0.060 → solitons, k≈0.065 → worms, k≈0.050 → spots',
    group: 'Composition',
  },
  Du: {
    name: 'Diffusion u',
    type: 'number', min: 0.005, max: 0.3, step: 0.005, default: 0.02,
    help: 'Activator diffusion for Schnakenberg — keep ≪ Dv (target ≥10× ratio). Gray-Scott uses a fixed canonical Du=0.16 regardless of this value.',
    group: 'Texture',
  },
  Dv: {
    name: 'Diffusion v',
    type: 'number', min: 0.05, max: 2.0, step: 0.05, default: 0.5,
    help: 'Inhibitor diffusion for Schnakenberg — Dv/Du ratio drives the Turing instability. Gray-Scott uses a fixed canonical Dv=0.08 regardless of this value.',
    group: 'Texture',
  },
  stencil: {
    name: 'Laplacian Stencil',
    type: 'select',
    options: ['9-point', '5-point'],
    default: '9-point',
    help: '9-point isotropic (cardinal 0.2, diagonal 0.05): rounder spots, less grid artefacts | 5-point (standard): slightly faster',
    group: 'Texture',
  },
  paramGradient: {
    name: 'Param Gradient',
    type: 'number', min: 0, max: 0.8, step: 0.05, default: 0.0,
    help: 'Linearly varies the reaction parameter across the canvas (a for Schnakenberg, k for Gray-Scott) — creates a smooth morphological transition from spots to stripes or solitons to waves',
    group: 'Composition',
  },
  paramDrift: {
    name: 'Param Drift',
    type: 'number', min: 0, max: 0.5, step: 0.05, default: 0.15,
    help: 'Slowly oscillates the reaction parameter during animation — set above 0 to see the pattern continuously morph between morphologies. 0 = static equilibrium.',
    group: 'Flow/Motion',
  },
  warmupSteps: {
    name: 'Warm-up Steps',
    type: 'number', min: 50, max: 2000, step: 50, default: 800,
    help: 'Steps before the static render — Schnakenberg: 400–800; Gray-Scott needs 800–2000 for developed patterns',
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
    help: 'palette: smooth gradient across activator/catalyst concentration | binary: hard threshold for two-tone animal-coat look',
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
    "Alan Turing's 1952 reaction-diffusion morphogenesis — choose between the Schnakenberg activator-inhibitor model (spots, stripes, labyrinths) or the Gray-Scott model (solitons, worms, annular rings). A spatial parameter gradient creates morphological transitions across the canvas, and slow parameter drift makes patterns continuously evolve during animation.",
  algorithmNotes:
    'Schnakenberg model: ∂u/∂t = Du·∇²u + γ(a−u+u²v), ∂v/∂t = Dv·∇²v + γ(b−u²v). Seeded near the uniform steady state (u₀=a+b, v₀=b/(a+b)²). Turing instability requires Dv/Du≥10 and b>a; pattern wavelength ∝ 1/√γ. Gray-Scott model: ∂u/∂t = Du·∇²u − uv²+F(1−u), ∂v/∂t = Dv·∇²v + uv² − (F+k)v. Seeded with small random patches of v≈0.25; DT=1.0. Both models support a 9-point isotropic Laplacian (cardinal weight 0.2, diagonal 0.05) for rounder, more biological spots. Spatial parameter gradient (a or k varied linearly across x-axis) creates a transition between spot, stripe, and labyrinthine morphologies in a single render. Slow parameter drift (paramDrift>0) continuously oscillates the parameter during animation, driving the pattern to morph over time.',
  parameterSchema,
  defaultParams: {
    gridSize: 128,
    model: 'schnakenberg', a: 0.1, b: 0.9, gamma: 100,
    F: 0.037, k: 0.060,
    Du: 0.02, Dv: 0.5,
    stencil: '9-point',
    paramGradient: 0.0, paramDrift: 0.15,
    warmupSteps: 800, stepsPerFrame: 5, colorMode: 'palette',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const rawSize = Math.max(16, (params.gridSize ?? 128) | 0);
    const size    = quality === 'draft' ? Math.min(rawSize, 80) : quality === 'ultra' ? rawSize : Math.min(rawSize, 128);
    const model   = params.model ?? 'schnakenberg';
    const a       = params.a     ?? 0.1;
    const b       = params.b     ?? 0.9;
    const gamma   = params.gamma ?? 100;
    const F       = params.F     ?? 0.037;
    const k       = params.k     ?? 0.060;
    const isGS = model === 'gray-scott';
    // Gray-Scott requires Du > Dv (substrate diffuses faster than catalyst).
    // The schema Du/Dv defaults are tuned for Schnakenberg (Dv >> Du).
    // Always use canonical Pearl (1993) values for GS — avoids the reaction collapsing.
    const Du      = isGS ? 0.16 : (params.Du ?? 0.02);
    const Dv      = isGS ? 0.08 : (params.Dv ?? 0.5);
    const stencil9 = (params.stencil ?? '9-point') === '9-point';
    const paramGradient = params.paramGradient ?? 0;
    const paramDrift    = params.paramDrift    ?? 0.15;
    const colorMode = params.colorMode ?? 'palette';

    const stepFn = isGS
      ? (U: Float32Array, V: Float32Array, nU: Float32Array, nV: Float32Array, aTime: number) =>
          stepGrayScott(U, V, nU, nV, size, Du, Dv, F, k, stencil9, paramGradient, aTime, paramDrift)
      : (U: Float32Array, V: Float32Array, nU: Float32Array, nV: Float32Array, aTime: number) =>
          stepSchnakenberg(U, V, nU, nV, size, Du, Dv, gamma, a, b, stencil9, paramGradient, aTime, paramDrift);

    if (time === 0) {
      const { U, V, nU, nV } = isGS
        ? initGrayScott(seed, size)
        : initSchnakenberg(seed, size, a, b);
      const steps = Math.max(1, (params.warmupSteps ?? (isGS ? 1000 : 500)) | 0);
      for (let s = 0; s < steps; s++) stepFn(U, V, nU, nV, s);
      renderTuring(ctx, U, V, size, a, b, F, model, palette, colorMode);
      return;
    }

    const key = `${seed}|${size}|${model}|${a}|${b}|${F}|${k}|${params._renderKey ?? 0}`;
    if (!_turingAnim || _turingAnim.key !== key) {
      const { U, V, nU, nV } = isGS
        ? initGrayScott(seed, size)
        : initSchnakenberg(seed, size, a, b);
      _turingAnim = { key, U, V, nU, nV, size, animTime: 0 };
    }

    const spf = Math.max(1, (params.stepsPerFrame ?? 5) | 0);
    for (let s = 0; s < spf; s++) {
      stepFn(_turingAnim.U, _turingAnim.V, _turingAnim.nU, _turingAnim.nV, _turingAnim.animTime);
      _turingAnim.animTime++;
    }
    renderTuring(ctx, _turingAnim.U, _turingAnim.V, _turingAnim.size, a, b, F, model, palette, colorMode);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const isGS = (params.model ?? 'schnakenberg') === 'gray-scott';
    return (((params.gridSize ?? 128) ** 2) * (params.warmupSteps ?? 500) * (isGS ? 0.001 : 0.002)) | 0;
  },
};
