import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

const parameterSchema: ParameterSchema = {
  scale: {
    name: 'Scale', type: 'number', min: 0.5, max: 10, step: 0.5, default: 2,
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 10, step: 1, default: 6,
    help: 'Number of ridged octaves — more octaves adds finer secondary ridges',
    group: 'Composition',
  },
  lacunarity: {
    name: 'Lacunarity', type: 'number', min: 1.5, max: 4.0, step: 0.1, default: 2.0,
    group: 'Geometry',
  },
  gain: {
    name: 'Gain', type: 'number', min: 0.1, max: 0.9, step: 0.05, default: 0.5,
    help: 'Amplitude weight per octave and cascade strength — higher = more pronounced secondary ridges',
    group: 'Geometry',
  },
  offset: {
    name: 'Ridge Offset', type: 'number', min: 0.5, max: 1.5, step: 0.05, default: 1.0,
    help: 'Ridge height offset — 1.0 = sharp peaks; lower = softer rounded ridges; higher = rarer but taller ridges',
    group: 'Texture',
  },
  sharpness: {
    name: 'Sharpness', type: 'number', min: 1.0, max: 5.0, step: 0.5, default: 2.0,
    help: 'Exponent on ridge signal — 2 = standard, higher = knife-edge ridges with deeper valleys',
    group: 'Texture',
  },
  warpAmount: {
    name: 'Warp Amount', type: 'number', min: 0, max: 2, step: 0.1, default: 0,
    help: 'Domain warping for more organic ridge shapes — 0 = off',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['palette', 'bands', 'peaks'], default: 'palette',
    help: 'palette: smooth gradient | bands: hard contour steps | peaks: ridges colored, valleys dark',
    group: 'Color',
  },
  bandCount: {
    name: 'Band Count', type: 'number', min: 2, max: 24, step: 1, default: 8,
    help: 'Number of quantized contour bands (bands mode only)',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['drift', 'rotate', 'sculpt'], default: 'drift',
    help: 'drift: pan through the field | rotate: spin sample coordinates | sculpt: ridge offset oscillates — ridges grow and dissolve',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    group: 'Flow/Motion',
  },
};

export const noiseRidged: Generator = {
  id: 'noise-ridged',
  family: 'noise',
  styleName: 'Ridged Multifractal',
  definition: "Ken Musgrave's ridged multifractal — inverted absolute-value noise with cascading octave weights produces sharp mountain ridges, deep valleys, and eroded-terrain silhouettes",
  algorithmNotes:
    'At each octave: signal = max(0, offset − |noise|)², then signal is weighted by the previous octave\'s signal (cascade). The cascade forces high ridges to suppress fine-scale detail in adjacent valleys, creating the characteristic appearance of geological strata. With gain = 0.5 the octave amplitudes follow a geometric decay summing to ≤ 1; result is clamped to [0, 1]. The "sculpt" animation mode slowly oscillates the ridge offset, causing ridges to periodically sharpen to knife-edge peaks and then broaden into rolling hills.',
  parameterSchema,
  defaultParams: {
    scale: 2, octaves: 6, lacunarity: 2.0, gain: 0.5, offset: 1.0, sharpness: 2.0, warpAmount: 0,
    colorMode: 'palette', bandCount: 8, animMode: 'drift', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noise      = new SimplexNoise(seed);
    const warpNoise  = new SimplexNoise(seed + 89);
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const scale      = params.scale      ?? 2;
    const octaves    = Math.max(1, Math.min(10, (params.octaves ?? 6) | 0));
    const lacunarity = params.lacunarity ?? 2.0;
    const gain       = params.gain       ?? 0.5;
    const sharpness  = params.sharpness  ?? 2.0;
    const warpAmount = params.warpAmount ?? 0;
    const bandCount  = Math.max(2, (params.bandCount ?? 8) | 0);
    const t          = time * (params.speed ?? 0.5);
    const animMode   = params.animMode ?? 'drift';
    const nCenter    = 2 * scale;
    const rotAngle   = animMode === 'rotate' ? t * 0.08 : 0;
    const rotCos     = Math.cos(rotAngle), rotSin = Math.sin(rotAngle);

    // 'sculpt': offset oscillates between tight and broad ridges
    const offset = (params.offset ?? 1.0) *
      (animMode === 'sculpt' ? 1 + 0.35 * Math.sin(t * 0.4) : 1);

    const normFactor = 1 - gain;

    // Hoist conditions outside loop
    const isDrift  = animMode === 'drift';
    const isRotate = animMode === 'rotate';
    const colorMode = params.colorMode ?? 'palette';
    const isBands  = colorMode === 'bands';
    const isPeaks  = colorMode === 'peaks';
    const doWarp   = warpAmount > 0;
    const sharp2   = sharpness === 2.0;
    const invW = 4 * scale / w;
    const invH = 4 * scale / h;
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

        // Ridged multifractal (Musgrave) with configurable sharpness exponent
        let value = 0, weight = 1, amp = 1, freq = 1;
        for (let oct = 0; oct < octaves; oct++) {
          let s = Math.max(0, offset - Math.abs(noise.noise2D(nx * freq, ny * freq)));
          s = sharp2 ? s * s : Math.pow(s, sharpness);
          s *= weight;
          weight = Math.min(1, s * gain);
          value += s * amp;
          freq  *= lacunarity;
          amp   *= gain;
        }

        let v = Math.min(1, value * normFactor);

        if (isBands) {
          v = Math.floor(v * bandCount) / bandCount;
        } else if (isPeaks) {
          v = v > 0.6 ? (v - 0.6) / 0.4 : 0;
        }

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
  estimateCost(params) { return ((params.octaves ?? 6) * 100) | 0; },
};
