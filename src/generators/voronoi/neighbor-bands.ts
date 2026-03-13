import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';
import {
  hexToRgb, metricFromName, jitteredGridFlat, animateSitesFlat,
  buildSiteGrid, findKNearest, lloydRelax,
} from './voronoi-utils';

const parameterSchema: ParameterSchema = {
  cellCount: {
    name: 'Cell Count',
    type: 'number', min: 5, max: 150, step: 5, default: 35,
    group: 'Composition',
  },
  bandCount: {
    name: 'Band Count',
    type: 'number', min: 1, max: 12, step: 1, default: 4,
    help: 'Number of concentric neighbor rings around each cell — each ring gets the next palette color',
    group: 'Composition',
  },
  bandMode: {
    name: 'Band Mode',
    type: 'select',
    options: ['flat', 'gradient', 'alternating'],
    default: 'flat',
    help: 'flat = solid color per ring; gradient = smooth blend between rings; alternating = rings flip between two palette ends',
    group: 'Texture',
  },
  borderWidth: {
    name: 'Border Width',
    type: 'number', min: 0, max: 4, step: 0.5, default: 1,
    group: 'Geometry',
  },
  distanceMetric: {
    name: 'Distance Metric',
    type: 'select',
    options: ['Euclidean', 'Manhattan', 'Chebyshev'],
    default: 'Euclidean',
    group: 'Geometry',
  },
  relaxed: {
    name: 'Lloyd Relaxed',
    type: 'boolean', default: false,
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

export const neighborBands: Generator = {
  id: 'voronoi-neighbor-bands',
  family: 'voronoi',
  styleName: 'Neighbor Bands',
  definition: 'Colors each pixel by how many Voronoi boundaries it sits away from the nearest seed, producing concentric ring patterns across the diagram',
  algorithmNotes: 'Grid-accelerated k-nearest search with wider 7×7 window and Float32Array/Int32Array reusable buffers. Spatial grid reduces per-pixel candidate set from O(n) to O(~30). Insertion sort on the small candidate set keeps the top-k distances.',
  parameterSchema,
  defaultParams: {
    cellCount: 35, bandCount: 4, bandMode: 'flat',
    borderWidth: 1, distanceMetric: 'Euclidean', relaxed: false,
    animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(5, params.cellCount | 0);
    const metric = metricFromName(params.distanceMetric || 'Euclidean');
    const bandCount = Math.max(1, Math.min(params.bandCount | 0, count - 1));
    const borderW = params.borderWidth ?? 1;
    const bandMode = params.bandMode || 'flat';

    const baseSites = jitteredGridFlat(count, w, h, rng);

    if (params.relaxed) {
      const lstep = Math.max(2, Math.floor(Math.min(w, h) / 120));
      lloydRelax(baseSites, count, w, h, metric, 1, lstep);
    }

    const avgCellSize = Math.sqrt((w * h) / count);
    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSitesFlat(baseSites, count, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

    const grid = buildSiteGrid(sites, count, w, h);
    const colors = palette.colors.map(hexToRgb);

    const k = bandCount + 1;
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Reusable buffers for k-nearest search
    const distBuf = new Float32Array(k);
    const idxBuf = new Int32Array(k);

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        findKNearest(x, y, sites, grid, metric, k, distBuf, idxBuf);

        const d1 = distBuf[0];
        const d2 = distBuf[1];

        const isBorder = borderW > 0 && (d2 - d1) < borderW;

        let r: number, g: number, b: number;

        if (isBorder) {
          r = g = b = 0;
        } else {
          const spacing = avgCellSize * 0.6;
          let band = 0;
          for (let b = 1; b < k; b++) {
            if (distBuf[b] - d1 < spacing * b) band = b;
            else break;
          }
          band = Math.min(band, bandCount - 1);

          if (bandMode === 'alternating') {
            const base = band % 2 === 0 ? colors[0] : colors[colors.length - 1];
            [r, g, b] = base;
          } else if (bandMode === 'gradient') {
            const t = band / (bandCount - 1 || 1);
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
            g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
            b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
          } else {
            [r, g, b] = colors[band % colors.length];
          }
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

  estimateCost: (p) => p.cellCount * 600,
};
