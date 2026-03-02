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
    name: 'Scale', type: 'number', min: 0.5, max: 8, step: 0.5, default: 2.0,
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 8, step: 1, default: 5,
    help: 'Octaves for the final readout noise',
    group: 'Composition',
  },
  warpStrength: {
    name: 'Warp Strength', type: 'number', min: 0.0, max: 4.0, step: 0.1, default: 1.5,
    help: 'How far coordinates are displaced by the warp field — higher = more folded and tangled',
    group: 'Composition',
  },
  warpOctaves: {
    name: 'Warp Octaves', type: 'number', min: 1, max: 6, step: 1, default: 3,
    help: 'Complexity of the warp field itself — more octaves = finer warp detail',
    group: 'Geometry',
  },
  iterations: {
    name: 'Iterations', type: 'select', options: ['1', '2'], default: '1',
    help: '1: f(p + g(p)) — single warp pass | 2: f(p + g(p + g(p))) — iterated double warp; much more complex structure',
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
    name: 'Anim Mode', type: 'select', options: ['drift', 'flow'], default: 'flow',
    help: 'drift: translate all coordinates uniformly | flow: warp field phase shifts independently — the base structure stays put while the folds morph around it',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    group: 'Flow/Motion',
  },
};

export const noiseDomainWarp: Generator = {
  id: 'noise-domain-warp',
  family: 'noise',
  styleName: 'Domain Warp',
  definition: 'Iterated coordinate displacement — the sample position is offset by one fBm field before evaluating another, folding the noise into organic, turbulent swirls and interlocked filaments',
  algorithmNotes:
    'Domain warping (Inigo Quilez): instead of evaluating noise at (x, y) directly, displace the coordinates first — warpX = fBm(x, y), warpY = fBm(x+5.2, y+1.3) — then evaluate the readout noise at (x + strength·warpX, y + strength·warpY). With iterations = 2 the warped coordinates are fed back through a second warp field before the final readout, producing dramatically more folded structures. The fixed phase offsets (5.2, 1.3, 8.3, 2.8) ensure the two warp-axis noise fields are uncorrelated. The "flow" animation mode advances the warp field phase independently of the base coordinates, so the folding pattern slowly morphs in place.',
  parameterSchema,
  defaultParams: {
    scale: 2.0, octaves: 5, warpStrength: 1.5, warpOctaves: 3,
    iterations: '1', colorMode: 'palette', bandCount: 8, animMode: 'flow', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noiseBase = new SimplexNoise(seed);
    const noiseWarp = new SimplexNoise(seed + 7919); // prime offset for independence
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const colors       = palette.colors.map(hexToRgb);
    const scale        = params.scale        ?? 2.0;
    const octaves      = Math.max(1, Math.min(8, (params.octaves ?? 5) | 0));
    const warpStrength = params.warpStrength  ?? 1.5;
    const warpOctaves  = Math.max(1, Math.min(6, (params.warpOctaves ?? 3) | 0));
    const iters        = parseInt(params.iterations ?? '1', 10) || 1;
    const colorMode    = params.colorMode    ?? 'palette';
    const bandCount    = Math.max(2, (params.bandCount ?? 8) | 0);
    const t            = time * (params.speed ?? 0.5);
    const animMode     = params.animMode ?? 'flow';

    // 'flow': warp field phase drifts independently; base coords stay put
    const flowX = animMode === 'flow' ? t * 0.022 : 0;
    const flowY = animMode === 'flow' ? t * 0.017 : 0;

    const step = quality === 'draft' ? 2 : 1;
    const img  = ctx.createImageData(w, h);
    const d    = img.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        let nx = (x / w) * 4 * scale;
        let ny = (y / h) * 4 * scale;
        // 'drift': uniform translation of everything
        if (animMode === 'drift') { nx += t * 0.04; ny += t * 0.027; }

        // First warp pass
        const wx1 = noiseWarp.fbm(nx + flowX,         ny + flowY,         warpOctaves, 2.0, 0.5);
        const wy1 = noiseWarp.fbm(nx + 5.2 + flowX,   ny + 1.3 + flowY,   warpOctaves, 2.0, 0.5);
        let px = nx + warpStrength * wx1;
        let py = ny + warpStrength * wy1;

        // Optional second warp pass (iterated domain warp)
        if (iters >= 2) {
          const wx2 = noiseWarp.fbm(px + 8.3 + flowX * 0.7, py + 2.8 + flowY * 0.7, warpOctaves, 2.0, 0.5);
          const wy2 = noiseWarp.fbm(px + 1.7 + flowX * 0.7, py + 9.2 + flowY * 0.7, warpOctaves, 2.0, 0.5);
          px = nx + warpStrength * wx2;
          py = ny + warpStrength * wy2;
        }

        // Final readout
        let v = (noiseBase.fbm(px, py, octaves, 2.0, 0.5) + 1) * 0.5;
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
  estimateCost(params) {
    const iters = parseInt(params.iterations ?? '1', 10) || 1;
    return (((params.octaves ?? 5) + (params.warpOctaves ?? 3) * iters) * 100) | 0;
  },
};
