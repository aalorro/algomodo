import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return [r, g, b];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _rdAnim: {
  key: string;
  U: Float32Array;
  V: Float32Array;
  // Reusable scratch buffers — avoids allocation every frame
  nextU: Float32Array;
  nextV: Float32Array;
  size: number;
} | null = null;

function rdKey(
  seed: number, size: number,
  f: number, k: number, Du: number, Dv: number,
): string {
  return `${seed}|${size}|${f}|${k}|${Du}|${Dv}`;
}

function initRD(seed: number, gridSize: number) {
  const rng = new SeededRNG(seed);
  const N = gridSize * gridSize;
  const U = new Float32Array(N).fill(1);
  const V = new Float32Array(N).fill(0);

  const patchCount = Math.floor(rng.range(3, 12));
  for (let p = 0; p < patchCount; p++) {
    const cx = Math.floor(rng.random() * gridSize);
    const cy = Math.floor(rng.random() * gridSize);
    const r = Math.floor(rng.range(2, 6));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = (cx + dx + gridSize) % gridSize;
        const ny = (cy + dy + gridSize) % gridSize;
        const idx = ny * gridSize + nx;
        V[idx] = 1; U[idx] = 0;
      }
    }
  }
  return { U, V };
}

function stepRD(
  U: Float32Array, V: Float32Array,
  nextU: Float32Array, nextV: Float32Array,
  gridSize: number,
  f: number, k: number, Du: number, Dv: number,
): void {
  for (let y = 0; y < gridSize; y++) {
    const yp = ((y + 1) % gridSize) * gridSize;
    const ym = ((y - 1 + gridSize) % gridSize) * gridSize;
    const yc = y * gridSize;
    for (let x = 0; x < gridSize; x++) {
      const idx = yc + x;
      const xp = (x + 1) % gridSize;
      const xm = (x - 1 + gridSize) % gridSize;
      const u = U[idx], v = V[idx];
      const lapU = U[yc + xp] + U[yc + xm] + U[yp + x] + U[ym + x] - 4 * u;
      const lapV = V[yc + xp] + V[yc + xm] + V[yp + x] + V[ym + x] - 4 * v;
      const uvv = u * v * v;
      nextU[idx] = Math.max(0, Math.min(1, u + Du * lapU - uvv + f * (1 - u)));
      nextV[idx] = Math.max(0, Math.min(1, v + Dv * lapV + uvv - (f + k) * v));
    }
  }
  U.set(nextU);
  V.set(nextV);
}

function renderV(
  ctx: CanvasRenderingContext2D,
  V: Float32Array,
  gridSize: number,
  params: Record<string, any>,
  palette: { colors: string[] },
): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  const colors = palette.colors.map(hexToRgb);
  const colorMode = params.colorMode || 'Gradient';
  const c0 = colors[0] || [0, 0, 0];
  const cLast = colors[colors.length - 1] || [255, 255, 255];

  for (let py = 0; py < height; py++) {
    const gy = Math.min(gridSize - 1, Math.floor((py / height) * gridSize));
    for (let px = 0; px < width; px++) {
      const gx = Math.min(gridSize - 1, Math.floor((px / width) * gridSize));
      const t = V[gy * gridSize + gx];
      let r: number, g: number, b: number;

      if (colorMode === 'Threshold') {
        const ci = t > 0.25 ? 1 : 0;
        [r, g, b] = colors[ci % colors.length];
      } else if (colorMode === 'Palette') {
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac;
        g = colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac;
        b = colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac;
      } else {
        r = c0[0] + (cLast[0] - c0[0]) * t;
        g = c0[1] + (cLast[1] - c0[1]) * t;
        b = c0[2] + (cLast[2] - c0[2]) * t;
      }

      const idx = (py * width + px) * 4;
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  feedRate: {
    name: 'Feed Rate',
    type: 'number', min: 0.01, max: 0.08, step: 0.001, default: 0.035,
    help: 'Rate at which U chemical is replenished',
    group: 'Composition',
  },
  killRate: {
    name: 'Kill Rate',
    type: 'number', min: 0.045, max: 0.075, step: 0.001, default: 0.065,
    help: 'Rate at which V chemical is removed',
    group: 'Composition',
  },
  diffU: {
    name: 'Diffusion U',
    type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 0.8,
    help: 'Diffusion rate of U chemical',
    group: 'Texture',
  },
  diffV: {
    name: 'Diffusion V',
    type: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.3,
    help: 'Diffusion rate of V chemical',
    group: 'Texture',
  },
  iterations: {
    name: 'Iterations',
    type: 'number', min: 50, max: 2000, step: 50, default: 500,
    help: 'Simulation steps (static / non-animated render only)',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['Gradient', 'Palette', 'Threshold'],
    default: 'Gradient',
    help: 'How V concentration is mapped to colour',
    group: 'Color',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 20, step: 1, default: 8,
    help: 'Simulation steps advanced per animation frame — higher = faster pattern evolution',
    group: 'Flow/Motion',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const reactionDiffusion: Generator = {
  id: 'reaction-diffusion',
  family: 'cellular',
  styleName: 'Reaction Diffusion',
  definition: 'Gray-Scott model producing organic Turing-like patterns with live animation',
  algorithmNotes:
    'dU/dt = Du·∇²U − U·V² + f·(1−U), dV/dt = Dv·∇²V + U·V² − (f+k)·V. In animation mode U/V grids persist between frames and advance by stepsPerFrame each call — patterns grow, divide, and drift in real time. Changing feed/kill rates reinitialises the grid so you can watch new pattern types emerge from scratch.',
  parameterSchema,
  defaultParams: {
    feedRate: 0.035, killRate: 0.065, diffU: 0.8, diffV: 0.3,
    iterations: 500, colorMode: 'Gradient', stepsPerFrame: 8,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const gridSize = quality === 'draft' ? 64 : quality === 'ultra' ? 256 : 128;
    const f = params.feedRate;
    const k = params.killRate;
    const Du = params.diffU;
    const Dv = params.diffV;

    // ── Static render (original batch path) ──────────────────────────────
    if (time === 0) {
      clearCanvas(ctx, width, height, '#000000');
      const { U, V } = initRD(seed, gridSize);
      const N = gridSize * gridSize;
      const nextU = new Float32Array(N);
      const nextV = new Float32Array(N);
      const iterations = Math.floor(params.iterations);
      for (let iter = 0; iter < iterations; iter++) {
        stepRD(U, V, nextU, nextV, gridSize, f, k, Du, Dv);
      }
      renderV(ctx, V, gridSize, params, palette);
      return;
    }

    // ── Animation mode: persistent state ─────────────────────────────────
    const key = rdKey(seed, gridSize, f, k, Du, Dv);
    if (!_rdAnim || _rdAnim.key !== key) {
      const { U, V } = initRD(seed, gridSize);
      const N = gridSize * gridSize;
      _rdAnim = { key, U, V, nextU: new Float32Array(N), nextV: new Float32Array(N), size: gridSize };
    }

    const stepsPerFrame = Math.max(1, (params.stepsPerFrame ?? 8) | 0);
    for (let s = 0; s < stepsPerFrame; s++) {
      stepRD(_rdAnim.U, _rdAnim.V, _rdAnim.nextU, _rdAnim.nextV, _rdAnim.size, f, k, Du, Dv);
    }

    renderV(ctx, _rdAnim.V, _rdAnim.size, params, palette);
  },

  renderWebGL2(gl) {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return params.iterations * 200;
  },
};
