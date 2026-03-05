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
  grid: Uint32Array;
  size: number;
  rng: SeededRNG;
  count: number;
  maxRadius: number; // for center mode: radius of aggregate; for line mode: top-most y reached
  seedMode: string;
} | null = null;

// ---------------------------------------------------------------------------
// Initialise grid for different seed modes
// ---------------------------------------------------------------------------
function initDLA(seed: number, size: number, seedMode: string, scatterSeeds: number) {
  const rng = new SeededRNG(seed);
  const N = size * size;
  const grid = new Uint32Array(N);
  let count = 0;
  let maxRadius = 1;

  if (seedMode === 'line-bottom') {
    // Seed: entire bottom row is aggregate
    for (let x = 0; x < size; x++) grid[(size - 1) * size + x] = ++count;
    maxRadius = size - 1; // tracks top-most y reached (starts at bottom row)
  } else if (seedMode === 'scatter') {
    // Seed: N random interior points
    for (let i = 0; i < scatterSeeds; i++) {
      const x = rng.range(size * 0.15, size * 0.85) | 0;
      const y = rng.range(size * 0.15, size * 0.85) | 0;
      const idx = y * size + x;
      if (!grid[idx]) { grid[idx] = ++count; }
    }
    // maxRadius tracks distance from grid center to furthest stuck particle
    maxRadius = size * 0.15;
  } else {
    // center: single pixel at centre
    const cx = (size / 2) | 0, cy = (size / 2) | 0;
    grid[cy * size + cx] = ++count;
    maxRadius = 1;
  }

  return { grid, rng, count, maxRadius };
}

// ---------------------------------------------------------------------------
// Biased random walk step — returns [newX, newY]
// walkBias > 0 = drift downward (positive y direction), < 0 = drift upward
// ---------------------------------------------------------------------------
function biasedStep(
  x: number, y: number, rng: SeededRNG, walkBias: number, size: number,
): [number, number] {
  // Base probabilities; bias adjusts up/down balance
  const pDown = Math.max(0, 0.25 + walkBias * 0.25);
  const pUp   = Math.max(0, 0.25 - walkBias * 0.25);
  const pSide = (1 - pDown - pUp) / 2; // split remaining evenly left/right
  const r = rng.random();
  if (r < pDown)           return [x, Math.min(size - 2, y + 1)];
  if (r < pDown + pUp)     return [x, Math.max(1, y - 1)];
  if (r < pDown + pUp + pSide) return [(x - 1 + size) % size, y];
  return [(x + 1) % size, y];
}

// ---------------------------------------------------------------------------
// Add one particle in center / scatter mode (circular spawn)
// ---------------------------------------------------------------------------
function addParticleCenter(
  grid: Uint32Array, size: number, rng: SeededRNG,
  maxRadius: number, stickProb: number, tipBias: number, maxSteps: number,
  arrivalOrder: number, walkBias: number,
): { stuck: boolean; newMaxRadius: number } {
  const cx = size / 2, cy = size / 2;
  const spawnR = Math.min(size * 0.47, maxRadius + 6);
  const killR2 = (spawnR + 8) ** 2;

  const angle = rng.random() * Math.PI * 2;
  let x = Math.round(cx + spawnR * Math.cos(angle));
  let y = Math.round(cy + spawnR * Math.sin(angle));
  x = Math.max(1, Math.min(size - 2, x));
  y = Math.max(1, Math.min(size - 2, y));

  for (let step = 0; step < maxSteps; step++) {
    if (grid[y * size + x]) {
      // Overlapping occupied cell — respawn
      const a2 = rng.random() * Math.PI * 2;
      x = Math.round(cx + spawnR * Math.cos(a2));
      y = Math.round(cy + spawnR * Math.sin(a2));
      x = Math.max(1, Math.min(size - 2, x));
      y = Math.max(1, Math.min(size - 2, y));
      continue;
    }

    const adj =
      grid[(y - 1) * size + x] || grid[(y + 1) * size + x] ||
      grid[y * size + x - 1]   || grid[y * size + x + 1];

    if (adj) {
      // Tip-bias modulates stickiness by normalized radial position
      const dr = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const normR = maxRadius > 0 ? Math.min(1, dr / maxRadius) : 0;
      // tipBias > 0 → outer positions stickier; < 0 → inner stickier
      const effectiveStick = Math.max(0, Math.min(1, stickProb * (1 + tipBias * (2 * normR - 1))));
      if (rng.random() < effectiveStick) {
        grid[y * size + x] = arrivalOrder;
        return { stuck: true, newMaxRadius: Math.max(maxRadius, dr) };
      }
    }

    [x, y] = biasedStep(x, y, rng, walkBias, size);

    const dx = x - cx, dy2 = y - cy;
    if (dx * dx + dy2 * dy2 > killR2) break;
  }
  return { stuck: false, newMaxRadius: maxRadius };
}

