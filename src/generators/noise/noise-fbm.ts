import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

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
  warpAmount: {
    name: 'Warp Amount', type: 'number', min: 0, max: 2, step: 0.1, default: 0,
    help: 'Domain warping for organic distortion — 0 = off',
    group: 'Composition',
  },
  power: {
    name: 'Power', type: 'number', min: 0.3, max: 4.0, step: 0.1, default: 1.0,
    help: 'Gamma curve — >1 darkens lows and sharpens highs, <1 lifts shadows',
    group: 'Texture',
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
    name: 'Anim Mode', type: 'select', options: ['drift', 'rotate', 'pulse'], default: 'drift',
    help: 'drift: pan through the field | rotate: spin sample coordinates | pulse: oscillate effective scale ±20 %',
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
    scale: 2, octaves: 6, lacunarity: 2.0, gain: 0.5, warpAmount: 0, power: 1.0,
    colorMode: 'palette', bandCount: 8, animMode: 'drift', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noise      = new SimplexNoise(seed);
    const warpNoise  = new SimplexNoise(seed + 61);
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const scale      = params.scale      ?? 2;
    const octaves    = Math.max(1, Math.min(10, (params.octaves ?? 6) | 0));
    const lacunarity = params.lacunarity ?? 2.0;
    const gain       = params.gain       ?? 0.5;
    const warpAmount = params.warpAmount ?? 0;
    const power      = params.power      ?? 1.0;
    const bandCount  = Math.max(2, (params.bandCount ?? 8) | 0);
    const t          = time * (params.speed ?? 0.5);
    const animMode   = params.animMode ?? 'drift';
    const pulseMul   = animMode === 'pulse' ? 1 + 0.2 * Math.sin(t * 0.4) : 1;
    const nCenter    = 2 * scale;
    const rotAngle   = animMode === 'rotate' ? t * 0.08 : 0;
    const rotCos     = Math.cos(rotAngle), rotSin = Math.sin(rotAngle);

    // Hoist conditions outside loop
    const isDrift  = animMode === 'drift';
    const isRotate = animMode === 'rotate';
    const isBands  = (params.colorMode ?? 'palette') === 'bands';
    const doWarp   = warpAmount > 0;
    const doPower  = power !== 1;
    const invW = 4 * scale * pulseMul / w;
    const invH = 4 * scale * pulseMul / h;
    const driftX = isDrift ? t * 0.04 : 0;
    const driftY = isDrift ? t * 0.027 : 0;

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

    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : Math.max(1, Math.round(Math.max(w, h) / 1080));
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

        let v = (noise.fbm(nx, ny, octaves, lacunarity, gain) + 1) * 0.5;
        if (doPower) v = Math.pow(Math.max(0, v), power);
        if (isBands) v = Math.floor(v * bandCount) / bandCount;

        const ci = Math.max(0, Math.min(1, v)) * palMax;
        const c0 = ci | 0, c1 = Math.min(palMax, c0 + 1), frac = ci - c0;
        const pr = (colR[c0] + (colR[c1] - colR[c0]) * frac) | 0;
        const pg = (colG[c0] + (colG[c1] - colG[c0]) * frac) | 0;
        const pb = (colB[c0] + (colB[c1] - colB[c0]) * frac) | 0;

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
  estimateCost(params) { return ((params.octaves ?? 6) * 80) | 0; },
};
