import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _crystalAnim: {
  key: string;
  phi: Float32Array;
  u: Float32Array;
  nPhi: Float32Array;
  nU: Float32Array;
  thetaShift: Float32Array; // per-cell anisotropy rotation from grain orientation
  rng: SeededRNG;           // for thermal noise during animation
  size: number;
} | null = null;

// ---------------------------------------------------------------------------
// Kobayashi (1993) anisotropic phase-field solidification:
//   τ·∂φ/∂t = ε(θ)²·∇²φ + φ(1−φ)(φ − 0.5 + m)
//   ∂u/∂t   = D·∇²u + κ·(∂φ/∂t)
// where ε(θ) = ε₀·(1 + δ·cos(j·(θ + θ_shift))), θ = gradient angle of φ
//       m     = (α/π)·atan(γ·(T_eq − u))
// Each crystal grain has its own θ_shift (anisotropy rotation), producing
// polycrystalline grain boundaries where grains meet.
// ---------------------------------------------------------------------------
const DT    = 0.001;
const TAU   = 0.0003;
const ALPHA = 0.9;
const GAM   = 10;
const D     = 2.0;
const KAPPA = 1.8;
const TEQU  = 0.0;

function initCrystal(
  size: number,
  undercooling: number,
  seedRadius: number,
  seedCount: number,
  undercoolingGradient: number,
  rngSeed: number,
): { phi: Float32Array; u: Float32Array; nPhi: Float32Array; nU: Float32Array; thetaShift: Float32Array; rng: SeededRNG } {
  const rng = new SeededRNG(rngSeed);
  const N = size * size;
  const phi        = new Float32Array(N);
  const u          = new Float32Array(N);
  const thetaShift = new Float32Array(N);

  // Generate crystal nuclei — one at centre for seedCount=1, else random scatter
  interface Seed { cx: number; cy: number; theta: number; }
  const seeds: Seed[] = [];
  if (seedCount <= 1) {
    seeds.push({ cx: (size / 2) | 0, cy: (size / 2) | 0, theta: 0 });
  } else {
    for (let i = 0; i < seedCount; i++) {
      seeds.push({
        cx: rng.range(size * 0.1, size * 0.9) | 0,
        cy: rng.range(size * 0.1, size * 0.9) | 0,
        theta: rng.random() * Math.PI * 2,
      });
    }
  }

  // Assign each cell to its nearest nucleus (Voronoi) → grain orientation
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let minD2 = Infinity, nearest = 0;
      for (let i = 0; i < seeds.length; i++) {
        const dx = x - seeds[i].cx, dy = y - seeds[i].cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2) { minD2 = d2; nearest = i; }
      }
      thetaShift[y * size + x] = seeds[nearest].theta;
    }
  }

  // Initialize temperature with optional lateral gradient (left cold → right warm)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grad = undercoolingGradient * (x / (size - 1) - 0.5);
      u[y * size + x] = -(undercooling + grad * undercooling);
    }
  }

  // Plant seed discs
  const r2 = seedRadius * seedRadius;
  for (const s of seeds) {
    for (let dy = -seedRadius; dy <= seedRadius; dy++) {
      for (let dx = -seedRadius; dx <= seedRadius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          const nx = ((s.cx + dx + size) % size);
          const ny = ((s.cy + dy + size) % size);
          const idx = ny * size + nx;
          phi[idx] = 1;
          u[idx]   = 0;
        }
      }
    }
  }

  return { phi, u, nPhi: new Float32Array(N), nU: new Float32Array(N), thetaShift, rng };
}

function stepCrystal(
  phi: Float32Array, u: Float32Array,
  nPhi: Float32Array, nU: Float32Array,
  thetaShift: Float32Array,
  size: number,
  eps0: number, delta: number, symmetry: number,
  thermalNoise: number, rng: SeededRNG,
): void {
  const invTau = 1 / TAU;
  for (let y = 0; y < size; y++) {
    const yp = ((y + 1) % size) * size;
    const ym = ((y - 1 + size) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xp = (x + 1) % size;
      const xm = (x - 1 + size) % size;
      const idx = yc + x;
      const p  = phi[idx];
      const uv = u[idx];

      // Gradient angle for anisotropy, rotated by per-grain thetaShift
      const dpx = (phi[yc + xp] - phi[yc + xm]) * 0.5;
      const dpy = (phi[yp + x] - phi[ym + x]) * 0.5;
      const theta = Math.atan2(dpy, dpx) + thetaShift[idx];
      const eps   = eps0 * (1 + delta * Math.cos(symmetry * theta));

      // Laplacians
      const lapPhi = phi[yc+xp] + phi[yc+xm] + phi[yp+x] + phi[ym+x] - 4 * p;
      const lapU   = u[yc+xp]   + u[yc+xm]   + u[yp+x]   + u[ym+x]   - 4 * uv;

      const m = (ALPHA / Math.PI) * Math.atan(GAM * (TEQU - uv));

      const dphi_dt = invTau * (eps * eps * lapPhi + p * (1 - p) * (p - 0.5 + m));
      nPhi[idx] = Math.max(0, Math.min(1, p  + DT * dphi_dt));
      // Thermal noise perturbs temperature slightly — creates irregular, natural dendrite tips
      const noise = thermalNoise > 0 ? thermalNoise * (rng.random() - 0.5) : 0;
      nU[idx]   = uv + DT * (D * lapU + KAPPA * dphi_dt) + noise;
    }
  }
  phi.set(nPhi);
  u.set(nU);
}

