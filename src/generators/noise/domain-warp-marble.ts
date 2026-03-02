import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  scale: {
    name: 'Scale',
    type: 'number', min: 0.5, max: 8, step: 0.1, default: 2.5,
    group: 'Composition',
  },
  warpStrength: {
    name: 'Warp Strength',
    type: 'number', min: 0, max: 3, step: 0.05, default: 1.2,
    help: 'Intensity of coordinate displacement',
    group: 'Composition',
  },
  warpScale: {
    name: 'Warp Scale',
    type: 'number', min: 0.5, max: 6, step: 0.1, default: 2.0,
    help: 'Frequency of the warp field',
    group: 'Composition',
  },
  bands: {
    name: 'Marble Bands',
    type: 'number', min: 1, max: 20, step: 1, default: 6,
    help: 'Number of sine-band striations',
    group: 'Geometry',
  },
  octaves: {
    name: 'Octaves',
    type: 'number', min: 1, max: 8, step: 1, default: 5,
    group: 'Geometry',
  },
  gain: {
    name: 'Smoothness',
    type: 'number', min: 0.2, max: 0.8, step: 0.05, default: 0.5,
    group: 'Texture',
  },
  doubleWarp: {
    name: 'Double Warp',
    type: 'boolean', default: true,
    help: 'Apply a second warp pass for more complexity',
    group: 'Composition',
  },
};

export const domainWarpMarble: Generator = {
  id: 'domain-warp-marble',
  family: 'noise',
  styleName: 'Domain Warped Marble',
  definition: 'Layered domain warping creates organic marble-like veining and turbulent flow structures',
  algorithmNotes: 'Two-pass domain warping displaces noise coordinates using another fBm field. Sine bands applied to the final value create marble striations. Colors interpolated across palette.',
  parameterSchema,
  defaultParams: { scale: 2.5, warpStrength: 1.2, warpScale: 2.0, bands: 6, octaves: 5, gain: 0.5, doubleWarp: true },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderCanvas2D(ctx, params, seed, palette, quality) {
    const noise  = new SimplexNoise(seed);
    const noise2 = new SimplexNoise(seed + 1337);
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { scale, warpStrength, warpScale, bands, octaves, gain, doubleWarp } = params;

    const step = quality === 'draft' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const nx = (x / w) * scale;
        const ny = (y / h) * scale;

        // First warp pass
        const wx1 = noise.fbm(nx,       ny,       octaves, 2.0, gain);
        const wy1 = noise.fbm(nx + 5.2, ny + 1.3, octaves, 2.0, gain);

        let finalX = nx + warpStrength * wx1;
        let finalY = ny + warpStrength * wy1;

        // Optional second warp pass
        if (doubleWarp) {
          const wx2 = noise2.fbm(nx + warpScale * wx1 + 1.7, ny + warpScale * wy1 + 9.2, octaves, 2.0, gain);
          const wy2 = noise2.fbm(nx + warpScale * wx1 + 8.3, ny + warpScale * wy1 + 2.8, octaves, 2.0, gain);
          finalX = nx + warpStrength * wx2;
          finalY = ny + warpStrength * wy2;
        }

        const n = noise.fbm(finalX, finalY, octaves, 2.0, gain);

        // Marble sine bands
        const t = Math.sin(n * Math.PI * bands) * 0.5 + 0.5;

        // Palette interpolation
        const ci = t * (palette.colors.length - 1);
        const c0 = Math.floor(ci);
        const c1 = Math.min(c0 + 1, palette.colors.length - 1);
        const frac = ci - c0;
        const [r0, g0, b0] = hexToRgb(palette.colors[c0]);
        const [r1, g1, b1] = hexToRgb(palette.colors[c1]);

        const pr = (r0 + (r1 - r0) * frac) | 0;
        const pg = (g0 + (g1 - g0) * frac) | 0;
        const pb = (b0 + (b1 - b0) * frac) | 0;

        for (let dy = 0; dy < step && y + dy < h; dy++) {
          for (let dx = 0; dx < step && x + dx < w; dx++) {
            const i = ((y + dy) * w + (x + dx)) * 4;
            data[i] = pr; data[i + 1] = pg; data[i + 2] = pb; data[i + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.05, 0.05, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return params.octaves * (params.doubleWarp ? 400 : 200); },
};
