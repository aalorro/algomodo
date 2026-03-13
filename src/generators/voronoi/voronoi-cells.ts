import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';
import {
  hexToRgb, metricFromName, jitteredGridFlat, animateSitesFlat,
  buildSiteGrid, findNearest, lloydRelax,
} from './voronoi-utils';

const parameterSchema: ParameterSchema = {
  cellCount: {
    name: 'Cell Count',
    type: 'number', min: 5, max: 200, step: 1, default: 40,
    group: 'Composition',
  },
  distanceMetric: {
    name: 'Distance Metric',
    type: 'select',
    options: ['Euclidean', 'Manhattan', 'Chebyshev'],
    default: 'Euclidean',
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
    options: ['By Index', 'By Distance', 'By Angle'],
    default: 'By Index',
    group: 'Color',
  },
  relaxed: {
    name: 'Relaxed',
    type: 'boolean', default: false,
    help: 'Apply Lloyd relaxation for more uniform cells',
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

export const voronoiCells: Generator = {
  id: 'voronoi-cells',
  family: 'voronoi',
  styleName: 'Voronoi Cells',
  definition: 'Partitions the canvas into regions based on proximity to seed points',
  algorithmNotes:
    'Flat Float64Array site storage with spatial-grid acceleration (5×5 cell search) reduces per-pixel cost from O(n) to O(~20). Euclidean mode uses squared distances in the inner loop, taking sqrt only for border detection. Border detected via f2−f1 gap. Sites use jittered-grid placement for even edge-to-edge coverage.',
  parameterSchema,
  defaultParams: {
    cellCount: 40, distanceMetric: 'Euclidean', borderWidth: 1,
    colorMode: 'By Index', relaxed: false, animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.min(Math.max(params.cellCount, 1), 200);
    const metric = metricFromName(params.distanceMetric || 'Euclidean');
    const borderWidth = params.borderWidth ?? 1;
    const colorMode = params.colorMode || 'By Index';

    const baseSites = jitteredGridFlat(count, w, h, rng);

    if (params.relaxed) {
      const lstep = Math.max(2, Math.floor(Math.min(w, h) / 150));
      lloydRelax(baseSites, count, w, h, metric, 1, lstep);
    }

    const avgCellSize = Math.sqrt((w * h) / count);
    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSitesFlat(baseSites, count, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

    const grid = buildSiteGrid(sites, count, w, h);
    const colors = palette.colors.map(hexToRgb);
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        const { nearest, d1, d2 } = findNearest(x, y, sites, grid, metric);
        const isBorder = borderWidth > 0 && (d2 - d1) < borderWidth;
        let r: number, g: number, b: number;
        if (isBorder) {
          r = g = b = 0;
        } else if (colorMode === 'By Index') {
          [r, g, b] = colors[nearest % colors.length];
        } else if (colorMode === 'By Distance') {
          const t = Math.min(1, d1 / (avgCellSize * 0.7));
          const i0 = Math.floor(t * (colors.length - 1));
          const i1 = Math.min(colors.length - 1, i0 + 1);
          const frac = t * (colors.length - 1) - i0;
          r = colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac;
          g = colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac;
          b = colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac;
        } else {
          const si2 = nearest * 2;
          const angle = Math.atan2(y - sites[si2 + 1], x - sites[si2]);
          const t = (angle + Math.PI) / (2 * Math.PI);
          [r, g, b] = colors[Math.floor(t * colors.length) % colors.length];
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
    const canvas = gl.canvas as HTMLCanvasElement;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
    this.renderCanvas2D!(tempCanvas.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost: (p) => p.cellCount * 500,
};
