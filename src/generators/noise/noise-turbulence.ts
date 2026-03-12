import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

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
  warpAmount: {
    name: 'Warp Amount', type: 'number', min: 0, max: 2, step: 0.1, default: 0,
    help: 'Domain warping for organic distortion — 0 = off',
    group: 'Composition',
  },
  erosion: {
    name: 'Erosion', type: 'number', min: 0, max: 1.0, step: 0.1, default: 0,
    help: 'Weight each octave by the previous — creases erode into valleys',
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
    name: 'Anim Mode', type: 'select', options: ['drift', 'rotate', 'churn'], default: 'drift',
    help: 'drift: pan through the field | rotate: spin sample coordinates | churn: each octave drifts at its own rate for a boiling effect',
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
    warpAmount: 0, erosion: 0,
    colorMode: 'palette', bandCount: 6, animMode: 'drift', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noise      = new SimplexNoise(seed);
    const warpNoise  = new SimplexNoise(seed + 53);
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const scale      = params.scale      ?? 2.5;
    const octaves    = Math.max(1, Math.min(10, (params.octaves ?? 6) | 0));
    const lacunarity = params.lacunarity ?? 2.0;
    const gain       = params.gain       ?? 0.5;
    const power      = params.power      ?? 1.0;
    const warpAmount = params.warpAmount ?? 0;
    const erosion    = params.erosion    ?? 0;
    const colorMode  = params.colorMode  ?? 'palette';
    const bandCount  = Math.max(2, (params.bandCount ?? 6) | 0);
    const t          = time * (params.speed ?? 0.5);
    const animMode   = params.animMode ?? 'drift';
    const nCenter    = 2 * scale;
    const rotAngle   = animMode === 'rotate' ? t * 0.08 : 0;
    const rotCos     = Math.cos(rotAngle), rotSin = Math.sin(rotAngle);

    // Normalisation constant: peak |noise2D| ≈ 0.65 for gradient noise
    const NOISE_PEAK = 0.65;

    // Hoist conditions outside loop
    const isDrift  = animMode === 'drift';
    const isRotate = animMode === 'rotate';
    const isChurn  = animMode === 'churn';
    const isBands  = colorMode === 'bands';
    const isHeat   = colorMode === 'heat';
    const doWarp   = warpAmount > 0;
    const doPower  = power !== 1;
    const doErosion = erosion > 0;
    const erosionInv = 1 - erosion;
    const invW = 4 * scale / w;
    const invH = 4 * scale / h;
    const driftX = isDrift ? t * 0.04 : 0;
    const driftY = isDrift ? t * 0.027 : 0;

    // Pre-compute per-octave churn offsets
    const churnXs = new Float64Array(octaves);
    const churnYs = new Float64Array(octaves);
    if (isChurn) {
      for (let oct = 0; oct < octaves; oct++) {
        churnXs[oct] = t * 0.012 * (oct + 1);
        churnYs[oct] = t * 0.009 * (oct + 1);
      }
    }

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

    const step = quality === 'draft' ? 2 : 1;
    const img  = ctx.createImageData(w, h);
    const d    = img.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        let nx = x * invW + driftX;
        let ny = y * invH + driftY;
        if (isRotate) {
          const dx = nx - nCenter, dy = ny - nCenter;
          nx = nCenter + dx * rotCos - dy * rotSin;
          ny = nCenter + dx * rotSin + dy * rotCos;
        }

        if (doWarp) {
          const wx = warpNoise.fbm(nx, ny, 3, 2.0, 0.5);
          const wy = warpNoise.fbm(nx + 5.2, ny + 1.3, 3, 2.0, 0.5);
          nx += warpAmount * wx;
          ny += warpAmount * wy;
        }

        // Turbulence: sum of |noise| with per-octave churn drift and erosion weighting
        let value = 0, amp = 1, freq = 1, maxVal = 0, weight = 1;
        for (let oct = 0; oct < octaves; oct++) {
          let s = Math.abs(noise.noise2D(nx * freq + churnXs[oct], ny * freq + churnYs[oct]));
          if (doErosion) {
            s *= erosionInv + erosion * weight;
            weight = Math.min(1, s * 2);
          }
          value  += amp * s;
          maxVal += amp;
          amp    *= gain;
          freq   *= lacunarity;
        }

        let v = Math.min(1, (value / maxVal) / NOISE_PEAK);
        if (doPower) v = Math.pow(Math.max(0, v), power);

        if (isBands) {
          v = Math.floor(v * bandCount) / bandCount;
        }

        let pr: number, pg: number, pb: number;
        if (isHeat) {
          if (v < 0.25)      { const f = v / 0.25;             pr = (f * 180) | 0;       pg = 0;                   pb = 0; }
          else if (v < 0.5)  { const f = (v - 0.25) / 0.25;   pr = (180 + f * 75) | 0;  pg = (f * 80) | 0;        pb = 0; }
          else if (v < 0.75) { const f = (v - 0.5)  / 0.25;   pr = 255;                  pg = (80 + f * 175) | 0;  pb = 0; }
          else               { const f = (v - 0.75) / 0.25;   pr = 255;                  pg = 255;                 pb = (f * 255) | 0; }
        } else {
          const ci = Math.max(0, Math.min(1, v)) * palMax;
          const c0 = ci | 0, c1 = Math.min(palMax, c0 + 1), frac = ci - c0;
          pr = (colR[c0] + (colR[c1] - colR[c0]) * frac) | 0;
          pg = (colG[c0] + (colG[c1] - colG[c0]) * frac) | 0;
          pb = (colB[c0] + (colB[c1] - colB[c0]) * frac) | 0;
        }

        for (let sy = 0; sy < step && y + sy < h; sy++) {
          for (let sx = 0; sx < step && x + sx < w; sx++) {
            const i = ((y + sy) * w + (x + sx)) * 4;
            d[i] = pr; d[i+1] = pg; d[i+2] = pb; d[i+3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.octaves ?? 6) * 100) | 0; },
};
