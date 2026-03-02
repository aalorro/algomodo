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
    name: 'Anim Mode', type: 'select', options: ['drift', 'sculpt'], default: 'drift',
    help: 'drift: pan through the field | sculpt: ridge offset oscillates over time — ridges grow and dissolve',
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
    scale: 2, octaves: 6, lacunarity: 2.0, gain: 0.5, offset: 1.0,
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

    // 'sculpt': offset oscillates between tight and broad ridges
    const offset = (params.offset ?? 1.0) *
      (animMode === 'sculpt' ? 1 + 0.35 * Math.sin(t * 0.4) : 1);

    // Normalisation: max sum of amplitudes = 1 / (1 - gain) for infinite octaves
    // Multiply result by (1 - gain) to normalise to ≈ [0, 1]
    const normFactor = 1 - gain;

    const step = quality === 'draft' ? 2 : 1;
    const img  = ctx.createImageData(w, h);
    const d    = img.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        let nx = (x / w) * 4 * scale;
        let ny = (y / h) * 4 * scale;
        if (animMode === 'drift') { nx += t * 0.04; ny += t * 0.027; }

        // Ridged multifractal (Musgrave)
        let value = 0, weight = 1, amp = 1, freq = 1;
        for (let oct = 0; oct < octaves; oct++) {
          let s = Math.abs(noise.noise2D(nx * freq, ny * freq));
          s = Math.max(0, offset - s);
          s *= s;
          s *= weight;
          weight = Math.min(1, s * gain);
          value += s * amp;
          freq  *= lacunarity;
          amp   *= gain;
        }

        let v = Math.min(1, value * normFactor);

        if (colorMode === 'bands') {
          v = Math.floor(v * bandCount) / bandCount;
        } else if (colorMode === 'peaks') {
          // Only peaks (> 0.6) colored, valleys collapsed to black
          v = v > 0.6 ? (v - 0.6) / 0.4 : 0;
        }

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
  estimateCost(params) { return ((params.octaves ?? 6) * 100) | 0; },
};
