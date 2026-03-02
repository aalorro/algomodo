import type { Generator, ParameterSchema } from '../../types';

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
  size: number;
} | null = null;

// ---------------------------------------------------------------------------
// Kobayashi (1993) anisotropic phase-field solidification:
//   τ·∂φ/∂t = ε(θ)²·∇²φ + φ(1−φ)(φ − 0.5 + m)
//   ∂u/∂t   = D·∇²u + κ·(∂φ/∂t)
// where ε(θ) = ε₀·(1 + δ·cos(j·θ)), θ = gradient angle of φ
//       m     = (α/π)·atan(γ·(T_eq − u))
// φ ∈ [0,1]: solid fraction.  u: dimensionless temperature (0 = melting point).
// ---------------------------------------------------------------------------
const DT    = 0.001;  // time step (stable for τ=0.0003, ε₀=0.01, D=2)
const TAU   = 0.0003;
const ALPHA = 0.9;
const GAM   = 10;
const D     = 2.0;
const KAPPA = 1.8;
const TEQU  = 0.0;   // equilibrium temperature

function initCrystal(size: number, undercooling: number, seedRadius: number) {
  const N = size * size;
  const phi  = new Float32Array(N);
  const u    = new Float32Array(N).fill(-undercooling);
  const cx = (size / 2) | 0;
  const cy = (size / 2) | 0;
  const r2 = seedRadius * seedRadius;
  for (let dy = -seedRadius; dy <= seedRadius; dy++) {
    for (let dx = -seedRadius; dx <= seedRadius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const idx = ((cy + dy + size) % size) * size + ((cx + dx + size) % size);
        phi[idx] = 1;
        u[idx]   = 0;
      }
    }
  }
  return { phi, u, nPhi: new Float32Array(N), nU: new Float32Array(N) };
}

function stepCrystal(
  phi: Float32Array, u: Float32Array,
  nPhi: Float32Array, nU: Float32Array,
  size: number,
  eps0: number, delta: number, symmetry: number,
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

      // Gradient angle for anisotropy
      const dpx = (phi[yc + xp] - phi[yc + xm]) * 0.5;
      const dpy = (phi[yp + x] - phi[ym + x]) * 0.5;
      const theta = Math.atan2(dpy, dpx);
      const eps   = eps0 * (1 + delta * Math.cos(symmetry * theta));

      // Laplacians
      const lapPhi = phi[yc+xp] + phi[yc+xm] + phi[yp+x] + phi[ym+x] - 4 * p;
      const lapU   = u[yc+xp]   + u[yc+xm]   + u[yp+x]   + u[ym+x]   - 4 * uv;

      // Driving force (positive = undercooled = solidification favoured)
      const m = (ALPHA / Math.PI) * Math.atan(GAM * (TEQU - uv));

      // Phase field and temperature updates
      const dphi_dt = invTau * (eps * eps * lapPhi + p * (1 - p) * (p - 0.5 + m));
      nPhi[idx] = Math.max(0, Math.min(1, p  + DT * dphi_dt));
      nU[idx]   = uv + DT * (D * lapU + KAPPA * dphi_dt);
    }
  }
  phi.set(nPhi);
  u.set(nU);
}