function renderCrystal(
  ctx: CanvasRenderingContext2D,
  phi: Float32Array, u: Float32Array, thetaShift: Float32Array,
  size: number,
  palette: { colors: string[] }, colorMode: string,
  undercooling: number,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;
  const colors = palette.colors.map(hexToRgb);

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      const p  = phi[idx];
      const uv = u[idx];
      let t: number;

      if (colorMode === 'temperature') {
        t = Math.min(1, Math.max(0, (uv + undercooling) / (2 * undercooling)));
      } else if (colorMode === 'composite') {
        const tempT = Math.min(1, Math.max(0, (uv + undercooling) / (2 * undercooling)));
        t = p * 0.65 + tempT * 0.35;
      } else if (colorMode === 'grain') {
        // Liquid = first palette color; each grain a distinct palette hue
        if (p < 0.1) {
          t = 0;
        } else {
          // Map theta ∈ [0, 2π) → [0, 1] for palette lookup
          t = ((thetaShift[idx] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
          // Slightly dim the solid to emphasize grain boundaries (narrow transition between grains)
          t = 0.15 + t * 0.85;
        }
      } else {
        t = p; // 'phase'
      }

      const scaled = t * (colors.length - 1);
      const i0 = Math.floor(scaled);
      const i1 = Math.min(colors.length - 1, i0 + 1);
      const frac = scaled - i0;
      const r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
      const g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
      const b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;

      const x0 = Math.floor(cx * cw), x1 = Math.floor((cx + 1) * cw);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * w + px) * 4;
          d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
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
    type: 'number', min: 1, max: 12, step: 1, default: 1,
    help: '1 = single central nucleus | 2–12 = polycrystalline: nuclei at random positions with random orientations, producing grain boundaries where they collide',
    group: 'Composition',
  },
  undercooling: {
    name: 'Undercooling',
    type: 'number', min: 0.1, max: 0.9, step: 0.05, default: 0.5,
    help: 'Initial temperature below melting point — higher = faster, more branched growth',
    group: 'Composition',
  },
  undercoolingGradient: {
    name: 'Undercooling Gradient',
    type: 'number', min: 0, max: 0.8, step: 0.05, default: 0.0,
    help: 'Left–right gradient of initial undercooling — creates asymmetric dendrites that grow faster toward the colder side',
    group: 'Composition',
  },
  seedRadius: {
    name: 'Seed Radius',
    type: 'number', min: 1, max: 10, step: 1, default: 3,
    help: 'Radius of each solid nucleus placed before growth begins',
    group: 'Composition',
  },
  symmetry: {
    name: 'Crystal Symmetry',
    type: 'select',
    options: ['4', '6', '3', '8'],
    default: '4',
    help: '4: cubic/square (4 arms) | 6: hexagonal snowflake (6 arms) | 3: trigonal (3 arms) | 8: octagonal',
    group: 'Geometry',
  },
  anisotropy: {
    name: 'Anisotropy δ',
    type: 'number', min: 0.0, max: 0.2, step: 0.01, default: 0.04,
    help: 'Strength of orientational preference — 0 = circular blob, 0.04+ = clear dendrite arms; higher values give sharper needles',
    group: 'Geometry',
  },
  interfaceWidth: {
    name: 'Interface Width ε₀',
    type: 'number', min: 0.005, max: 0.03, step: 0.002, default: 0.01,
    help: 'Thickness of the solid-liquid interface and overall growth speed — smaller = sharper tips, larger = blunter',
    group: 'Texture',
  },
  thermalNoise: {
    name: 'Thermal Noise',
    type: 'number', min: 0, max: 0.05, step: 0.002, default: 0.0,
    help: 'Random thermal perturbation added to the temperature field each step — breaks dendrite symmetry for more natural, organic growth',
    group: 'Texture',
  },
  warmupSteps: {
    name: 'Growth Steps',
    type: 'number', min: 200, max: 600, step: 50, default: 600,
    help: 'Simulation steps before static render — more = larger crystal',
    group: 'Composition',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 5, max: 60, step: 5, default: 20,
    help: 'Steps per animation frame — watch the crystal grow in real time',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['phase', 'temperature', 'composite', 'grain'],
    default: 'phase',
    help: 'phase: solid fraction | temperature: thermal halo around growing tips | composite: blend of both | grain: each crystal grain a distinct palette hue (multi-seed mode)',
    group: 'Color',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const crystalGrowth: Generator = {
  id: 'cellular-crystal-growth',
  family: 'cellular',
  styleName: 'Crystal Growth',
  definition:
    'Anisotropic phase-field solidification — one or more nuclei grow dendrite arms driven by latent heat diffusion into undercooled liquid; with multiple seeds you get polycrystalline grain boundaries, thermal noise breaks symmetry for organic shapes, and a gradient undercooling drives directional growth',
  algorithmNotes:
    'Implements the Kobayashi (1993) phase-field model: τ·∂φ/∂t = ε(θ)²·∇²φ + φ(1−φ)(φ−0.5+m), ∂u/∂t = D·∇²u + κ·∂φ/∂t. φ ∈ [0,1] is the solid fraction; u is dimensionless temperature. The anisotropy ε(θ) = ε₀(1+δcos(j·(θ+θ_shift))) uses a per-cell orientation offset θ_shift assigned by Voronoi partitioning to seed nuclei — each grain grows with a random crystallographic orientation, producing visible grain boundaries where differently-oriented regions collide. A left-right undercooling gradient biases growth directionally. Thermal noise on u breaks arm-to-arm symmetry, producing organic irregular tips similar to real snowflakes.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, undercooling: 0.5, undercoolingGradient: 0.0,
    seedRadius: 3, seedCount: 1,
    symmetry: '4', anisotropy: 0.04, interfaceWidth: 0.01,
    thermalNoise: 0.0,
    warmupSteps: 600, stepsPerFrame: 20, colorMode: 'phase',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size                = Math.max(16, (params.gridSize ?? 128) | 0);
    const undercooling        = Math.max(0.05, params.undercooling ?? 0.5);
    const undercoolingGradient = params.undercoolingGradient ?? 0;
    const seedRadius          = Math.max(1, (params.seedRadius ?? 3) | 0);
    const seedCount           = Math.max(1, (params.seedCount ?? 1) | 0);
    const symmetry            = parseInt(params.symmetry ?? '4', 10) || 4;
    const delta               = params.anisotropy    ?? 0.04;
    const eps0                = params.interfaceWidth ?? 0.01;
    const thermalNoise        = params.thermalNoise  ?? 0;
    const colorMode           = params.colorMode     ?? 'phase';

    if (time === 0) {
      const { phi, u, nPhi, nU, thetaShift, rng } = initCrystal(size, undercooling, seedRadius, seedCount, undercoolingGradient, seed);
      const steps = Math.min(600, Math.max(1, (params.warmupSteps ?? 600) | 0));
      for (let s = 0; s < steps; s++) stepCrystal(phi, u, nPhi, nU, thetaShift, size, eps0, delta, symmetry, thermalNoise, rng);
      renderCrystal(ctx, phi, u, thetaShift, size, palette, colorMode, undercooling);
      return;
    }

    const key = `${seed}|${size}|${undercooling}|${symmetry}|${delta}|${eps0}|${seedCount}|${params._renderKey ?? 0}`;
    if (!_crystalAnim || _crystalAnim.key !== key) {
      const { phi, u, nPhi, nU, thetaShift, rng } = initCrystal(size, undercooling, seedRadius, seedCount, undercoolingGradient, seed);
      _crystalAnim = { key, phi, u, nPhi, nU, thetaShift, rng, size };
    }
    const spf = Math.max(1, (params.stepsPerFrame ?? 20) | 0);
    for (let s = 0; s < spf; s++) {
      stepCrystal(_crystalAnim.phi, _crystalAnim.u, _crystalAnim.nPhi, _crystalAnim.nU,
        _crystalAnim.thetaShift, _crystalAnim.size, eps0, delta, symmetry, thermalNoise, _crystalAnim.rng);
    }
    renderCrystal(ctx, _crystalAnim.phi, _crystalAnim.u, _crystalAnim.thetaShift,
      _crystalAnim.size, palette, colorMode, undercooling);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    return (((params.gridSize ?? 128) ** 2) * (params.warmupSteps ?? 1000) * 0.001) | 0;
  },
};
