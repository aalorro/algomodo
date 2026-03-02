import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';
import { drawCircle, clearCanvas } from '../../renderers/canvas2d/utils';

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
  flowSpeed: {
    name: 'Speed',
    type: 'number',
    min: 0.5,
    max: 5,
    step: 0.5,
    default: 2,
    help: 'Particle flow speed',
    group: 'Motion',
  },
  particleSize: {
    name: 'Size',
    type: 'number',
    min: 0.5,
    max: 10,
    step: 0.5,
    default: 3,
    help: 'Particle size',
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
    group: 'Visual',
  },
};

export const flowingParticles: Generator = {
  id: 'flowing-particles',
  family: 'animation',
  styleName: 'Flowing Particles',
  definition: 'Animated particles flowing through a vector field',
  algorithmNotes: 'Particles follow a time-varying vector field derived from Simplex noise.',
  parameterSchema,
  defaultParams: {
    particleCount: 2000,
    flowScale: 2,
    flowSpeed: 2,
    particleSize: 3,
    trailLength: 0.5,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const flowScale = params.flowScale ?? 2;
    const flowSpeed = params.flowSpeed ?? 2;
    const particleSize = params.particleSize ?? 3;
    const trailLength = params.trailLength ?? 0.5;

    // For static renders (time === 0) warm up the simulation so the canvas shows
    // the flow field pattern rather than a sparse first frame.
    const isStatic = time === 0;
    const warmupSteps = isStatic ? 300 : 0;

    // Motion blur / background fill
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - trailLength})`;
    ctx.fillRect(0, 0, width, height);

    // Initialize or update particles
    const particleStoreKey = `__particles_${seed}`;
    let particles = (globalThis as any)[particleStoreKey];

    if (!particles || isStatic) {
      particles = [];
      for (let i = 0; i < params.particleCount; i++) {
        particles.push({
          x: rng.range(0, width),
          y: rng.range(0, height),
          vx: 0,
          vy: 0,
        });
      }
      if (!isStatic) (globalThis as any)[particleStoreKey] = particles;
    }

    // Noise field evaluation — centered at canvas middle, +5 offset avoids FBM origin
    const getAngle = (px: number, py: number, t: number): number => {
      const nx = (px / width - 0.5) * flowScale + 5 + t * 0.1;
      const ny = (py / height - 0.5) * flowScale + 5 + t * 0.1;
      return noise.fbm(nx, ny, 2, 2, 0.5) * Math.PI * 2;
    };

    // Warm-up for static render (fast, no drawing)
    for (let step = 0; step < warmupSteps; step++) {
      for (const p of particles) {
        const angle = getAngle(p.x, p.y, 0);
        p.x += Math.cos(angle) * flowSpeed * 0.5;
        p.y += Math.sin(angle) * flowSpeed * 0.5;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;
      }
    }

    // Update and draw particles
    for (const p of particles) {
      const angle = getAngle(p.x, p.y, time);
      const speed = flowSpeed * 0.5;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      const speed_val = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const colorIdx = Math.floor((speed_val / 5) * palette.colors.length) % palette.colors.length;
      drawCircle(ctx, p.x, p.y, particleSize, palette.colors[colorIdx]);
    }
  },

  estimateCost(params) {
    return params.particleCount * 2;
  },
};
