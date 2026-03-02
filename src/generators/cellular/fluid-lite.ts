import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _fluidAnim: {
  key: string;
  d: Float32Array;    // density
  d0: Float32Array;   // scratch
  size: number;
  vortices: { x: number; y: number; gamma: number }[];
  sources: { x: number; y: number }[];
} | null = null;

interface Vortex { x: number; y: number; gamma: number }
interface Source { x: number; y: number }

function initFluid(seed: number, size: number, vortexCount: number, sourceCount: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const d = new Float32Array(N);
  const d0 = new Float32Array(N);

  const vortices: Vortex[] = [];
  for (let i = 0; i < vortexCount; i++) {
    vortices.push({
      x: rng.random() * size,
      y: rng.random() * size,
      gamma: (rng.random() - 0.5) * 2 * 5.0,   // circulation
    });
  }

  const sources: Source[] = [];
  for (let i = 0; i < sourceCount; i++) {
    sources.push({
      x: rng.range(size * 0.1, size * 0.9),
      y: rng.range(size * 0.1, size * 0.9),
    });
  }

  return { d, d0, vortices, sources };
}

// Compute velocity at (px, py) from all vortices (point-vortex model)
function velocity(px: number, py: number, vortices: Vortex[], size: number): [number, number] {
  let u = 0, v = 0;
  for (const vt of vortices) {
    const dx = px - vt.x;
    const dy = py - vt.y;
    const r2 = Math.max(1, dx * dx + dy * dy);
    const fac = vt.gamma / (2 * Math.PI * r2);
    u += -dy * fac;
    v +=  dx * fac;
  }
  return [u, v];
}

// Bilinear sample with periodic wrap
function samplePeriodic(f: Float32Array, x: number, y: number, size: number): number {
  const x0 = ((Math.floor(x) % size) + size) % size;
  const y0 = ((Math.floor(y) % size) + size) % size;
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  return (
    f[y0 * size + x0] * (1 - fx) * (1 - fy) +
    f[y0 * size + x1] *  fx      * (1 - fy) +
    f[y1 * size + x0] * (1 - fx) *  fy      +
    f[y1 * size + x1] *  fx      *  fy
  );
}

function stepFluid(
  d: Float32Array, d0: Float32Array,
  size: number, vortices: Vortex[], sources: Source[],
  dt: number, diffusion: number, decay: number, inject: number,
): void {
  const N = size * size;

  // 1. Advect density backwards along velocity field
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [u, v] = velocity(x + 0.5, y + 0.5, vortices, size);
      const srcX = x - u * dt;
      const srcY = y - v * dt;
      d0[y * size + x] = samplePeriodic(d, srcX, srcY, size);
    }
  }
  d.set(d0);

  // 2. Diffuse (simple Jacobi — 2 iterations for speed)
  const alpha = diffusion;
  for (let iter = 0; iter < 2; iter++) {
    for (let y = 0; y < size; y++) {
      const yp = ((y + 1) % size) * size;
      const ym = ((y - 1 + size) % size) * size;
      const yc = y * size;
      for (let x = 0; x < size; x++) {
        const xp = (x + 1) % size;
        const xm = (x - 1 + size) % size;
        d0[yc + x] = (d[yc + x] + alpha * (d[yc + xp] + d[yc + xm] + d[yp + x] + d[ym + x])) / (1 + 4 * alpha);
      }
    }
    d.set(d0);
  }

  // 3. Decay
  for (let i = 0; i < N; i++) d[i] *= decay;

  // 4. Inject density at source points
  for (const src of sources) {
    const x = Math.floor(src.x), y = Math.floor(src.y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = ((x + dx) % size + size) % size;
        const ny = ((y + dy) % size + size) % size;
        d[ny * size + nx] = Math.min(1, d[ny * size + nx] + inject);
      }
    }
  }
}

