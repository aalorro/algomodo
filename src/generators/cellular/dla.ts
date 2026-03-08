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
function lerpColor(
  c0: [number, number, number], c1: [number, number, number], f: number,
): [number, number, number] {
  return [
    (c0[0] + (c1[0] - c0[0]) * f) | 0,
    (c0[1] + (c1[1] - c0[1]) * f) | 0,
    (c0[2] + (c1[2] - c0[2]) * f) | 0,
  ];
}

function paletteAt(colors: [number, number, number][], t: number): [number, number, number] {
  const scaled = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(scaled);
  const i1 = Math.min(colors.length - 1, i0 + 1);
  return lerpColor(colors[i0], colors[i1], scaled - i0);
}

function renderDLA(
  ctx: CanvasRenderingContext2D,
  grid: Uint32Array, size: number, maxCount: number,
  colorMode: string, palette: { colors: string[] },
  seedMode: string,
  glowAmount: number, edgeBrightness: number, depthShading: number, bgStyle: string,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cBg: [number, number, number] = [8, 8, 12];
  const N = size * size;
  const cx = size / 2, cy = size / 2;

  // --- Precomputation: neighbor counts, edge map, distance field ---
  const neighborCount = new Uint8Array(N);
  const isEdge = new Uint8Array(N);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!grid[i]) continue;
      let nc = 0;
      let hasEmpty = false;
      if (y > 0 && grid[(y - 1) * size + x]) nc++; else if (y > 0) hasEmpty = true;
      if (y < size - 1 && grid[(y + 1) * size + x]) nc++; else if (y < size - 1) hasEmpty = true;
      if (x > 0 && grid[y * size + x - 1]) nc++; else if (x > 0) hasEmpty = true;
      if (x < size - 1 && grid[y * size + x + 1]) nc++; else if (x < size - 1) hasEmpty = true;
      neighborCount[i] = nc;
      if (hasEmpty) isEdge[i] = 1;
    }
  }

  // BFS distance field + nearest aggregate color (for glow)
  const maxGlowDist = 12;
  const distField = new Uint8Array(N);
  const nearestColor = new Uint32Array(N); // arrival order of nearest occupied cell
  distField.fill(255);
  if (glowAmount > 0) {
    const queue: number[] = [];
    for (let i = 0; i < N; i++) {
      if (grid[i]) {
        distField[i] = 0;
        nearestColor[i] = grid[i];
        queue.push(i);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const ci = queue[head++];
      const cd = distField[ci];
      if (cd >= maxGlowDist) continue;
      const bx = ci % size, by = (ci / size) | 0;
      const nbrs = [
        by > 0 ? ci - size : -1,
        by < size - 1 ? ci + size : -1,
        bx > 0 ? ci - 1 : -1,
        bx < size - 1 ? ci + 1 : -1,
      ];
      for (const ni of nbrs) {
        if (ni >= 0 && distField[ni] > cd + 1) {
          distField[ni] = cd + 1;
          nearestColor[ni] = nearestColor[ci];
          queue.push(ni);
        }
      }
    }
  }

  // --- Pixel rendering ---
  const img = ctx.createImageData(w, h);
  const d = img.data;

  for (let py = 0; py < h; py++) {
    const gy = Math.min(size - 1, (py / h * size) | 0);
    for (let px = 0; px < w; px++) {
      const gx = Math.min(size - 1, (px / w * size) | 0);
      const gi = gy * size + gx;
      const order = grid[gi];
      let r: number, g: number, b: number;

      if (!order) {
        // Background pixel
        let bgR = cBg[0], bgG = cBg[1], bgB = cBg[2];

        if (bgStyle === 'radial-gradient') {
          const dx = px / w - 0.5, dy = py / h - 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy) * 2; // 0 at center, ~1.4 at corners
          const bright = Math.max(0, 1 - dist * 0.7); // soft falloff
          bgR = (cBg[0] + bright * 18) | 0;
          bgG = (cBg[1] + bright * 16) | 0;
          bgB = (cBg[2] + bright * 24) | 0;
        } else if (bgStyle === 'vignette') {
          const dx = px / w - 0.5, dy = py / h - 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy) * 2;
          const darken = Math.max(0, 1 - dist * 0.6);
          bgR = (cBg[0] * darken) | 0;
          bgG = (cBg[1] * darken) | 0;
          bgB = (cBg[2] * darken) | 0;
        }

        // Glow: blend aggregate color into nearby empty pixels
        const dist = distField[gi];
        if (glowAmount > 0 && dist > 0 && dist < maxGlowDist) {
          const falloff = Math.exp(-dist * (1.5 - glowAmount * 0.8));
          const glowStrength = falloff * glowAmount * 0.6;

          // Get color of nearest aggregate cell
          const nearOrder = nearestColor[gi];
          let glowR: number, glowG: number, glowB: number;
          if (nearOrder && maxCount > 1) {
            const t = (nearOrder - 1) / (maxCount - 1);
            [glowR, glowG, glowB] = paletteAt(colors, t);
          } else {
            [glowR, glowG, glowB] = colors[0];
          }

          bgR = (bgR + (glowR - bgR) * glowStrength) | 0;
          bgG = (bgG + (glowG - bgG) * glowStrength) | 0;
          bgB = (bgB + (glowB - bgB) * glowStrength) | 0;
        }

        r = bgR; g = bgG; b = bgB;
      } else {
        // Occupied pixel — compute base color
        if (colorMode === 'arrival') {
          const t = maxCount > 1 ? (order - 1) / (maxCount - 1) : 0;
          [r, g, b] = paletteAt(colors, t);
        } else if (colorMode === 'radius') {
          let t: number;
          if (seedMode === 'line-bottom') {
            t = 1 - gy / (size - 1);
          } else {
            const dr = Math.sqrt((gx - cx) ** 2 + (gy - cy) ** 2);
            t = Math.min(1, dr / (size * 0.5));
          }
          [r, g, b] = paletteAt(colors, t);
        } else if (colorMode === 'neighbors') {
          const nc = neighborCount[gi];
          // tips (1 neighbor) = end of palette, branches (2) = mid, junctions (3+) = start
          const t = nc <= 1 ? 1.0 : nc === 2 ? 0.5 : 0.0;
          [r, g, b] = paletteAt(colors, t);
        } else {
          [r, g, b] = colors[colors.length - 1];
        }

        // Depth shading: tips brighter, junctions darker
        if (depthShading > 0) {
          const nc = neighborCount[gi];
          // 1 neighbor = +boost, 4 neighbors = -darken
          const shade = 1 + depthShading * 0.2 * (2 - nc); // nc=1→1.2, nc=2→1.0, nc=3→0.8, nc=4→0.6
          r = Math.min(255, (r * shade) | 0);
          g = Math.min(255, (g * shade) | 0);
          b = Math.min(255, (b * shade) | 0);
        }

        // Edge highlighting
        if (edgeBrightness > 0 && isEdge[gi]) {
          const boost = 1 + edgeBrightness * 0.6;
          r = Math.min(255, (r * boost) | 0);
          g = Math.min(255, (g * boost) | 0);
          b = Math.min(255, (b * boost) | 0);
        }
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
    options: ['arrival', 'radius', 'neighbors', 'monochrome'],
    default: 'arrival',
    help: 'arrival: palette by order of sticking | radius: by distance from seed | neighbors: by branch topology (tips vs junctions) | monochrome: uniform',
    group: 'Color',
  },
  bgStyle: {
    name: 'Background',
    type: 'select',
    options: ['flat', 'radial-gradient', 'vignette'],
    default: 'radial-gradient',
    help: 'flat: solid dark | radial-gradient: soft center glow | vignette: darkened edges',
    group: 'Color',
  },
  glow: {
    name: 'Glow',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0.5,
    help: 'Soft halo around the aggregate — 0 disables',
    group: 'Texture',
  },
  edgeBrightness: {
    name: 'Edge Brightness',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0.4,
    help: 'Brightness boost on boundary cells to emphasize fractal edges',
    group: 'Texture',
  },
  depthShading: {
    name: 'Depth Shading',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0.3,
    help: 'Brightness variation by branch density — tips glow brighter, junctions darker',
    group: 'Texture',
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
    colorMode: 'arrival', bgStyle: 'radial-gradient',
    glow: 0.5, edgeBrightness: 0.4, depthShading: 0.3,
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
    const bgStyle      = params.bgStyle ?? 'radial-gradient';
    const glowAmount   = Math.max(0, Math.min(1, params.glow ?? 0.5));
    const edgeBright   = Math.max(0, Math.min(1, params.edgeBrightness ?? 0.4));
    const depthShade   = Math.max(0, Math.min(1, params.depthShading ?? 0.3));
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
      renderDLA(ctx, grid, size, count, colorMode, palette, seedMode, glowAmount, edgeBright, depthShade, bgStyle);
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
    renderDLA(ctx, _dlaAnim.grid, _dlaAnim.size, _dlaAnim.count, colorMode, palette, seedMode, glowAmount, edgeBright, depthShade, bgStyle);

    // Signal completion when aggregate reached boundary
    const done = isLine ? _dlaAnim.maxRadius <= stopR : _dlaAnim.maxRadius >= stopR;
    if (done) return true;
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.targetParticles ?? 3000) * 0.5) | 0; },
};
