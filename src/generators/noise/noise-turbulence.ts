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
    name: 'Scale', type: 'number', min: 0.5, max: 10, step: 0.5, default: 2.5,
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 10, step: 1, default: 6,
    help: 'Number of absolute-value octaves — more octaves = more complex crease structure',
    group: 'Composition',
  },
  lacunarity: {
    name: 'Lacunarity', type: 'number', min: 1.5, max: 4.0, step: 0.1, default: 2.0,
    group: 'Geometry',
  },
  gain: {
    name: 'Gain', type: 'number', min: 0.2, max: 0.8, step: 0.05, default: 0.5,
    group: 'Geometry',
  },
  power: {
    name: 'Power', type: 'number', min: 0.3, max: 4.0, step: 0.1, default: 1.0,
    help: 'Gamma / power curve applied after turbulence — > 1 darkens low-energy regions, < 1 lifts them',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['palette', 'bands', 'heat'], default: 'palette',
    help: 'palette: smooth gradient | bands: hard contour steps | heat: fixed black → red → orange → white fire map',
    group: 'Color',
  },
  bandCount: {
    name: 'Band Count', type: 'number', min: 2, max: 24, step: 1, default: 6,
    help: 'Number of quantized contour bands (bands mode only)',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['drift', 'churn'], default: 'drift',
    help: 'drift: pan through the field | churn: each octave drifts at its own rate, creating a boiling/convective effect',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    group: 'Flow/Motion',
  },
};

export const noiseTurbulence: Generator = {
  id: 'noise-turbulence',
  family: 'noise',
  styleName: 'Turbulence',
  definition: 'Absolute-value fractal noise — taking |noise| at each octave folds the field into sharp creases, producing clouds, fire, plasma, and turbulent flow textures',
  algorithmNotes:
    'Turbulence(x,y) = Σᵢ gainⁱ · |noise(lacunarityⁱ · (x,y))| / Σᵢ gainⁱ. The absolute-value operation folds each smooth octave at zero, creating V-shaped creases that accumulate into complex filament structures. The result is always non-negative and is approximately in [0, 0.65] for gradient noise (peak ≈ 0.65); a normalization constant of 0.65 rescales to [0,1]. The "churn" animation mode gives each octave a distinct time-based phase drift, so high-frequency detail churns faster than low-frequency structure — visually resembling convective turbulence or fire.',
  parameterSchema,
  defaultParams: {
    scale: 2.5, octaves: 6, lacunarity: 2.0, gain: 0.5, power: 1.0,
    colorMode: 'palette', bandCount: 6, animMode: 'drift', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noise      = new SimplexNoise(seed);
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const colors     = palette.colors.map(hexToRgb);
    const scale      = params.scale      ?? 2.5;
    const octaves    = Math.max(1, Math.min(10, (params.octaves ?? 6) | 0));
    const lacunarity = params.lacunarity ?? 2.0;
    const gain       = params.gain       ?? 0.5;
    const power      = params.power      ?? 1.0;
    const colorMode  = params.colorMode  ?? 'palette';
    const bandCount  = Math.max(2, (params.bandCount ?? 6) | 0);
    const t          = time * (params.speed ?? 0.5);
    const animMode   = params.animMode ?? 'drift';

    // Normalisation constant: peak |noise2D| ≈ 0.65 for gradient noise
    const NOISE_PEAK = 0.65;

    const step = quality === 'draft' ? 2 : 1;
    const img  = ctx.createImageData(w, h);
    const d    = img.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        let nx = (x / w) * 4 * scale;
        let ny = (y / h) * 4 * scale;
        if (animMode === 'drift') { nx += t * 0.04; ny += t * 0.027; }

        // Turbulence: sum of |noise| with per-octave churn drift
        let value = 0, amp = 1, freq = 1, maxVal = 0;
        for (let oct = 0; oct < octaves; oct++) {
          // churn: high octaves drift proportionally faster than low octaves
          const cx = animMode === 'churn' ? t * 0.012 * (oct + 1) : 0;
          const cy = animMode === 'churn' ? t * 0.009 * (oct + 1) : 0;
          value  += amp * Math.abs(noise.noise2D(nx * freq + cx, ny * freq + cy));
          maxVal += amp;
          amp    *= gain;
          freq   *= lacunarity;
        }

        let v = Math.min(1, (value / maxVal) / NOISE_PEAK);
        if (power !== 1) v = Math.pow(Math.max(0, v), power);

        if (colorMode === 'bands') {
          v = Math.floor(v * bandCount) / bandCount;
        }

        let r: number, g: number, b: number;
        if (colorMode === 'heat') {
          // Black → deep red → orange → yellow → white
          if (v < 0.25)      { const f = v / 0.25;             r = (f * 180) | 0;       g = 0;                   b = 0; }
          else if (v < 0.5)  { const f = (v - 0.25) / 0.25;   r = (180 + f * 75) | 0;  g = (f * 80) | 0;        b = 0; }
          else if (v < 0.75) { const f = (v - 0.5)  / 0.25;   r = 255;                  g = (80 + f * 175) | 0;  b = 0; }
          else               { const f = (v - 0.75) / 0.25;   r = 255;                  g = 255;                 b = (f * 255) | 0; }
        } else {
          [r, g, b] = paletteSample(v, colors);
        }

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
  estimateCost(params) { return ((params.octaves ?? 6) * 100) | 0; },
};