function renderCrystal(
  ctx: CanvasRenderingContext2D,
  phi: Float32Array, u: Float32Array, size: number,
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
        // Map u from [−undercooling, +undercooling] → [0,1]
        t = Math.min(1, Math.max(0, (uv + undercooling) / (2 * undercooling)));
      } else if (colorMode === 'composite') {
        // Phase (solid fraction) weighted with local temperature halo
        const tempT = Math.min(1, Math.max(0, (uv + undercooling) / (2 * undercooling)));
        t = p * 0.65 + tempT * 0.35;
      } else {
        // 'phase': pure solid fraction — liquid=first palette colour, crystal=last
        t = p;
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
  undercooling: {
    name: 'Undercooling',
    type: 'number', min: 0.1, max: 0.9, step: 0.05, default: 0.5,
    help: 'Initial temperature below the melting point — higher = faster, more branched growth',
    group: 'Composition',
  },
  seedRadius: {
    name: 'Seed Radius',
    type: 'number', min: 1, max: 10, step: 1, default: 3,
    help: 'Radius of the solid nucleus placed at centre before growth begins',
    group: 'Composition',
  },
  symmetry: {
    name: 'Crystal Symmetry',
    type: 'select',
    options: ['4', '6', '3', '8'],
    default: '4',
    help: '4: cubic / square (4 arms) | 6: hexagonal snowflake (6 arms) | 3: trigonal (3 arms) | 8: octagonal',
    group: 'Geometry',
  },
  anisotropy: {
    name: 'Anisotropy δ',
    type: 'number', min: 0.0, max: 0.2, step: 0.01, default: 0.04,
    help: 'Strength of orientational preference — 0 = circular blob, 0.04+ = clear dendrite arms',
    group: 'Geometry',
  },
  interfaceWidth: {
    name: 'Interface Width ε₀',
    type: 'number', min: 0.005, max: 0.03, step: 0.002, default: 0.01,
    help: 'Controls the thickness of the solid-liquid interface and overall growth speed',
    group: 'Texture',
  },
  warmupSteps: {
    name: 'Growth Steps',
    type: 'number', min: 200, max: 3000, step: 100, default: 1000,
    help: 'Simulation steps run before the static render — more = larger crystal',
    group: 'Composition',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 5, max: 60, step: 5, default: 20,
    help: 'Steps advanced per animation frame — higher = watch the crystal grow faster',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['phase', 'temperature', 'composite'],
    default: 'phase',
    help: 'phase: solid fraction (first palette = liquid, last = crystal) | temperature: thermal halo around growing tips | composite: blend of both',
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
    'Anisotropic phase-field solidification — a solid nucleus grows dendrite arms whose symmetry (cubic, hexagonal, trigonal) is set by the crystal anisotropy, driven by latent heat diffusion into undercooled liquid',
  algorithmNotes:
    'Implements the Kobayashi (1993) phase-field model: τ·∂φ/∂t = ε(θ)²·∇²φ + φ(1−φ)(φ−0.5+m), ∂u/∂t = D·∇²u + κ·∂φ/∂t. φ ∈ [0,1] is the solid fraction; u is dimensionless temperature (0 = melting point, negative = undercooled). The anisotropic diffusion coefficient ε(θ) = ε₀(1+δcos(jθ)) — where θ is the local interface normal angle and j sets the rotational symmetry (4-fold = cubic, 6-fold = hexagonal) — creates preferred growth directions. The driving force m = (α/π)atan(γ(Teq−u)) is positive in undercooled liquid, pushing φ toward 1. Latent heat (κ·∂φ/∂t) released during solidification warms the adjacent liquid, transiently suppressing growth at the tips and forcing branching — the central mechanism of dendritic morphology.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, undercooling: 0.5, seedRadius: 3,
    symmetry: '4', anisotropy: 0.04, interfaceWidth: 0.01,
    warmupSteps: 1000, stepsPerFrame: 20, colorMode: 'phase',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size         = Math.max(16, (params.gridSize ?? 128) | 0);
    const undercooling = Math.max(0.05, params.undercooling ?? 0.5);
    const seedRadius   = Math.max(1, (params.seedRadius ?? 3) | 0);
    const symmetry     = parseInt(params.symmetry ?? '4', 10) || 4;
    const delta        = params.anisotropy    ?? 0.04;
    const eps0         = params.interfaceWidth ?? 0.01;
    const colorMode    = params.colorMode ?? 'phase';

    if (time === 0) {
      const { phi, u, nPhi, nU } = initCrystal(size, undercooling, seedRadius);
      const steps = Math.max(1, (params.warmupSteps ?? 1000) | 0);
      for (let s = 0; s < steps; s++) stepCrystal(phi, u, nPhi, nU, size, eps0, delta, symmetry);
      renderCrystal(ctx, phi, u, size, palette, colorMode, undercooling);
      return;
    }

    // seed is intentionally unused in animation — crystal state is deterministic from params
    const key = `${seed}|${size}|${undercooling}|${symmetry}|${delta}|${eps0}`;
    if (!_crystalAnim || _crystalAnim.key !== key) {
      const { phi, u, nPhi, nU } = initCrystal(size, undercooling, seedRadius);
      _crystalAnim = { key, phi, u, nPhi, nU, size };
    }
    const spf = Math.max(1, (params.stepsPerFrame ?? 20) | 0);
    for (let s = 0; s < spf; s++) {
      stepCrystal(_crystalAnim.phi, _crystalAnim.u, _crystalAnim.nPhi, _crystalAnim.nU,
        _crystalAnim.size, eps0, delta, symmetry);
    }
    renderCrystal(ctx, _crystalAnim.phi, _crystalAnim.u, _crystalAnim.size,
      palette, colorMode, undercooling);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    return (((params.gridSize ?? 128) ** 2) * (params.warmupSteps ?? 1000) * 0.001) | 0;
  },
};
