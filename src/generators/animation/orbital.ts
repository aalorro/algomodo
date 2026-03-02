import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { drawCircle, clearCanvas } from '../../renderers/canvas2d/utils';

const parameterSchema: ParameterSchema = {
  bodyCount: {
    name: 'Bodies',
    type: 'number',
    min: 2,
    max: 20,
    step: 1,
    default: 5,
    help: 'Number of orbiting bodies',
    group: 'Composition',
  },
  speed: {
    name: 'Speed',
    type: 'number',
    min: 0.1,
    max: 5,
    step: 0.1,
    default: 1,
    help: 'Orbital rotation speed',
    group: 'Motion',
  },
  minRadius: {
    name: 'Min Radius',
    type: 'number',
    min: 50,
    max: 300,
    step: 10,
    default: 100,
    help: 'Minimum orbital radius',
    group: 'Geometry',
  },
  maxRadius: {
    name: 'Max Radius',
    type: 'number',
    min: 100,
    max: 500,
    step: 10,
    default: 400,
    help: 'Maximum orbital radius',
    group: 'Geometry',
  },
  bodySize: {
    name: 'Body Size',
    type: 'number',
    min: 2,
    max: 20,
    step: 1,
    default: 8,
    help: 'Size of each body',
    group: 'Texture',
  },
  trailLength: {
    name: 'Trail',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.1,
    default: 0.3,
    help: 'Motion trail opacity',
    group: 'Visual',
  },
};

export const orbital: Generator = {
  id: 'orbital',
  family: 'animation',
  styleName: 'Orbital Mechanics',
  definition: 'Animated orbits with multiple celestial bodies',
  algorithmNotes: 'Bodies orbit around a central point with varying radii and angular velocities.',
  parameterSchema,
  defaultParams: {
    bodyCount: 5,
    speed: 1,
    minRadius: 100,
    maxRadius: 400,
    bodySize: 8,
    trailLength: 0.3,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // Apply trail effect
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - params.trailLength})`;
    ctx.fillRect(0, 0, width, height);

    const rng = new SeededRNG(seed);
    const bodies: Array<{ radius: number; angle: number; speed: number; color: string }> = [];

    // Generate orbital parameters
    for (let i = 0; i < params.bodyCount; i++) {
      const radiusRatio = i / params.bodyCount;
      const radius = params.minRadius + (params.maxRadius - params.minRadius) * radiusRatio;
      const speed = (1 + rng.random()) * params.speed * (1 - radiusRatio * 0.5);
      const color = palette.colors[i % palette.colors.length];

      bodies.push({ radius, angle: rng.random() * Math.PI * 2, speed, color });
    }

    // Draw central star
    drawCircle(ctx, centerX, centerY, params.bodySize * 0.5, palette.colors[0]);

    // Draw orbiting bodies
    for (const body of bodies) {
      body.angle += (body.speed * time * 0.5) % (Math.PI * 2);
      const x = centerX + Math.cos(body.angle) * body.radius;
      const y = centerY + Math.sin(body.angle) * body.radius;

      drawCircle(ctx, x, y, params.bodySize, body.color);

      // Draw orbit line
      ctx.strokeStyle = `${body.color}33`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(centerX, centerY, body.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  estimateCost(params) {
    return params.bodyCount * 100;
  },
};
