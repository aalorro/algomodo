import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';
import { drawCircle } from '../../renderers/canvas2d/utils';

const parameterSchema: ParameterSchema = {
  segments: {
    name: 'Segments',
    type: 'number',
    min: 3,
    max: 24,
    step: 1,
    default: 8,
    help: 'Number of kaleidoscope segments',
    group: 'Composition',
  },
  speed: {
    name: 'Rotation Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 1,
    help: 'Rotation speed of pattern',
    group: 'Motion',
  },
  complexity: {
    name: 'Complexity',
    type: 'number',
    min: 1,
    max: 5,
    step: 1,
    default: 2,
    help: 'Pattern detail level',
    group: 'Composition',
  },
  scale: {
    name: 'Scale',
    type: 'number',
    min: 0.5,
    max: 5,
    step: 0.5,
    default: 2,
    help: 'Pattern size multiplier',
    group: 'Geometry',
  },
  thickness: {
    name: 'Line Thickness',
    type: 'number',
    min: 1,
    max: 10,
    step: 1,
    default: 2,
    help: 'Thickness of drawn lines',
    group: 'Texture',
  },
};

export const kaleidoscope: Generator = {
  id: 'kaleidoscope',
  family: 'animation',
  styleName: 'Kaleidoscope',
  definition: 'Rotating kaleidoscopic symmetry patterns',
  algorithmNotes: 'Creates radially symmetric patterns with rotation animation.',
  parameterSchema,
  defaultParams: {
    segments: 8,
    speed: 1,
    complexity: 2,
    scale: 2,
    thickness: 2,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 2 - 20;

    // Clear with fade
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillRect(0, 0, width, height);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const segmentAngle = (Math.PI * 2) / params.segments;
    const rotation = (time * params.speed * 0.5) % (Math.PI * 2);

    // Draw each segment
    for (let seg = 0; seg < params.segments; seg++) {
      const baseAngle = seg * segmentAngle + rotation;

      // Draw pattern within segment
      for (let i = 0; i < params.complexity * 10; i++) {
        const t = i / (params.complexity * 10);
        const radius = t * maxRadius;

        // Create noise-based pattern
        const n = noise.fbm(
          t * params.scale,
          Math.cos(baseAngle) * params.scale,
          2,
          2,
          0.5
        );

        const angle = baseAngle + n * 0.5;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;

        const colorIdx = Math.floor(t * palette.colors.length) % palette.colors.length;
        const color = palette.colors[colorIdx];

        if (t > 0.1) {
          ctx.strokeStyle = color;
          ctx.lineWidth = params.thickness;
          ctx.beginPath();
          ctx.lineTo(centerX, centerY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      }
    }

    // Central circle
    ctx.fillStyle = palette.colors[0];
    drawCircle(ctx, centerX, centerY, 5, palette.colors[0]);
  },

  estimateCost(params) {
    return params.segments * params.complexity * 100;
  },
};
