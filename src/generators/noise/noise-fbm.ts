import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const s = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

const parameterSchema: ParameterSchema = {
  scale: {
    name: 'Scale', type: 'number', min: 0.5, max: 10, step: 0.5, default: 2,
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 10, step: 1, default: 6,
    help: 'Number of noise layers summed — more octaves = finer, more complex detail',
    group: 'Composition',
  },
  lacunarity: {
    name: 'Lacunarity', type: 'number', min: 1.5, max: 4.0, step: 0.1, default: 2.0,
    help: 'Frequency multiplier per octave — 2.0 doubles frequency each layer (natural fractal)',
    group: 'Geometry',
  },
  gain: {
    name: 'Gain', type: 'number', min: 0.2, max: 0.8, step: 0.05, default: 0.5,
    help: 'Amplitude multiplier per octave — 0.5 = pink noise, < 0.5 = smoother, > 0.5 = rougher',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['palette', 'bands'], default: 'palette',
    group: 'Color',
  },
  bandCount: {
    name: 'Band Count', type: 'number', min: 2, max: 24, step: 1, default: 8,
    help: 'Number of quantized contour bands (bands mode only)',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['drift', 'pulse'], default: 'drift',
    help: 'drift: pan through the field | pulse: oscillate effective scale ±20 % for a breathing zoom',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    group: 'Flow/Motion',
  },
};

export const noiseFbm: Generator = {
  id: 'noise-fbm',
  family: 'noise',
  styleName: 'FBM',
  definition: 'Fractal Brownian Motion — octaves of noise summed at geometrically increasing frequency and decreasing amplitude, producing self-similar multiscale structure',
  algorithmNotes:
    'fBm(x,y) = Σᵢ gainⁱ · noise(lacunarityⁱ · (x,y)), normalised by Σᵢ gainⁱ so the result lies in ≈[−1,1]. With lacunarity = 2 and gain = 0.5 the spectral slope is −2 (pink noise / 1/f² power spectrum), which matches the statistical character of natural terrain, clouds, and turbulent textures. Higher gain (closer to 1) produces rougher, more jagged surfaces; lower gain creates smoother, rolling fields. Output shifted to [0,1] for palette mapping.',
  parameterSchema,
  defaultParams: {
    scale: 2, octaves: 6, lacunarity: 2.0, gain: 0.5,
    colorMode: 'palette', bandCount: 8, animMode: 'drift', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noise      = new SimplexNoise(seed);
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const colors     = palette.colors.map(hexToRgb);
    const scale      = params.scale      ?? 2;
    const octaves    = Math.max(1, Math.min(10, (params.octaves ?? 6) | 0));
    const lacunarity = params.lacunarity ?? 2.0;
    const gain       = params.gain       ?? 0.5;
    const colorMode  = params.colorMode  ?? 'palette';
    const bandCount  = Math.max(2, (params.bandCount ?? 8) | 0);
    const t          = time * (params.speed ?? 0.5);
    const animMode   = params.animMode ?? 'drift';
    const pulseMul   = animMode === 'pulse' ? 1 + 0.2 * Math.sin(t * 0.4) : 1;

    const step = quality === 'draft' ? 2 : 1;
    const img  = ctx.createImageData(w, h);
    const d    = img.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        let nx = (x / w) * 4 * scale * pulseMul;
        let ny = (y / h) * 4 * scale * pulseMul;
        if (animMode === 'drift') { nx += t * 0.04; ny += t * 0.027; }

        let v = (noise.fbm(nx, ny, octaves, lacunarity, gain) + 1) * 0.5;
        if (colorMode === 'bands') v = Math.floor(v * bandCount) / bandCount;

        const [r, g, b] = paletteSample(v, colors);
        for (let sy = 0; sy < step && y + sy < h; sy++) {
          for (let sx = 0; sx < step && x + sx < w; sx++) {
            const i = ((y + sy) * w + (x + sx)) * 4;
            d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.octaves ?? 6) * 80) | 0; },
};
