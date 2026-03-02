import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

const parameterSchema: ParameterSchema = {
  waveCount: {
    name: 'Waves',
    type: 'number',
    min: 2,
    max: 10,
    step: 1,
    default: 4,
    help: 'Number of interference sources',
    group: 'Composition',
  },
  frequency: {
    name: 'Frequency',
    type: 'number',
    min: 0.5,
    max: 5,
    step: 0.5,
    default: 2,
    help: 'Wave frequency',
    group: 'Geometry',
  },
  speed: {
    name: 'Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 1,
    help: 'Animation speed',
    group: 'Motion',
  },
  damping: {
    name: 'Damping',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.1,
    default: 0.5,
    help: 'Wave amplitude decay',
    group: 'Visual',
  },
};

export const waveInterference: Generator = {
  id: 'wave-interference',
  family: 'animation',
  styleName: 'Wave Interference',
  definition: 'Animated wave interference patterns',
  algorithmNotes: 'Multiple wave sources create interference patterns that evolve over time.',
  parameterSchema,
  defaultParams: {
    waveCount: 4,
    frequency: 2,
    speed: 1,
    damping: 0.5,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    const rng = new SeededRNG(seed);

    // Generate wave source positions
    const sources: Array<{ x: number; y: number; phase: number }> = [];
    for (let i = 0; i < params.waveCount; i++) {
      sources.push({
        x: rng.range(width * 0.2, width * 0.8),
        y: rng.range(height * 0.2, height * 0.8),
        phase: (i / params.waveCount) * Math.PI * 2,
      });
    }

    // Compute wave values for each pixel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 0;

        for (const source of sources) {
          const dx = x - source.x;
          const dy = y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          const wave = Math.sin(
            dist * params.frequency * 0.05 -
              time * params.speed +
              source.phase
          );
          const decay = Math.exp(-dist * params.damping * 0.01);
          value += wave * decay;
        }

        // Normalize
        value = (value / params.waveCount) * 0.5 + 0.5;
        value = Math.max(0, Math.min(1, value));

        // Color based on value
        const colorIdx = Math.floor(value * (palette.colors.length - 1));
        const colorHex = palette.colors[colorIdx] || '#000000';
        const r = parseInt(colorHex.slice(1, 3), 16);
        const g = parseInt(colorHex.slice(3, 5), 16);
        const b = parseInt(colorHex.slice(5, 7), 16);

        const idx = (y * width + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  estimateCost(params) {
    return (params.waveCount * 1000) / (1 - params.damping + 0.1);
  },
};