// ---------------------------------------------------------------------------
// Add one particle in line-bottom mode (spawn near top, stick on the growing surface)
// ---------------------------------------------------------------------------
function addParticleLine(
  grid: Uint32Array, size: number, rng: SeededRNG,
  topY: number, stickProb: number, tipBias: number, maxSteps: number,
  arrivalOrder: number, walkBias: number,
): { stuck: boolean; newTopY: number } {
  // Spawn slightly above the current aggregate top
  let x = (rng.random() * size) | 0;
  let y = Math.max(1, topY - Math.max(3, (size * 0.06) | 0));

  if (grid[y * size + x]) {
    x = (rng.random() * size) | 0;
    y = Math.max(1, topY - Math.max(3, (size * 0.06) | 0));
  }

  for (let step = 0; step < maxSteps; step++) {
    if (y <= 0) break; // escaped top boundary

    const xL = (x - 1 + size) % size, xR = (x + 1) % size;
    const adj =
      (y > 0 && grid[(y - 1) * size + x]) ||
      grid[(y + 1) * size + x] ||
      grid[y * size + xL] ||
      grid[y * size + xR];

    if (adj) {
      // tipBias: height from bottom (size-1-y) normalized by aggregate height
      const heightFrac = topY < size - 1 ? (size - 1 - y) / (size - 1 - topY + 1) : 0;
      const effectiveStick = Math.max(0, Math.min(1, stickProb * (1 + tipBias * (2 * heightFrac - 1))));
      if (rng.random() < effectiveStick) {
        grid[y * size + x] = arrivalOrder;
        return { stuck: true, newTopY: Math.min(topY, y) };
      }
    }

    [x, y] = biasedStep(x, y, rng, walkBias, size);
    // Wrap x periodically, clamp y
    y = Math.max(0, Math.min(size - 1, y));
  }
  return { stuck: false, newTopY: topY };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderDLA(
  ctx: CanvasRenderingContext2D,
  grid: Uint32Array, size: number, maxCount: number,
  colorMode: string, palette: { colors: string[] },
  seedMode: string,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cBg: [number, number, number] = [8, 8, 12];
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cx = size / 2, cy = size / 2;

  for (let py = 0; py < h; py++) {
    const gy = Math.min(size - 1, (py / h * size) | 0);
    for (let px = 0; px < w; px++) {
      const gx = Math.min(size - 1, (px / w * size) | 0);
      const order = grid[gy * size + gx];
      let r: number, g: number, b: number;

      if (!order) {
        [r, g, b] = cBg;
      } else if (colorMode === 'arrival') {
        const t = maxCount > 1 ? (order - 1) / (maxCount - 1) : 0;
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      } else if (colorMode === 'radius') {
        // Distance from grid center (or from bottom for line mode), normalised to [0,1]
        let t: number;
        if (seedMode === 'line-bottom') {
          t = 1 - gy / (size - 1); // top of grid = 1 (far from seed), bottom = 0
        } else {
          const dr = Math.sqrt((gx - cx) ** 2 + (gy - cy) ** 2);
          t = Math.min(1, dr / (size * 0.5));
        }
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      } else {
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
  seedMode: {
    name: 'Seed Mode',
    type: 'select',
    options: ['center', 'line-bottom', 'scatter'],
    default: 'center',
    help: 'center: classic radial DLA from a central seed | line-bottom: aggregate grows upward from a full bottom-row seed, like a forest of stalactites | scatter: N random seeds create competing clusters',
    group: 'Composition',
  },
  scatterSeeds: {
    name: 'Scatter Seeds',
    type: 'number', min: 2, max: 16, step: 1, default: 5,
    help: 'Number of random seed points (scatter mode only)',
    group: 'Composition',
  },
  targetParticles: {
    name: 'Target Particles',
    type: 'number', min: 100, max: 8000, step: 100, default: 3000,
    help: 'Particles to grow in the static render',
    group: 'Composition',
  },
  particlesPerFrame: {
    name: 'Particles / Frame',
    type: 'number', min: 1, max: 50, step: 1, default: 8,
    help: 'Particles attempted per animation frame',
    group: 'Flow/Motion',
  },
  walkBias: {
    name: 'Walk Bias',
    type: 'number', min: -0.7, max: 0.7, step: 0.05, default: 0.0,
    help: 'Directional drift of random walkers — positive = downward gravity, negative = upward; at 0 the walk is isotropic',
    group: 'Flow/Motion',
  },
  stickProbability: {
    name: 'Stick Probability',
    type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 1.0,
    help: 'Base probability a touching walker sticks — below 1.0 rounds tips, producing denser clusters',
    group: 'Texture',
  },
  tipBias: {
    name: 'Tip Bias',
    type: 'number', min: -0.9, max: 0.9, step: 0.1, default: 0.0,
    help: 'Modulates stickiness by position — positive: outer tips stickier → longer, sparser arms; negative: inner positions stickier → denser, rounder core',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['arrival', 'radius', 'monochrome'],
    default: 'arrival',
    help: 'arrival: palette by order of sticking (first = oldest) | radius: palette by distance from origin/seed | monochrome: uniform last palette color',
    group: 'Color',
  },
};

export const dla: Generator = {
  id: 'cellular-dla',
  family: 'cellular',
  styleName: 'DLA',
  definition: 'Diffusion-Limited Aggregation — random-walking particles that freeze on contact with a growing cluster, producing fractal trees with dimension ≈ 1.71; line-bottom mode creates upward-growing forests, directional walk bias and tip-affinity control morphology',
  algorithmNotes:
    'Center mode: a seed is placed at centre; new particles spawn on a circle just outside the current aggregate radius, random-walk until they touch (and stick with probability stickProb) or wander too far. Line-bottom mode: the entire bottom row is the seed; walkers spawn near the top and walk downward, producing stalactite-like upward-growing columns — a positive walkBias simulates gravity and increases column separation. Scatter mode: N random seeds create competing fractal clusters. Walk bias skews the random step probability in one direction. Tip-bias modulates effective stickiness by radial position (or height in line mode): positive values make peripheral tips sticker, stretching arms; negative values force particles to slide past tips and densify the core.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, targetParticles: 3000, particlesPerFrame: 8,
    seedMode: 'center', scatterSeeds: 5,
    walkBias: 0.0, stickProbability: 1.0, tipBias: 0.0,
    colorMode: 'arrival',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size         = Math.max(16, (params.gridSize ?? 128) | 0);
    const stickProb    = Math.max(0.01, Math.min(1, params.stickProbability ?? 1.0));
    const tipBias      = Math.max(-0.9, Math.min(0.9, params.tipBias ?? 0));
    const walkBias     = Math.max(-0.7, Math.min(0.7, params.walkBias ?? 0));
    const seedMode     = params.seedMode  ?? 'center';
    const scatterSeeds = Math.max(2, (params.scatterSeeds ?? 5) | 0);
    const colorMode    = params.colorMode || 'arrival';
    const maxSteps     = 2000;

    const isLine = seedMode === 'line-bottom';

    function runStep(grid: Uint32Array, rng: SeededRNG, count: number, maxRadius: number) {
      if (isLine) {
        const res = addParticleLine(grid, size, rng, maxRadius, stickProb, tipBias, maxSteps, count + 1, walkBias);
        return { stuck: res.stuck, newMaxRadius: res.newTopY, count: res.stuck ? count + 1 : count };
      } else {
        const res = addParticleCenter(grid, size, rng, maxRadius, stickProb, tipBias, maxSteps, count + 1, walkBias);
        return { stuck: res.stuck, newMaxRadius: res.newMaxRadius, count: res.stuck ? count + 1 : count };
      }
    }

    if (time === 0) {
      const { grid, rng, count: initCount, maxRadius: initMax } = initDLA(seed, size, seedMode, scatterSeeds);
      let count = initCount, maxRadius = initMax;
      const target = Math.max(1, (params.targetParticles ?? 3000) | 0);
      const stopR = isLine ? 1 : size * 0.45; // for line: stop when top row reached
      while (count < target && (isLine ? maxRadius > stopR : maxRadius < size * 0.45)) {
        const res = runStep(grid, rng, count, maxRadius);
        count = res.count; maxRadius = res.newMaxRadius;
        if (!isLine && maxRadius >= size * 0.45) break;
        if (isLine && maxRadius <= 1) break;
      }
      // Drain remaining if target not reached
      while (count < target) {
        const res = runStep(grid, rng, count, maxRadius);
        if (res.stuck) { count = res.count; maxRadius = res.newMaxRadius; }
        if (isLine ? maxRadius <= 1 : maxRadius >= size * 0.45) break;
        if (count >= target) break;
      }
      renderDLA(ctx, grid, size, count, colorMode, palette, seedMode);
      return;
    }

    const key = `${seed}|${size}|${seedMode}|${scatterSeeds}|${params._renderKey ?? 0}`;
    if (!_dlaAnim || _dlaAnim.key !== key) {
      const { grid, rng, count, maxRadius } = initDLA(seed, size, seedMode, scatterSeeds);
      _dlaAnim = { key, grid, size, rng, count, maxRadius, seedMode };
    }

    const ppf = Math.max(1, (params.particlesPerFrame ?? 8) | 0);
    const stopR = isLine ? 1 : size * 0.45;
    for (let p = 0; p < ppf; p++) {
      if (isLine && _dlaAnim.maxRadius <= stopR) break;
      if (!isLine && _dlaAnim.maxRadius >= stopR) break;
      const res = runStep(_dlaAnim.grid, _dlaAnim.rng, _dlaAnim.count, _dlaAnim.maxRadius);
      _dlaAnim.count = res.count;
      _dlaAnim.maxRadius = res.newMaxRadius;
    }
    renderDLA(ctx, _dlaAnim.grid, _dlaAnim.size, _dlaAnim.count, colorMode, palette, seedMode);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.targetParticles ?? 3000) * 0.5) | 0; },
};
