import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

// ─── Shape drawing helpers ────────────────────────────────────────────────────

function drawShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  shape: number,
  color: string,
) {
  ctx.fillStyle = color;
  switch (shape) {
    case 0: // circle
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 1: { // square rotated to face velocity
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI * 0.25);
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.restore();
      break;
    }
    case 2: { // triangle pointing in flow direction
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(size * 1.8, 0);
      ctx.lineTo(-size, -size * 0.9);
      ctx.lineTo(-size, size * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 3: { // line segment aligned to velocity
      const dx = Math.cos(angle) * size * 2;
      const dy = Math.sin(angle) * size * 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.5, size * 0.45);
      ctx.beginPath();
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
      break;
    }
  }
}

function drawAttractor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
) {
  ctx.save();
  for (let i = 4; i >= 1; i--) {
    ctx.globalAlpha = 0.055 * i;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius * (i * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Precomputed curl-noise flow field ────────────────────────────────────────
//
// Curl of a scalar field F: flow = (∂F/∂y, −∂F/∂x)
// This is divergence-free, so particles circulate continuously and fill the
// entire canvas uniformly instead of piling up at FBM convergence sinks.

const GRID = 72; // resolution of the precomputed grid

interface FlowField {
  sinA: Float32Array; // sin of each cell's curl angle
  cosA: Float32Array; // cos of each cell's curl angle
  seed: number;
  flowScale: number;
}

function buildFlowField(noise: SimplexNoise, seed: number, flowScale: number): FlowField {
  const n = GRID * GRID;
  const sinA = new Float32Array(n);
  const cosA = new Float32Array(n);
  const eps = 0.008;

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const nx = (gx / (GRID - 1) - 0.5) * flowScale + 5;
      const ny = (gy / (GRID - 1) - 0.5) * flowScale + 5;
      const n0 = noise.fbm(nx,       ny,       2, 2, 0.5);
      const n1 = noise.fbm(nx + eps, ny,       2, 2, 0.5);
      const n2 = noise.fbm(nx,       ny + eps, 2, 2, 0.5);
      const dnx = (n1 - n0) / eps;
      const dny = (n2 - n0) / eps;
      // Curl direction: (∂F/∂y, -∂F/∂x)
      const a = Math.atan2(dny, -dnx);
      const i = gy * GRID + gx;
      sinA[i] = Math.sin(a);
      cosA[i] = Math.cos(a);
    }
  }
  return { sinA, cosA, seed, flowScale };
}

function sampleField(
  field: FlowField,
  px: number, py: number,
  width: number, height: number,
  timeDrift: number,
): number {
  const gxf = (px / width)  * (GRID - 1);
  const gyf = (py / height) * (GRID - 1);
  const gx0 = Math.max(0, Math.min(GRID - 2, Math.floor(gxf)));
  const gy0 = Math.max(0, Math.min(GRID - 2, Math.floor(gyf)));
  const gx1 = gx0 + 1, gy1 = gy0 + 1;
  const fx = gxf - gx0, fy = gyf - gy0;

  const { sinA, cosA } = field;
  const i00 = gy0 * GRID + gx0, i10 = gy0 * GRID + gx1;
  const i01 = gy1 * GRID + gx0, i11 = gy1 * GRID + gx1;

  // Bilinear interpolation over sin/cos (correct for angle wrapping)
  const s = (1 - fy) * ((1 - fx) * sinA[i00] + fx * sinA[i10])
           + fy      * ((1 - fx) * sinA[i01] + fx * sinA[i11]);
  const c = (1 - fy) * ((1 - fx) * cosA[i00] + fx * cosA[i10])
           + fy      * ((1 - fx) * cosA[i01] + fx * cosA[i11]);

  return Math.atan2(s, c) + timeDrift;
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  particleCount: {
    name: 'Particles',
    type: 'number',
    min: 100,
    max: 5000,
    step: 100,
    default: 2000,
    help: 'Number of flowing particles',
    group: 'Composition',
  },
  attractorCount: {
    name: 'Attractors',
    type: 'number',
    min: 0,
    max: 6,
    step: 1,
    default: 0,
    help: 'Glowing bodies that orbit and warp the flow field',
    group: 'Composition',
  },
  flowScale: {
    name: 'Flow Scale',
    type: 'number',
    min: 0.5,
    max: 5,
    step: 0.5,
    default: 2,
    help: 'Size of flow field patterns',
    group: 'Geometry',
  },
  objectType: {
    name: 'Shape',
    type: 'select',
    options: ['circle', 'square', 'triangle', 'line', 'mixed'],
    default: 'circle',
    help: 'Shape rendered for each particle',
    group: 'Geometry',
  },
  flowSpeed: {
    name: 'Speed',
    type: 'number',
    min: 0.5,
    max: 5,
    step: 0.5,
    default: 2,
    help: 'Particle flow speed',
    group: 'Flow/Motion',
  },
  particleSize: {
    name: 'Size',
    type: 'number',
    min: 0.5,
    max: 10,
    step: 0.5,
    default: 3,
    help: 'Base particle size',
    group: 'Texture',
  },
  sizeVariance: {
    name: 'Size Variance',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.1,
    default: 0.3,
    help: 'Random variation in individual particle sizes',
    group: 'Texture',
  },
  trailLength: {
    name: 'Trail',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.1,
    default: 0.5,
    help: 'Motion blur amount',
    group: 'Texture',
  },
};

// ─── Generator ────────────────────────────────────────────────────────────────

export const flowingParticles: Generator = {
  id: 'flowing-particles',
  family: 'animation',
  styleName: 'Flowing Particles',
  definition: 'Animated particles flowing through a divergence-free curl-noise vector field',
  algorithmNotes:
    'Curl noise (divergence-free) ensures particles circulate uniformly across the entire canvas ' +
    'without clustering at FBM convergence sinks. A precomputed 72×72 grid makes per-frame ' +
    'sampling O(1). On first render, 60 draw passes build up full trails immediately. ' +
    'Optional orbiting attractors add gravitational warping; shapes can be circles, squares, ' +
    'triangles, line segments, or mixed.',
  parameterSchema,
  defaultParams: {
    particleCount: 2000,
    attractorCount: 0,
    flowScale: 2,
    objectType: 'circle',
    flowSpeed: 2,
    particleSize: 3,
    sizeVariance: 0.3,
    trailLength: 0.5,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const width  = ctx.canvas.width;
    const height = ctx.canvas.height;

    const flowScale      = params.flowScale      ?? 2;
    const flowSpeed      = params.flowSpeed      ?? 2;
    const particleSize   = params.particleSize   ?? 3;
    const trailLength    = params.trailLength    ?? 0.5;
    const sizeVariance   = params.sizeVariance   ?? 0.3;
    const attractorCount = Math.round(params.attractorCount ?? 0);
    const objectType     = (params.objectType    ?? 'circle') as string;

    const shapeIndex = (s: string): number =>
      ({ circle: 0, square: 1, triangle: 2, line: 3 }[s] ?? 0);
    const fixedShape = objectType === 'mixed' ? -1 : shapeIndex(objectType);

    // ── Precomputed curl-noise flow field (rebuild only on seed/scale change) ──
    const fieldKey = `__flowfield_${seed}_${flowScale}`;
    let field = (globalThis as any)[fieldKey] as FlowField | undefined;
    if (!field || field.seed !== seed || field.flowScale !== flowScale) {
      const noise = new SimplexNoise(seed);
      field = buildFlowField(noise, seed, flowScale);
      (globalThis as any)[fieldKey] = field;
    }

    const timeDrift = time * 0.1;
    const getAngle = (px: number, py: number): number =>
      sampleField(field!, px, py, width, height, timeDrift);

    // ── Particle store (keyed so shape/variance changes reinitialise) ──────
    const storeKey = `__particles_${seed}_${objectType}_${sizeVariance}_${params.particleCount}`;
    const isFirstRender = !(globalThis as any)[storeKey];

    interface Particle {
      x: number; y: number; vx: number; vy: number;
      shape: number; sizeMult: number;
    }
    let particles: Particle[];

    if (isFirstRender) {
      const initRng = new SeededRNG(seed);
      particles = [];

      // Grid + jitter initial distribution for guaranteed full-canvas coverage
      const cols = Math.ceil(Math.sqrt(params.particleCount * (width / height)));
      const rows = Math.ceil(params.particleCount / cols);
      const cellW = width  / cols;
      const cellH = height / rows;

      for (let i = 0; i < params.particleCount; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const shape    = fixedShape >= 0 ? fixedShape : Math.floor(initRng.range(0, 4));
        const sizeMult = 1 - sizeVariance * 0.5 + initRng.range(0, sizeVariance);
        particles.push({
          x: col * cellW + initRng.range(0, cellW),
          y: row * cellH + initRng.range(0, cellH),
          vx: 0, vy: 0,
          shape,
          sizeMult,
        });
      }
      (globalThis as any)[storeKey] = particles;
    } else {
      particles = (globalThis as any)[storeKey] as Particle[];
    }

    // ── Attractor definitions (derived deterministically from seed) ────────
    interface Attractor {
      cx: number; cy: number;
      orbitR: number; orbitSpeed: number; orbitPhase: number;
      strength: number; radius: number; colorIdx: number;
    }
    const attractors: Attractor[] = [];
    if (attractorCount > 0) {
      const attrRng = new SeededRNG(seed + 99991);
      for (let i = 0; i < attractorCount; i++) {
        attractors.push({
          cx:         width  * attrRng.range(0.2, 0.8),
          cy:         height * attrRng.range(0.2, 0.8),
          orbitR:     Math.min(width, height) * attrRng.range(0.04, 0.14),
          orbitSpeed: attrRng.range(0.3, 1.1) * (attrRng.range(0, 1) > 0.5 ? 1 : -1),
          orbitPhase: attrRng.range(0, Math.PI * 2),
          strength:   attrRng.range(0.6, 2.2),
          radius:     Math.min(width, height) * attrRng.range(0.1, 0.22),
          colorIdx:   Math.floor(attrRng.range(0, palette.colors.length)),
        });
      }
    }

    const attrPos = attractors.map(a => ({
      x:        a.cx + Math.cos(time * a.orbitSpeed * 0.01 + a.orbitPhase) * a.orbitR,
      y:        a.cy + Math.sin(time * a.orbitSpeed * 0.01 + a.orbitPhase) * a.orbitR,
      strength: a.strength,
      radius:   a.radius,
      colorIdx: a.colorIdx,
    }));

    const baseSpeed = flowSpeed * 0.5;

    // ── Inner update + draw helper (reused for warmup and live frame) ──────
    const updateAndDraw = () => {
      for (const p of particles) {
        const angle = getAngle(p.x, p.y);
        p.vx = Math.cos(angle) * baseSpeed;
        p.vy = Math.sin(angle) * baseSpeed;

        // Attractor gravity
        for (const a of attrPos) {
          const dx   = a.x - p.x;
          const dy   = a.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < a.radius && dist > 1) {
            const force = a.strength * (1 - dist / a.radius) * baseSpeed * 0.4;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }

        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = width;  if (p.x > width)  p.x = 0;
        if (p.y < 0) p.y = height; if (p.y > height) p.y = 0;

        const normAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const colorIdx  = Math.floor((normAngle / (Math.PI * 2)) * palette.colors.length) % palette.colors.length;
        const sz        = particleSize * p.sizeMult;
        const flowAngle = Math.atan2(p.vy, p.vx);

        drawShape(ctx, p.x, p.y, sz, flowAngle, p.shape, palette.colors[colorIdx]);
      }
    };

    if (isFirstRender) {
      // Stamp solid black so the canvas is fully opaque from frame 1
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // Run 60 draw+fade passes so trails are fully developed immediately
      // (prevents the "sparse first frame" artifact on static renders)
      const WARMUP = 60;
      for (let w = 0; w < WARMUP; w++) {
        ctx.fillStyle = `rgba(0,0,0,${1 - trailLength})`;
        ctx.fillRect(0, 0, width, height);
        updateAndDraw();
      }
    } else {
      // Normal frame: trail fade then one update
      ctx.fillStyle = `rgba(0,0,0,${1 - trailLength})`;
      ctx.fillRect(0, 0, width, height);
      updateAndDraw();
    }

    // ── Draw attractor orbs on top ────────────────────────────────────────
    for (const a of attrPos) {
      drawAttractor(ctx, a.x, a.y, a.radius, palette.colors[a.colorIdx]);
    }
  },

  estimateCost(params) {
    return params.particleCount * 2 + (params.attractorCount ?? 0) * 50;
  },
};
