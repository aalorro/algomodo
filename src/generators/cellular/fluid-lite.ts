import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
interface Vortex { x: number; y: number; gamma: number; }
interface Source { x: number; y: number; channel: number; }

let _fluidAnim: {
  key: string;
  // Single-channel density
  d: Float32Array; d0: Float32Array;
  // Multi-channel RGB dye (always allocated; used when dyeChannels === 'multi')
  dr: Float32Array; dg: Float32Array; db: Float32Array;
  dr0: Float32Array; dg0: Float32Array; db0: Float32Array;
  // Temperature for buoyancy
  t: Float32Array; t0: Float32Array;
  size: number;
  vortices: Vortex[];
  sources: Source[];
  noise: SimplexNoise;
  time: number;
} | null = null;

function initFluid(seed: number, size: number, vortexCount: number, sourceCount: number, velocityScale: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const d = new Float32Array(N), d0 = new Float32Array(N);
  const dr = new Float32Array(N), dg = new Float32Array(N), db = new Float32Array(N);
  const dr0 = new Float32Array(N), dg0 = new Float32Array(N), db0 = new Float32Array(N);
  const t = new Float32Array(N), t0 = new Float32Array(N);

  const vortices: Vortex[] = [];
  for (let i = 0; i < vortexCount; i++) {
    vortices.push({
      x: rng.random() * size,
      y: rng.random() * size,
      gamma: (rng.random() - 0.5) * 2 * 5.0 * velocityScale,
    });
  }

  const sources: Source[] = [];
  for (let i = 0; i < sourceCount; i++) {
    sources.push({
      x: rng.range(size * 0.1, size * 0.9),
      y: rng.range(size * 0.1, size * 0.9),
      channel: i % 3,
    });
  }

  const noise = new SimplexNoise(seed ^ 0xF00DCAFE);
  return { d, d0, dr, dg, db, dr0, dg0, db0, t, t0, vortices, sources, noise };
}

// ---------------------------------------------------------------------------
// Velocity from point vortices (Biot-Savart 2D)
// Includes periodic nearest-image correction
// ---------------------------------------------------------------------------
function velocityFromVortices(
  px: number, py: number, vortices: Vortex[], size: number,
  excludeIdx = -1,
): [number, number] {
  let u = 0, v = 0;
  for (let i = 0; i < vortices.length; i++) {
    if (i === excludeIdx) continue;
    const vt = vortices[i];
    let dx = px - vt.x, dy = py - vt.y;
    // Nearest-image periodic correction
    if (dx > size * 0.5) dx -= size;
    else if (dx < -size * 0.5) dx += size;
    if (dy > size * 0.5) dy -= size;
    else if (dy < -size * 0.5) dy += size;
    const r2 = Math.max(1, dx * dx + dy * dy);
    const fac = vt.gamma / (2 * Math.PI * r2);
    u += -dy * fac;
    v +=  dx * fac;
  }
  return [u, v];
}

// ---------------------------------------------------------------------------
// Curl noise — divergence-free turbulent velocity from curl of simplex noise
// The noise field evolves by shifting the sample offset with time
// ---------------------------------------------------------------------------
function curlNoise(
  noise: SimplexNoise, x: number, y: number, timeOffset: number,
  freq: number, amp: number,
): [number, number] {
  if (amp <= 0) return [0, 0];
  const eps = 0.5;
  const xf = x * freq, yf = y * freq;
  const t = timeOffset * 0.008;
  const dny = noise.noise2D(xf + t,       yf + eps + t * 0.3)
             - noise.noise2D(xf + t,       yf - eps + t * 0.3);
  const dnx = noise.noise2D(xf + eps + t, yf       + t * 0.3)
             - noise.noise2D(xf - eps + t, yf       + t * 0.3);
  return [(dny / (2 * eps)) * amp, (-dnx / (2 * eps)) * amp];
}

