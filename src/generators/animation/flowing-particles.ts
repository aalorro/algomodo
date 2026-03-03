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
    case 1: { // square (rotated to face velocity)
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
  // Outer glow rings (large → small, transparent → opaque)
  for (let i = 4; i >= 1; i--) {
    ctx.globalAlpha = 0.055 * i;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius * (i * 0.35), 0, Math.PI * 2);
    ctx.fill();
  }
  // Bright core
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
  definition: 'Animated particles flowing through a vector field',
  algorithmNotes:
    'Particles follow a time-varying vector field derived from Simplex noise. ' +
    'Optional attractor bodies orbit the canvas and add gravitational warping. ' +
    'Shapes can be circles, squares, triangles, line segments, or mixed.',
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

    const flowScale     = params.flowScale     ?? 2;
    const flowSpeed     = params.flowSpeed     ?? 2;
    const particleSize  = params.particleSize  ?? 3;
    const trailLength   = params.trailLength   ?? 0.5;
    const sizeVariance  = params.sizeVariance  ?? 0.3;
    const attractorCount = Math.round(params.attractorCount ?? 0);
    const objectType    = (params.objectType   ?? 'circle') as string;

    const shapeIndex = (s: string) =>
      ({ circle: 0, square: 1, triangle: 2, line: 3 }[s] ?? 0);
    const fixedShape = objectType === 'mixed' ? -1 : shapeIndex(objectType);

    const noise = new SimplexNoise(seed);
    const isStatic    = time === 0;
    const warmupSteps = isStatic ? 300 : 0;

    // Motion blur / background fade
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - trailLength})`;
    ctx.fillRect(0, 0, width, height);

    // ── Particle store (keyed so shape/variance changes reinitialise) ──────
    const storeKey = `__particles_${seed}_${objectType}_${sizeVariance}`;
    let particles = (globalThis as any)[storeKey] as Array<{
      x: number; y: number; vx: number; vy: number;
      shape: number; sizeMult: number;
    }> | undefined;

    if (!particles || isStatic) {
      const initRng = new SeededRNG(seed);
      particles = [];
      for (let i = 0; i < params.particleCount; i++) {
        const shape     = fixedShape >= 0 ? fixedShape : Math.floor(initRng.range(0, 4));
        const sizeMult  = 1 - sizeVariance * 0.5 + initRng.range(0, sizeVariance);
        particles.push({
          x: initRng.range(0, width),
          y: initRng.range(0, height),
          vx: 0, vy: 0,
          shape,
          sizeMult,
        });
      }
      if (!isStatic) (globalThis as any)[storeKey] = particles;
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
          cx:          width  * attrRng.range(0.2, 0.8),
          cy:          height * attrRng.range(0.2, 0.8),
          orbitR:      Math.min(width, height) * attrRng.range(0.04, 0.14),
          orbitSpeed:  attrRng.range(0.3, 1.1) * (attrRng.range(0, 1) > 0.5 ? 1 : -1),
          orbitPhase:  attrRng.range(0, Math.PI * 2),
          strength:    attrRng.range(0.6, 2.2),
          radius:      Math.min(width, height) * attrRng.range(0.1, 0.22),
          colorIdx:    Math.floor(attrRng.range(0, palette.colors.length)),
        });
      }
    }

    // Resolve attractor screen positions at current time
    const attrPos = attractors.map(a => ({
      x:       a.cx + Math.cos(time * a.orbitSpeed * 0.01 + a.orbitPhase) * a.orbitR,
      y:       a.cy + Math.sin(time * a.orbitSpeed * 0.01 + a.orbitPhase) * a.orbitR,
      strength: a.strength,
      radius:  a.radius,
      colorIdx: a.colorIdx,
    }));

    // ── Flow field helper ──────────────────────────────────────────────────
    const getAngle = (px: number, py: number, t: number): number => {
      const nx = (px / width  - 0.5) * flowScale + 5 + t * 0.1;
      const ny = (py / height - 0.5) * flowScale + 5 + t * 0.1;
      return noise.fbm(nx, ny, 2, 2, 0.5) * Math.PI * 2;
    };

    // ── Warm-up for static render ──────────────────────────────────────────
    for (let step = 0; step < warmupSteps; step++) {
      for (const p of particles) {
        const angle = getAngle(p.x, p.y, 0);
        p.x += Math.cos(angle) * flowSpeed * 0.5;
        p.y += Math.sin(angle) * flowSpeed * 0.5;
        if (p.x < 0) p.x = width;  if (p.x > width)  p.x = 0;
        if (p.y < 0) p.y = height; if (p.y > height) p.y = 0;
      }
    }

    // ── Update & draw particles ────────────────────────────────────────────
    const baseSpeed = flowSpeed * 0.5;

    for (const p of particles) {
      const angle = getAngle(p.x, p.y, time);
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

      // Color by flow angle (wraps across palette) — more visually varied than speed
      const normAngle  = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const colorIdx   = Math.floor((normAngle / (Math.PI * 2)) * palette.colors.length) % palette.colors.length;
      const sz         = particleSize * p.sizeMult;
      const flowAngle  = Math.atan2(p.vy, p.vx);

      drawShape(ctx, p.x, p.y, sz, flowAngle, p.shape, palette.colors[colorIdx]);
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
