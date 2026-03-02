import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function jitteredGrid(count: number, w: number, h: number, rng: SeededRNG): [number, number][] {
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const pts: [number, number][] = [];
  for (let r = 0; r < rows && pts.length < count; r++) {
    for (let c = 0; c < cols && pts.length < count; c++) {
      pts.push([(c + 0.2 + rng.random() * 0.6) * cw, (r + 0.2 + rng.random() * 0.6) * ch]);
    }
  }
  while (pts.length < count) pts.push([rng.random() * w, rng.random() * h]);
  return pts;
}

function animateSites(base: [number, number][], amp: number, speed: number, time: number): [number, number][] {
  return base.map(([bx, by], i) => {
    const ph = i * 2.39996;
    return [bx + Math.cos(time * speed + ph) * amp, by + Math.sin(time * speed * 1.3 + ph * 1.7) * amp];
  });
}

const parameterSchema: ParameterSchema = {
  cellCount: {
    name: 'Cell Count',
    type: 'number', min: 5, max: 150, step: 5, default: 40,
    group: 'Composition',
  },
  weightSpread: {
    name: 'Weight Spread',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.7,
    help: 'Variance in site weights — 0 = uniform (standard Voronoi), 1 = maximum size variation',
    group: 'Geometry',
  },
  weightMode: {
    name: 'Weight Mode',
    type: 'select',
    options: ['additive', 'multiplicative', 'power'],
    default: 'additive',
    help: 'additive: d−w (shifts boundary); multiplicative: d/w (scales cells); power: d^(1/w) (organic bulge)',
    group: 'Geometry',
  },
  borderWidth: {
    name: 'Border Width',
    type: 'number', min: 0, max: 5, step: 0.5, default: 1,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['By Index', 'By Weight', 'By Distance'],
    default: 'By Index',
    help: 'By Weight: larger-weighted sites use later palette colors',
    group: 'Color',
  },
  distanceMetric: {
    name: 'Distance Metric',
    type: 'select',
    options: ['Euclidean', 'Manhattan', 'Chebyshev'],
    default: 'Euclidean',
    group: 'Geometry',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 2, step: 0.05, default: 0.4,
    group: 'Flow/Motion',
  },
  animAmp: {
    name: 'Anim Amplitude',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.2,
    help: 'Drift distance as a fraction of average cell size',
    group: 'Flow/Motion',
  },
};

export const weightedVoronoi: Generator = {
  id: 'voronoi-weighted',
  family: 'voronoi',
  styleName: 'Weighted',
  definition: 'Voronoi diagram where each site has a random weight that distorts its region size, producing irregular organic cells',
  algorithmNotes: 'Each site i receives a random weight wᵢ drawn from a log-normal distribution. The effective distance from a pixel to site i is modified by wᵢ via additive (d−w), multiplicative (d/w), or power (d^(1/w)) modes. Weighted cells near the same size yield near-standard Voronoi; high spread creates dramatic size contrasts.',
  parameterSchema,
  defaultParams: {
    cellCount: 40, weightSpread: 0.7, weightMode: 'additive',
    borderWidth: 1, colorMode: 'By Index', distanceMetric: 'Euclidean',
    animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(5, params.cellCount | 0);
    const spread = Math.max(0, Math.min(1, params.weightSpread ?? 0.7));
    const mode = params.weightMode || 'additive';
    const borderW = params.borderWidth ?? 1;
    const colorMode = params.colorMode || 'By Index';

    const baseSites = jitteredGrid(count, w, h, rng);

    // Per-site weights: log-normal distribution scaled by spread
    // weight ∈ [0.2, 5] roughly, spread=0 → all weights ≈ 1
    const avgCellSize = Math.sqrt((w * h) / count);
    const weights: number[] = Array.from({ length: count }, () => {
      const u = rng.random() * 2 - 1; // uniform [-1, 1]
      return Math.exp(u * spread * 1.4); // log-normal
    });

    // Normalise weights so their effect is relative to avgCellSize
    const maxW = Math.max(...weights);
    const scaleW = avgCellSize * 0.5 * spread;

    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSites(baseSites, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

    const colors = palette.colors.map(hexToRgb);
    const metric = params.distanceMetric || 'Euclidean';
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        let wdMin = Infinity, wdMin2 = Infinity, nearest = 0;

        for (let i = 0; i < count; i++) {
          const dx = Math.abs(x - sites[i][0]), dy = Math.abs(y - sites[i][1]);
          let d: number;
          if (metric === 'Manhattan') d = dx + dy;
          else if (metric === 'Chebyshev') d = Math.max(dx, dy);
          else d = Math.sqrt(dx * dx + dy * dy);

          // Apply weight
          let wd: number;
          const wi = weights[i];
          if (mode === 'multiplicative') {
            wd = d / wi; // larger weight → smaller effective distance → bigger cell
          } else if (mode === 'power') {
            wd = d > 0 ? Math.pow(d, 1 / wi) : 0;
          } else {
            // additive: subtract weight scaled to cell size
            wd = d - (wi - 1) * scaleW;
          }

          if (wd < wdMin) { wdMin2 = wdMin; wdMin = wd; nearest = i; }
          else if (wd < wdMin2) { wdMin2 = wd; }
        }

        const isBorder = borderW > 0 && (wdMin2 - wdMin) < borderW;
        let r: number, g: number, b: number;

        if (isBorder) {
          r = g = b = 0;
        } else {
          let base: [number, number, number];
          if (colorMode === 'By Weight') {
            // Map normalised weight to palette
            const t = Math.min(1, (weights[nearest] - 0.1) / (maxW - 0.1 + 1e-6));
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            base = [
              (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
              (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
              (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
            ];
          } else if (colorMode === 'By Distance') {
            const t = Math.min(1, Math.max(0, wdMin) / (avgCellSize * 0.6));
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            base = [
              (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
              (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
              (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
            ];
          } else {
            base = colors[nearest % colors.length];
          }
          [r, g, b] = base;
        }

        for (let sy = 0; sy < pstep && y + sy < h; sy++) {
          for (let sx = 0; sx < pstep && x + sx < w; sx++) {
            const idx = ((y + sy) * w + (x + sx)) * 4;
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const c = gl.canvas as HTMLCanvasElement;
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    this.renderCanvas2D!(tmp.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost: (p) => p.cellCount * 500,
};
