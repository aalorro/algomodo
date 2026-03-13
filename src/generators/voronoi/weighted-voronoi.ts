import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';
import {
  hexToRgb, metricFromName, jitteredGridFlat, animateSitesFlat,
  buildSiteGrid, METRIC_EUCLIDEAN, METRIC_MANHATTAN,
} from './voronoi-utils';
import type { SiteGrid } from './voronoi-utils';

/**
 * Weighted nearest-neighbor search using spatial grid.
 * Weights change the effective distance so we must check all candidates in the
 * grid neighbourhood — but the grid still massively narrows the set vs brute-force.
 * For power mode with high weight variance the winner may be far away, so we use
 * a wider 7×7 search window.
 */
function findNearestWeighted(
  x: number, y: number,
  sites: Float64Array, grid: SiteGrid,
  metric: number,
  weights: Float64Array, mode: string, scaleW: number,
  radius: number,
): { nearest: number; wd1: number; wd2: number } {
  const gs = grid.size;
  const gx = Math.min(gs - 1, Math.max(0, (x * grid.invW * gs) | 0));
  const gy = Math.min(gs - 1, Math.max(0, (y * grid.invH * gs) | 0));

  // Wider search for weighted — power mode can shift winners farther
  const r = radius;
  const ylo = gy > r ? gy - r : 0;
  const yhi = gy < gs - r ? gy + r : gs - 1;
  const xlo = gx > r ? gx - r : 0;
  const xhi = gx < gs - r ? gx + r : gs - 1;

  let wd1 = Infinity, wd2 = Infinity, nearest = 0;
  const useSquared = metric === METRIC_EUCLIDEAN;
  const isPower = mode === 'power';
  const isMult = mode === 'multiplicative';

  for (let cy = ylo; cy <= yhi; cy++) {
    const rowOff = cy * gs;
    for (let cx = xlo; cx <= xhi; cx++) {
      const ci = rowOff + cx;
      const off = grid.offsets[ci];
      const cnt = grid.counts[ci];
      for (let k = 0; k < cnt; k++) {
        const si = grid.cells[off + k];
        const si2 = si * 2;
        const dx = x - sites[si2];
        const dy = y - sites[si2 + 1];
        let d: number;
        if (useSquared) {
          d = Math.sqrt(dx * dx + dy * dy);
        } else if (metric === METRIC_MANHATTAN) {
          d = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
        } else {
          d = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy);
        }

        const wi = weights[si];
        let wd: number;
        if (isMult) {
          wd = d / wi;
        } else if (isPower) {
          wd = d > 0 ? Math.pow(d, 1 / wi) : 0;
        } else {
          wd = d - (wi - 1) * scaleW;
        }

        if (wd < wd1) { wd2 = wd1; wd1 = wd; nearest = si; }
        else if (wd < wd2) { wd2 = wd; }
      }
    }
  }

  return { nearest, wd1, wd2 };
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
  algorithmNotes: 'Spatial-grid acceleration with flat Float64Array sites. Each site receives a log-normal weight. Effective distance modified via additive (d−w), multiplicative (d/w), or power (d^(1/w)) modes. Power mode uses a wider 7×7 grid search to account for weight-shifted winners.',
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
    const metric = metricFromName(params.distanceMetric || 'Euclidean');

    const baseSites = jitteredGridFlat(count, w, h, rng);

    const avgCellSize = Math.sqrt((w * h) / count);
    const weights = new Float64Array(count);
    let maxW = 0;
    for (let i = 0; i < count; i++) {
      const u = rng.random() * 2 - 1;
      weights[i] = Math.exp(u * spread * 1.4);
      if (weights[i] > maxW) maxW = weights[i];
    }
    const scaleW = avgCellSize * 0.5 * spread;

    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSitesFlat(baseSites, count, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

    const grid = buildSiteGrid(sites, count, w, h);
    // Power mode can shift winners farther, use wider search
    const searchRadius = mode === 'power' ? 3 : 2;

    const colors = palette.colors.map(hexToRgb);
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        const { nearest, wd1, wd2 } = findNearestWeighted(
          x, y, sites, grid, metric, weights, mode, scaleW, searchRadius,
        );

        const isBorder = borderW > 0 && (wd2 - wd1) < borderW;
        let r: number, g: number, b: number;

        if (isBorder) {
          r = g = b = 0;
        } else {
          let base: [number, number, number];
          if (colorMode === 'By Weight') {
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
            const t = Math.min(1, Math.max(0, wd1) / (avgCellSize * 0.6));
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
