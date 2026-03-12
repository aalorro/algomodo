import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

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
  veinSharpness: {
    name: 'Vein Sharpness',
    type: 'number', min: 0.5, max: 4.0, step: 0.1, default: 1.0,
    help: '>1 = thinner sharper veins, <1 = wider softer veins',
    group: 'Texture',
  },
  turbulence: {
    name: 'Turbulence',
    type: 'boolean', default: false,
    help: 'Use absolute-value noise for chaotic turbulent patterns',
    group: 'Texture',
  },
  doubleWarp: {
    name: 'Double Warp',
    type: 'boolean', default: true,
    help: 'Apply a second warp pass for more complexity',
    group: 'Composition',
  },
  animMode: {
    name: 'Anim Mode',
    type: 'select',
    options: ['flow', 'drift', 'pulse'],
    default: 'flow',
    help: 'flow: warp phases shift independently — veins morph and undulate | drift: uniform translation through the field | pulse: warp strength breathes in and out',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation speed multiplier',
    group: 'Flow/Motion',
  },
};

export const domainWarpMarble: Generator = {
  id: 'domain-warp-marble',
  family: 'noise',
  styleName: 'Domain Warped Marble',
  definition: 'Layered domain warping creates organic marble-like veining and turbulent flow structures',
  algorithmNotes: 'Two-pass domain warping displaces noise coordinates using another fBm field. Sine bands applied to the final value create marble striations. Colors interpolated across palette.',
  parameterSchema,
  defaultParams: { scale: 2.5, warpStrength: 1.2, warpScale: 2.0, bands: 6, octaves: 5, gain: 0.5, veinSharpness: 1.0, turbulence: false, doubleWarp: true, animMode: 'flow', speed: 0.5 },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const sn1  = new SimplexNoise(seed);
    const sn2 = new SimplexNoise(seed + 1337);
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const scale = params.scale ?? 2.5;
    const warpScale = params.warpScale ?? 2.0;
    const bands = params.bands ?? 6;
    const octaves = params.octaves ?? 5;
    const gain = params.gain ?? 0.5;
    const doDouble = !!params.doubleWarp;
    const doTurb = !!params.turbulence;
    const veinSharpness = params.veinSharpness ?? 1.0;
    const bandPI = Math.PI * bands;

    const animMode    = params.animMode    ?? 'flow';
    const speed       = params.speed       ?? 0.5;
    const t           = time * speed;
    const isFlow      = animMode === 'flow';

    const warpStrength = (params.warpStrength ?? 1.2) *
      (animMode === 'pulse' ? 1 + 0.4 * Math.sin(t * 0.45) : 1);

    const driftX = animMode === 'drift' ? t * 0.02  : 0;
    const driftY = animMode === 'drift' ? t * 0.013 : 0;

    // Hoist flow offsets outside loop
    const f1x = isFlow ? t * 0.015 : 0;
    const f1y = isFlow ? t * 0.011 : 0;
    const f2x = isFlow ? t * 0.019 : 0;
    const f2y = isFlow ? t * 0.013 : 0;
    const f3x = isFlow ? t * 0.008 : 0;
    const f3y = isFlow ? t * 0.012 : 0;

    // Pre-compute palette as flat arrays
    const nColors = palette.colors.length;
    const colR = new Uint8Array(nColors);
    const colG = new Uint8Array(nColors);
    const colB = new Uint8Array(nColors);
    for (let i = 0; i < nColors; i++) {
      const hex = palette.colors[i];
      const n = parseInt(hex.charAt(0) === '#' ? hex.slice(1) : hex, 16) || 0;
      colR[i] = (n >> 16) & 255;
      colG[i] = (n >> 8) & 255;
      colB[i] = n & 255;
    }
    const palMax = nColors - 1;

    // Hoist noise helper outside loop
    const noiseFn1 = (a: number, b: number) => {
      const raw = sn1.fbm(a, b, octaves, 2.0, gain);
      return doTurb ? Math.abs(raw) : raw;
    };
    const noiseFn2 = (a: number, b: number) => {
      const raw = sn2.fbm(a, b, octaves, 2.0, gain);
      return doTurb ? Math.abs(raw) : raw;
    };

    const invW = scale / w;
    const invH = scale / h;

    const step = quality === 'draft' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const nx = x * invW + driftX;
        const ny = y * invH + driftY;

        // First warp pass
        const wx1 = noiseFn1(nx + f1x, ny + f1y);
        const wy1 = noiseFn1(nx + 5.2 + f2x, ny + 1.3 - f2y);

        let finalX = nx + warpStrength * wx1;
        let finalY = ny + warpStrength * wy1;

        // Optional second warp pass
        if (doDouble) {
          const wx2 = noiseFn2(nx + warpScale * wx1 + 1.7 - f3x, ny + warpScale * wy1 + 9.2 + f3y);
          const wy2 = noiseFn2(nx + warpScale * wx1 + 8.3 + f3y, ny + warpScale * wy1 + 2.8 - f3x);
          finalX = nx + warpStrength * wx2;
          finalY = ny + warpStrength * wy2;
        }

        const n = noiseFn1(finalX, finalY);

        // Marble sine bands with sharpness control
        let bandT = Math.sin(n * bandPI) * 0.5 + 0.5;
        if (veinSharpness !== 1.0) bandT = Math.pow(bandT, veinSharpness);

        // Inline palette interpolation
        const ci = bandT * palMax;
        const c0 = ci | 0, c1 = Math.min(palMax, c0 + 1), frac = ci - c0;
        const pr = (colR[c0] + (colR[c1] - colR[c0]) * frac) | 0;
        const pg = (colG[c0] + (colG[c1] - colG[c0]) * frac) | 0;
        const pb = (colB[c0] + (colB[c1] - colB[c0]) * frac) | 0;

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