// ---------------------------------------------------------------------------
// Bilinear sample with periodic wrap
// ---------------------------------------------------------------------------
function samplePeriodic(f: Float32Array, x: number, y: number, size: number): number {
  const x0 = ((Math.floor(x) % size) + size) % size;
  const y0 = ((Math.floor(y) % size) + size) % size;
  const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  return (
    f[y0 * size + x0] * (1 - fx) * (1 - fy) +
    f[y0 * size + x1] * fx       * (1 - fy) +
    f[y1 * size + x0] * (1 - fx) * fy       +
    f[y1 * size + x1] * fx       * fy
  );
}

// ---------------------------------------------------------------------------
// Vortex mutual dynamics — each vortex moves under induction from all others
// ---------------------------------------------------------------------------
function moveVorticesDynamic(vortices: Vortex[], size: number): void {
  const n = vortices.length;
  if (n < 2) return;
  const us = new Float32Array(n);
  const vs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [u, v] = velocityFromVortices(vortices[i].x, vortices[i].y, vortices, size, i);
    us[i] = u; vs[i] = v;
  }
  for (let i = 0; i < n; i++) {
    vortices[i].x = ((vortices[i].x + us[i] * 0.08) % size + size) % size;
    vortices[i].y = ((vortices[i].y + vs[i] * 0.08) % size + size) % size;
  }
}

// ---------------------------------------------------------------------------
// Advect a single scalar field backwards along velocity
// ---------------------------------------------------------------------------
function advectField(
  dst: Float32Array, src: Float32Array,
  size: number, vortices: Vortex[],
  noise: SimplexNoise, time: number, turbAmp: number, turbScale: number,
  dt: number,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [u0, v0] = velocityFromVortices(x + 0.5, y + 0.5, vortices, size);
      const [ut, vt] = curlNoise(noise, x + 0.5, y + 0.5, time, turbScale / size, turbAmp);
      const srcX = x - (u0 + ut) * dt;
      const srcY = y - (v0 + vt) * dt;
      dst[y * size + x] = samplePeriodic(src, srcX, srcY, size);
    }
  }
}

// ---------------------------------------------------------------------------
// Jacobi diffusion (2 iterations)
// ---------------------------------------------------------------------------
function diffuseField(f: Float32Array, scratch: Float32Array, size: number, alpha: number): void {
  for (let iter = 0; iter < 2; iter++) {
    for (let y = 0; y < size; y++) {
      const yp = ((y + 1) % size) * size, ym = ((y - 1 + size) % size) * size, yc = y * size;
      for (let x = 0; x < size; x++) {
        const xp = (x + 1) % size, xm = (x - 1 + size) % size;
        scratch[yc + x] = (f[yc + x] + alpha * (f[yc + xp] + f[yc + xm] + f[yp + x] + f[ym + x])) / (1 + 4 * alpha);
      }
    }
    f.set(scratch);
  }
}

