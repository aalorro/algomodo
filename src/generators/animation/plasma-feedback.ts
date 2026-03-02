import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  scale: {
    name: 'Scale',
    type: 'number', min: 0.5, max: 6, step: 0.1, default: 2.0,
    group: 'Composition',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.1, max: 3, step: 0.05, default: 0.6,
    group: 'Flow/Motion',
  },
  layers: {
    name: 'Layers',
    type: 'number', min: 1, max: 5, step: 1, default: 3,
    help: 'Number of overlapping noise layers',
    group: 'Composition',
  },
  contrast: {
    name: 'Contrast',
    type: 'number', min: 0.5, max: 3, step: 0.1, default: 1.4,
    group: 'Texture',
  },
  warp: {
    name: 'Warp',
    type: 'number', min: 0, max: 2, step: 0.1, default: 0.8,
    help: 'Self-warp intensity for feedback effect',
    group: 'Composition',
  },
  blend: {
    name: 'Blend Mode',
    type: 'select',
    options: ['additive', 'smooth', 'bands'],
    default: 'smooth',
    group: 'Color',
  },
};

export const plasmaFeedback: Generator = {
  id: 'plasma-feedback',
  family: 'animation',
  styleName: 'Plasma Feedback',
  definition: 'Layered noise fields warped into themselves create glowing plasma and lava-lamp feedback aesthetics inspired by TouchDesigner feedback networks',
  algorithmNotes: 'Multiple noise layers at different frequencies are accumulated. Each layer warps its own sampling coordinates using the previous layer output, creating a feedback-loop-like complexity.',
  parameterSchema,
  defaultParams: { scale: 2.0, speed: 0.6, layers: 3, contrast: 1.4, warp: 0.8, blend: 'smooth' },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { scale, speed, layers, contrast, warp, blend } = params;

    const step = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const noise = new SimplexNoise(seed);

    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    const t = time * speed;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        let nx = (px / w) * scale;
        let ny = (py / h) * scale;

        let acc = 0;
        let amp = 1;
        let totalAmp = 0;

        for (let l = 0; l < layers; l++) {
          // Warp coordinates using previous layer
          const warpX = noise.noise2D(nx * 1.3 + l * 3.7 + t * 0.4, ny * 1.3 + l * 2.1) * warp;
          const warpY = noise.noise2D(nx * 1.3 + l * 1.9 + t * 0.4, ny * 1.3 + l * 4.3 + t * 0.3) * warp;

          const sampleX = nx + warpX + t * (l % 2 === 0 ? 0.1 : -0.07);
          const sampleY = ny + warpY + t * (l % 2 === 0 ? 0.07 : 0.13);

          const freq = Math.pow(1.8, l);
          acc += noise.noise2D(sampleX * freq, sampleY * freq) * amp;
          totalAmp += amp;
          amp *= 0.6;
        }

        let v = acc / totalAmp; // [-1, 1]

        if (blend === 'bands') {
          v = Math.sin(v * Math.PI * 3 + t * 0.5) * 0.5 + 0.5;
        } else if (blend === 'additive') {
          v = Math.abs(v);
        } else {
          v = v * 0.5 + 0.5;
        }

        v = Math.pow(Math.max(0, Math.min(1, v)), 1 / contrast);

        // Palette map
        const ci = v * (palette.colors.length - 1);
        const c0 = Math.floor(ci), c1 = Math.min(c0 + 1, palette.colors.length - 1);
        const frac = ci - c0;
        const [r0, g0, b0] = hexToRgb(palette.colors[c0]);
        const [r1, g1, b1] = hexToRgb(palette.colors[c1]);
        const pr = (r0 + (r1 - r0) * frac) | 0;
        const pg = (g0 + (g1 - g0) * frac) | 0;
        const pb = (b0 + (b1 - b0) * frac) | 0;

        for (let dy = 0; dy < step && py + dy < h; dy++) {
          for (let dx = 0; dx < step && px + dx < w; dx++) {
            const i = ((py + dy) * w + (px + dx)) * 4;
            data[i] = pr; data[i + 1] = pg; data[i + 2] = pb; data[i + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.05, 0.02, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return params.layers * 150; },
};
