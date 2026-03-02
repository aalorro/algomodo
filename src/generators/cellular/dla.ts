import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _dlaAnim: {
  key: string;
  grid: Uint32Array;   // 0 = empty, n = arrival order (1-based)
  size: number;
  rng: SeededRNG;
  count: number;
  maxRadius: number;
} | null = null;

function initDLA(seed: number, size: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint32Array(N);
  const cx = (size / 2) | 0, cy = (size / 2) | 0;
  grid[cy * size + cx] = 1;
  return { grid, rng, count: 1, maxRadius: 1 };
}

// Try to add one particle. Spawns on a circle just outside the current aggregate,
// random-walks until it touches the aggregate (stick) or strays too far (discard).
// Returns the arrival-order index if stuck, 0 if not.
function addParticle(
  grid: Uint32Array, size: number, rng: SeededRNG,
  maxRadius: number, stickProb: number, maxSteps: number,
  arrivalOrder: number,
): { stuck: boolean; newMaxRadius: number } {
  const cx = size / 2, cy = size / 2;
  const spawnR = Math.min(size * 0.47, maxRadius + 6);
  const killR2 = (spawnR + 8) ** 2;

  // Spawn on circle
  const angle = rng.random() * Math.PI * 2;
  let x = Math.round(cx + spawnR * Math.cos(angle));
  let y = Math.round(cy + spawnR * Math.sin(angle));
  x = Math.max(1, Math.min(size - 2, x));
  y = Math.max(1, Math.min(size - 2, y));

  for (let step = 0; step < maxSteps; step++) {
    // Skip if already occupied (spawn overlap)
    if (grid[y * size + x]) {
      const a2 = rng.random() * Math.PI * 2;
      x = Math.round(cx + spawnR * Math.cos(a2));
      y = Math.round(cy + spawnR * Math.sin(a2));
      x = Math.max(1, Math.min(size - 2, x));
      y = Math.max(1, Math.min(size - 2, y));
      continue;
    }

    // Check 4-connected adjacency to aggregate
    const adj =
      grid[(y - 1) * size + x] || grid[(y + 1) * size + x] ||
      grid[y * size + x - 1]   || grid[y * size + x + 1];

    if (adj && rng.random() < stickProb) {
      grid[y * size + x] = arrivalOrder;
      const dr = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      return { stuck: true, newMaxRadius: Math.max(maxRadius, dr) };
    }

    // Random walk (4-connected)
    const dir = (rng.random() * 4) | 0;
    if (dir === 0) y = Math.max(1, y - 1);
    else if (dir === 1) y = Math.min(size - 2, y + 1);
    else if (dir === 2) x = Math.max(1, x - 1);
    else               x = Math.min(size - 2, x + 1);

    // Kill if too far from centre
    const dx = x - cx, dy2 = y - cy;
    if (dx * dx + dy2 * dy2 > killR2) break;
  }
  return { stuck: false, newMaxRadius: maxRadius };
}

function renderDLA(
  ctx: CanvasRenderingContext2D,
  grid: Uint32Array, size: number, maxCount: number,
  colorMode: string, palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cBg: [number, number, number] = [8, 8, 12];
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let py = 0; py < h; py++) {
    const gy = Math.min(size - 1, (py / h * size) | 0);
    for (let px = 0; px < w; px++) {
      const gx = Math.min(size - 1, (px / w * size) | 0);
      const order = grid[gy * size + gx];
      let r: number, g: number, b: number;

      if (!order) {
        [r, g, b] = cBg;
      } else if (colorMode === 'arrival') {
        // First stuck = first palette color, last = last
        const t = maxCount > 1 ? (order - 1) / (maxCount - 1) : 0;
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      } else {
        // monochrome: last palette color
        [r, g, b] = colors[colors.length - 1];
      }

      const idx = (py * w + px) * 4;
      d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
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
  targetParticles: {
    name: 'Target Particles',
    type: 'number', min: 100, max: 8000, step: 100, default: 3000,
    help: 'Number of particles to grow in the static render',
    group: 'Composition',
  },
  particlesPerFrame: {
    name: 'Particles / Frame',
    type: 'number', min: 1, max: 50, step: 1, default: 8,
    help: 'New particles attempted per animation frame',
    group: 'Flow/Motion',
  },
  stickProbability: {
    name: 'Stick Probability',
    type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 1.0,
    help: 'Probability a touching walker sticks — below 1.0 rounds branch tips, producing denser clusters',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['arrival', 'monochrome'],
    default: 'arrival',
    help: 'arrival: palette gradient by order of sticking (centre = first palette color) | monochrome: uniform last palette color',
    group: 'Color',
  },
};

export const dla: Generator = {
  id: 'cellular-dla',
  family: 'cellular',
  styleName: 'DLA',
  definition: 'Diffusion-Limited Aggregation — random-walking particles that freeze on contact with a growing cluster, producing fractal trees with dimension ≈ 1.71',
  algorithmNotes:
    'A seed particle is placed at the centre. New particles spawn on a circle just outside the current aggregate radius, random-walk until they touch the aggregate (and stick with probability stickProb) or wander too far (and are discarded). The resulting fractal has Hausdorff dimension ≈ 1.71 and exhibits self-similar branching at all scales. Stick probability below 1 allows particles to "slide" before sticking, producing denser, more rounded clusters.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, targetParticles: 3000, particlesPerFrame: 8,
    stickProbability: 1.0, colorMode: 'arrival',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const stickProb = Math.max(0.01, Math.min(1, params.stickProbability ?? 1.0));
    const colorMode = params.colorMode || 'arrival';
    const maxStepsPerWalker = 2000;

    if (time === 0) {
      const { grid, rng } = initDLA(seed, size);
      let count = 1, maxRadius = 1;
      const target = Math.max(1, (params.targetParticles ?? 3000) | 0);
      while (count < target) {
        const res = addParticle(grid, size, rng, maxRadius, stickProb, maxStepsPerWalker, count + 1);
        if (res.stuck) { count++; maxRadius = res.newMaxRadius; }
      }
      renderDLA(ctx, grid, size, count, colorMode, palette);
      return;
    }

    const key = `${seed}|${size}`;
    if (!_dlaAnim || _dlaAnim.key !== key) {
      const { grid, rng } = initDLA(seed, size);
      _dlaAnim = { key, grid, size, rng, count: 1, maxRadius: 1 };
    }
    const ppf = Math.max(1, (params.particlesPerFrame ?? 8) | 0);
    for (let p = 0; p < ppf; p++) {
      const res = addParticle(_dlaAnim.grid, _dlaAnim.size, _dlaAnim.rng, _dlaAnim.maxRadius, stickProb, maxStepsPerWalker, _dlaAnim.count + 1);
      if (res.stuck) { _dlaAnim.count++; _dlaAnim.maxRadius = res.newMaxRadius; }
      // Stop growing when aggregate fills the spawn radius limit
      if (_dlaAnim.maxRadius >= _dlaAnim.size * 0.45) break;
    }
    renderDLA(ctx, _dlaAnim.grid, _dlaAnim.size, _dlaAnim.count, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.targetParticles ?? 3000) * 0.5) | 0; },
};