// ---------------------------------------------------------------------------
// Step fluid simulation
// ---------------------------------------------------------------------------
function stepFluid(
  d: Float32Array, d0: Float32Array,
  dr: Float32Array, dg: Float32Array, db: Float32Array,
  dr0: Float32Array, dg0: Float32Array, db0: Float32Array,
  t: Float32Array, t0: Float32Array,
  size: number, vortices: Vortex[], sources: Source[],
  dt: number, diffusion: number, decay: number, inject: number,
  vortexDynamics: boolean, densityMode: string, buoyancy: number,
  turbulence: number, turbScale: number, multiDye: boolean,
  noise: SimplexNoise, time: number,
): void {
  const N = size * size;

  // Vortex mutual dynamics (Biot-Savart N-body)
  if (vortexDynamics) moveVorticesDynamic(vortices, size);

  if (multiDye) {
    // Advect 3 separate dye channels
    advectField(dr0, dr, size, vortices, noise, time, turbulence, turbScale, dt); dr.set(dr0);
    advectField(dg0, dg, size, vortices, noise, time, turbulence, turbScale, dt); dg.set(dg0);
    advectField(db0, db, size, vortices, noise, time, turbulence, turbScale, dt); db.set(db0);
    diffuseField(dr, dr0, size, diffusion);
    diffuseField(dg, dg0, size, diffusion);
    diffuseField(db, db0, size, diffusion);
    for (let i = 0; i < N; i++) { dr[i] *= decay; dg[i] *= decay; db[i] *= decay; }
    for (const src of sources) {
      const x = Math.floor(src.x), y = Math.floor(src.y);
      for (let dy2 = -1; dy2 <= 1; dy2++) {
        for (let dx2 = -1; dx2 <= 1; dx2++) {
          const nx = ((x + dx2) % size + size) % size;
          const ny = ((y + dy2) % size + size) % size;
          const ni = ny * size + nx;
          const ch = src.channel;
          const target = ch === 0 ? dr : ch === 1 ? dg : db;
          if (densityMode === 'additive') target[ni] = Math.min(1, target[ni] + inject);
          else target[ni] = Math.max(target[ni], inject);
        }
      }
    }
  } else {
    // Single-channel density
    advectField(d0, d, size, vortices, noise, time, turbulence, turbScale, dt); d.set(d0);
    diffuseField(d, d0, size, diffusion);
    for (let i = 0; i < N; i++) d[i] *= decay;
    for (const src of sources) {
      const x = Math.floor(src.x), y = Math.floor(src.y);
      for (let dy2 = -1; dy2 <= 1; dy2++) {
        for (let dx2 = -1; dx2 <= 1; dx2++) {
          const nx = ((x + dx2) % size + size) % size;
          const ny = ((y + dy2) % size + size) % size;
          const ni = ny * size + nx;
          if (densityMode === 'additive') d[ni] = Math.min(1, d[ni] + inject);
          else d[ni] = Math.max(d[ni], inject);
        }
      }
    }
  }

  // Temperature / buoyancy
  if (buoyancy > 0) {
    advectField(t0, t, size, vortices, noise, time, 0, 1, dt); t.set(t0);
    diffuseField(t, t0, size, diffusion);
    for (let i = 0; i < N; i++) t[i] *= decay;
    for (const src of sources) {
      const x = Math.floor(src.x), y = Math.floor(src.y);
      for (let dy2 = -1; dy2 <= 1; dy2++) {
        for (let dx2 = -1; dx2 <= 1; dx2++) {
          const nx = ((x + dx2) % size + size) % size;
          const ny = ((y + dy2) % size + size) % size;
          t[ny * size + nx] = Math.min(1, t[ny * size + nx] + 0.15);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderFluid(
  ctx: CanvasRenderingContext2D,
  d: Float32Array, dr: Float32Array, dg: Float32Array, db: Float32Array,
  t: Float32Array, size: number,
  colorMode: string, palette: { colors: string[] }, buoyancy: number, multiDye: boolean,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const c0 = colors[0] || [0, 0, 30];
  const cLast = colors[colors.length - 1] || [255, 200, 100];
  // For multi-dye: pick 3 evenly spaced palette colors as channel tints
  const cR = colors[0] || [255, 60, 30];
  const cG = colors[Math.floor(colors.length * 0.5)] || [30, 255, 100];
  const cB = colors[colors.length - 1] || [30, 100, 255];

  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let py = 0; py < h; py++) {
    const gy = Math.min(size - 1, (py / h * size) | 0);
    for (let px = 0; px < w; px++) {
      const gx = Math.min(size - 1, (px / w * size) | 0);
      const idx = gy * size + gx;
      let r: number, g: number, b: number;

      if (multiDye) {
        const vr = Math.max(0, Math.min(1, dr[idx]));
        const vg = Math.max(0, Math.min(1, dg[idx]));
        const vb = Math.max(0, Math.min(1, db[idx]));
        r = Math.min(255, (vr * cR[0] + vg * cG[0] + vb * cB[0]) | 0);
        g = Math.min(255, (vr * cR[1] + vg * cG[1] + vb * cB[1]) | 0);
        b = Math.min(255, (vr * cR[2] + vg * cG[2] + vb * cB[2]) | 0);
      } else {
        let density = Math.max(0, Math.min(1, d[idx]));
        if (buoyancy > 0) density = Math.max(density, Math.max(0, Math.min(1, t[idx])) * buoyancy);

        if (colorMode === 'palette') {
          const scaled = density * (colors.length - 1);
          const i0 = Math.floor(scaled);
          const i1 = Math.min(colors.length - 1, i0 + 1);
          const frac = scaled - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
        } else {
          r = (c0[0] + (cLast[0] - c0[0]) * density) | 0;
          g = (c0[1] + (cLast[1] - c0[1]) * density) | 0;
          b = (c0[2] + (cLast[2] - c0[2]) * density) | 0;
        }
      }

      const pi = (py * w + px) * 4;
      data[pi] = r; data[pi + 1] = g; data[pi + 2] = b; data[pi + 3] = 255;
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
    type: 'number', min: 1, max: 12, step: 1, default: 5,
    help: 'Number of seeded point vortices driving the flow',
    group: 'Composition',
  },
  sourceCount: {
    name: 'Source Count',
    type: 'number', min: 1, max: 8, step: 1, default: 3,
    help: 'Number of density injection points',
    group: 'Composition',
  },
  velocityScale: {
    name: 'Velocity Scale',
    type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 1.2,
    help: 'Overall flow intensity — scales vortex circulation strength',
    group: 'Flow/Motion',
  },
  vortexDynamics: {
    name: 'Vortex Dynamics',
    type: 'select',
    options: ['on', 'off'],
    default: 'on',
    help: 'on: vortices orbit and interact via mutual Biot-Savart induction (chaotic N-body) | off: vortices remain fixed',
    group: 'Flow/Motion',
  },
  turbulence: {
    name: 'Turbulence',
    type: 'number', min: 0, max: 3.0, step: 0.1, default: 0.8,
    help: 'Amplitude of curl-noise turbulent velocity — adds small-scale chaotic eddies on top of vortex flow',
    group: 'Flow/Motion',
  },
  turbScale: {
    name: 'Turb. Scale',
    type: 'number', min: 0.5, max: 8.0, step: 0.5, default: 3.0,
    help: 'Spatial frequency of turbulence noise — lower = large swirls, higher = fine-grain chaos',
    group: 'Flow/Motion',
  },
  diffusion: {
    name: 'Diffusion',
    type: 'number', min: 0.0, max: 0.5, step: 0.01, default: 0.04,
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
  densityMode: {
    name: 'Density Mode',
    type: 'select',
    options: ['additive', 'maximum'],
    default: 'additive',
    help: 'additive: accumulate density | maximum: take max of current and injected',
    group: 'Texture',
  },
  dyeChannels: {
    name: 'Dye Channels',
    type: 'select',
    options: ['single', 'multi'],
    default: 'single',
    help: 'single: one density field coloured by palette | multi: 3 RGB dye channels injected at different sources and composited',
    group: 'Color',
  },
  buoyancy: {
    name: 'Buoyancy',
    type: 'number', min: 0, max: 1.0, step: 0.05, default: 0,
    help: 'Enable temperature-driven buoyancy — creates rising plumes (single dye mode only)',
    group: 'Texture',
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
    help: 'gradient: two-colour density map | palette: full palette colour range (single dye only)',
    group: 'Color',
  },
};

export const fluidLite: Generator = {
  id: 'cellular-fluid-lite',
  family: 'cellular',
  styleName: 'Fluid Lite',
  definition: 'Lightweight 2D fluid with N-body vortex dynamics and curl-noise turbulence — point vortices evolve under mutual Biot-Savart induction, curl noise adds chaotic eddies, and multi-channel dye produces vivid swirling colour mixing',
  algorithmNotes:
    'Velocity at each grid point is summed analytically from N point vortices (Biot–Savart 2D). When vortex dynamics is on, each vortex moves under induction from all other vortices (N-body, nearest-image periodic), creating chaotic orbiting behaviour. Curl noise — the curl of time-evolving 2D simplex noise — adds a divergence-free turbulent perturbation at each advection step. A passive scalar (dye) is advected backwards along the combined velocity field, then diffused with 2 Jacobi iterations, decayed, and replenished at source points. Multi-channel mode tracks separate R/G/B dye fields per source and additively composites them using palette colours.',
  parameterSchema,
  defaultParams: {
    gridSize: 96, vortexCount: 5, sourceCount: 3,
    velocityScale: 1.2, vortexDynamics: 'on',
    turbulence: 0.8, turbScale: 3.0,
    diffusion: 0.04, decay: 0.98, injectAmount: 0.12,
    densityMode: 'additive', buoyancy: 0,
    dyeChannels: 'single',
    stepsPerFrame: 3, colorMode: 'gradient',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 96) | 0);
    const vortexCount = Math.max(1, (params.vortexCount ?? 5) | 0);
    const sourceCount = Math.max(1, (params.sourceCount ?? 3) | 0);
    const velocityScale = params.velocityScale ?? 1.2;
    const vortexDynamics = (params.vortexDynamics ?? 'on') === 'on';
    const diffusion = params.diffusion ?? 0.04;
    const decay = params.decay ?? 0.98;
    const inject = params.injectAmount ?? 0.12;
    const densityMode = params.densityMode ?? 'additive';
    const buoyancy = params.buoyancy ?? 0;
    const turbulence = params.turbulence ?? 0.8;
    const turbScale = params.turbScale ?? 3.0;
    const colorMode = params.colorMode || 'gradient';
    const multiDye = (params.dyeChannels ?? 'single') === 'multi';
    const dt = 1.0;

    if (time === 0) {
      const { d, d0, dr, dg, db, dr0, dg0, db0, t, t0, vortices, sources, noise } =
        initFluid(seed, size, vortexCount, sourceCount, velocityScale);
      for (let s = 0; s < 200; s++)
        stepFluid(d, d0, dr, dg, db, dr0, dg0, db0, t, t0, size, vortices, sources, dt, diffusion, decay, inject, vortexDynamics, densityMode, buoyancy, turbulence, turbScale, multiDye, noise, s);
      renderFluid(ctx, d, dr, dg, db, t, size, colorMode, palette, buoyancy, multiDye);
      return;
    }

    const key = `${seed}|${size}|${vortexCount}|${sourceCount}|${velocityScale}|${multiDye}`;
    if (!_fluidAnim || _fluidAnim.key !== key) {
      const init = initFluid(seed, size, vortexCount, sourceCount, velocityScale);
      _fluidAnim = { key, ...init, time: 0 };
    }

    const spf = Math.max(1, (params.stepsPerFrame ?? 3) | 0);
    for (let s = 0; s < spf; s++) {
      stepFluid(
        _fluidAnim.d, _fluidAnim.d0,
        _fluidAnim.dr, _fluidAnim.dg, _fluidAnim.db,
        _fluidAnim.dr0, _fluidAnim.dg0, _fluidAnim.db0,
        _fluidAnim.t, _fluidAnim.t0,
        _fluidAnim.size, _fluidAnim.vortices, _fluidAnim.sources,
        dt, diffusion, decay, inject, vortexDynamics, densityMode, buoyancy,
        turbulence, turbScale, multiDye, _fluidAnim.noise, _fluidAnim.time,
      );
      _fluidAnim.time++;
    }
    renderFluid(ctx, _fluidAnim.d, _fluidAnim.dr, _fluidAnim.dg, _fluidAnim.db, _fluidAnim.t, _fluidAnim.size, colorMode, palette, buoyancy, multiDye);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    return ((params.gridSize ?? 96) ** 2 * (params.stepsPerFrame ?? 3) * (params.vortexCount ?? 5) * 0.012) | 0;
  },
};