function renderFluid(
  ctx: CanvasRenderingContext2D,
  d: Float32Array, size: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const c0 = colors[0] || [0, 0, 30];
  const cLast = colors[colors.length - 1] || [255, 200, 100];
  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let py = 0; py < h; py++) {
    const gy = Math.min(size - 1, (py / h * size) | 0);
    for (let px = 0; px < w; px++) {
      const gx = Math.min(size - 1, (px / w * size) | 0);
      const t = Math.max(0, Math.min(1, d[gy * size + gx]));
      let r: number, g: number, b: number;

      if (colorMode === 'palette') {
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      } else {
        // gradient: first → last palette color
        r = (c0[0] + (cLast[0] - c0[0]) * t) | 0;
        g = (c0[1] + (cLast[1] - c0[1]) * t) | 0;
        b = (c0[2] + (cLast[2] - c0[2]) * t) | 0;
      }

      const idx = (py * w + px) * 4;
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
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
    type: 'number', min: 32, max: 256, step: 16, default: 96,
    group: 'Composition',
  },
  vortexCount: {
    name: 'Vortex Count',
    type: 'number', min: 1, max: 12, step: 1, default: 4,
    help: 'Number of seeded point vortices driving the flow',
    group: 'Composition',
  },
  sourceCount: {
    name: 'Source Count',
    type: 'number', min: 1, max: 8, step: 1, default: 2,
    help: 'Number of density injection points',
    group: 'Composition',
  },
  diffusion: {
    name: 'Diffusion',
    type: 'number', min: 0.0, max: 0.5, step: 0.01, default: 0.05,
    help: 'Density spread rate per step',
    group: 'Texture',
  },
  decay: {
    name: 'Decay',
    type: 'number', min: 0.90, max: 0.999, step: 0.001, default: 0.98,
    help: 'Density decay multiplier per step — lower = shorter trails',
    group: 'Texture',
  },
  injectAmount: {
    name: 'Inject Amount',
    type: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.12,
    help: 'Density added at each source per frame',
    group: 'Flow/Motion',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 10, step: 1, default: 3,
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['gradient', 'palette'],
    default: 'gradient',
    help: 'gradient: two-colour density map | palette: full palette colour range',
    group: 'Color',
  },
};

export const fluidLite: Generator = {
  id: 'cellular-fluid-lite',
  family: 'cellular',
  styleName: 'Fluid Lite',
  definition: 'Lightweight 2D fluid simulation — point-vortex velocity field advects a dye density on a periodic grid, producing swirling ink-in-water patterns',
  algorithmNotes:
    'Velocity at each grid point is summed analytically from N seeded point vortices (Biot–Savart in 2D: u = −Γ·Δy/(2π·r²), v = Γ·Δx/(2π·r²)). A passive scalar (dye density) is advected backwards along this field each step, then diffused with 2 Jacobi iterations, decayed, and replenished at fixed source points. The result is a pressure-free incompressible-like flow without any Poisson solve.',
  parameterSchema,
  defaultParams: {
    gridSize: 96, vortexCount: 4, sourceCount: 2,
    diffusion: 0.05, decay: 0.98, injectAmount: 0.12,
    stepsPerFrame: 3, colorMode: 'gradient',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 96) | 0);
    const vortexCount = Math.max(1, (params.vortexCount ?? 4) | 0);
    const sourceCount = Math.max(1, (params.sourceCount ?? 2) | 0);
    const diffusion = params.diffusion ?? 0.05;
    const decay = params.decay ?? 0.98;
    const inject = params.injectAmount ?? 0.12;
    const colorMode = params.colorMode || 'gradient';
    const dt = 1.0;

    if (time === 0) {
      const { d, d0, vortices, sources } = initFluid(seed, size, vortexCount, sourceCount);
      for (let s = 0; s < 200; s++) stepFluid(d, d0, size, vortices, sources, dt, diffusion, decay, inject);
      renderFluid(ctx, d, size, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}|${vortexCount}|${sourceCount}`;
    if (!_fluidAnim || _fluidAnim.key !== key) {
      const { d, d0, vortices, sources } = initFluid(seed, size, vortexCount, sourceCount);
      _fluidAnim = { key, d, d0, size, vortices, sources };
    }

    const spf = Math.max(1, (params.stepsPerFrame ?? 3) | 0);
    for (let s = 0; s < spf; s++) {
      stepFluid(_fluidAnim.d, _fluidAnim.d0, _fluidAnim.size, _fluidAnim.vortices, _fluidAnim.sources, dt, diffusion, decay, inject);
    }
    renderFluid(ctx, _fluidAnim.d, _fluidAnim.size, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 96) ** 2 * (params.stepsPerFrame ?? 3) * (params.vortexCount ?? 4) * 0.01) | 0; },
};
