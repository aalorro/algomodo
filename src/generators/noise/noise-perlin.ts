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
    name: 'Scale', type: 'number', min: 0.5, max: 12, step: 0.5, default: 3,
    help: 'Noise frequency — higher = more features per unit area',
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 6, step: 1, default: 1,
    help: '1 = pure single-frequency smooth field; 2–6 adds coarser layering without turbulence or ridges',
    group: 'Composition',
  },
  style: {
    name: 'Style', type: 'select', options: ['smooth', 'ridged', 'turbulent'], default: 'smooth',
    help: 'smooth: standard noise | ridged: sharp ridge lines | turbulent: billowy cloud-like abs(noise)',
    group: 'Geometry',
  },
  warpAmount: {
    name: 'Warp Amount', type: 'number', min: 0, max: 2, step: 0.1, default: 0,
    help: 'Domain warping for organic distortion',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['palette', 'bands'], default: 'palette',
    help: 'palette: smooth gradient through palette | bands: hard-edged contour steps',
    group: 'Color',
  },
  bandCount: {
    name: 'Band Count', type: 'number', min: 2, max: 24, step: 1, default: 6,
    help: 'Number of quantized contour bands (bands mode only)',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['drift', 'rotate'], default: 'drift',
    help: 'drift: pan through the infinite noise field | rotate: spin the sample coordinates around the canvas centre',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    group: 'Flow/Motion',
  },
};

export const noisePerlin: Generator = {
  id: 'noise-simplex-field',
  family: 'noise',
  styleName: 'Simplex Field',
  definition: 'Raw 2D Perlin / Simplex noise — the smooth random field that underlies all other noise styles',
  algorithmNotes:
    'Evaluates gradient noise at each pixel using a seeded permutation table and quintic (C²) interpolation between lattice-point gradients. With octaves = 1 the output is the archetypal single-frequency field: smooth, gently rounded hills and valleys with no self-similarity. Adding 2–6 octaves layers coarser fBm structure. Output ≈ [−1, 1] is shifted to [0, 1] for palette mapping. Animation pans or rotates the sample-coordinate frame without any state.',
  parameterSchema,
  defaultParams: { scale: 3, octaves: 1, style: 'smooth', warpAmount: 0, colorMode: 'palette', bandCount: 6, animMode: 'drift', speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noise   = new SimplexNoise(seed);
    const warpNoise = new SimplexNoise(seed + 77);
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const colors  = palette.colors.map(hexToRgb);
    const scale   = params.scale   ?? 3;
    const octaves = Math.max(1, Math.min(6, (params.octaves ?? 1) | 0));
    const style      = params.style      ?? 'smooth';
    const warpAmount = params.warpAmount  ?? 0;
    const colorMode  = params.colorMode ?? 'palette';
    const bandCount  = Math.max(2, (params.bandCount ?? 6) | 0);
    const t          = time * (params.speed ?? 0.5);
    const animMode   = params.animMode ?? 'drift';
    const nCenter    = 2 * scale;
    const angle      = animMode === 'rotate' ? t * 0.08 : 0;
    const cos        = Math.cos(angle), sin = Math.sin(angle);

    const step = quality === 'draft' ? 2 : 1;
    const img = ctx.createImageData(w, h);
    const d   = img.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        let nx = (x / w) * 4 * scale;
        let ny = (y / h) * 4 * scale;

        if (animMode === 'drift') {
          nx += t * 0.04; ny += t * 0.027;
        } else if (animMode === 'rotate') {
          const dx = nx - nCenter, dy = ny - nCenter;
          nx = nCenter + dx * cos - dy * sin;
          ny = nCenter + dx * sin + dy * cos;
        }

        // Domain warping
        if (warpAmount > 0) {
          const wx = warpNoise.fbm(nx, ny, 3, 2.0, 0.5);
          const wy = warpNoise.fbm(nx + 5.2, ny + 1.3, 3, 2.0, 0.5);
          nx += warpAmount * wx;
          ny += warpAmount * wy;
        }

        const raw = octaves === 1
          ? noise.noise2D(nx, ny)
          : noise.fbm(nx, ny, octaves, 2.0, 0.5);

        let v: number;
        if (style === 'ridged') {
          const ridge = 1 - Math.abs(raw);
          v = ridge * ridge;
        } else if (style === 'turbulent') {
          v = Math.abs(raw);
        } else {
          v = (raw + 1) * 0.5;
        }

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
  estimateCost(params) { return ((params.octaves ?? 1) * 80) | 0; },
};
