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
    type: 'number', min: 5, max: 200, step: 5, default: 50,
    group: 'Composition',
  },
  relaxationSteps: {
    name: 'Relaxation Steps',
    type: 'number', min: 0, max: 15, step: 1, default: 5,
    help: 'Lloyd relaxation passes — more steps = more regular hexagonal cells',
    group: 'Geometry',
  },
  borderWidth: {
    name: 'Border Width',
    type: 'number', min: 0, max: 6, step: 0.5, default: 1.5,
    group: 'Geometry',
  },
  showSeeds: {
    name: 'Show Seeds',
    type: 'boolean', default: false,
    help: 'Draw the centroid seed point in each cell',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['By Index', 'By Distance', 'By Position'],
    default: 'By Index',
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

export const centroidalVoronoi: Generator = {
  id: 'centroidal-voronoi',
  family: 'voronoi',
  styleName: 'Centroidal Voronoi',
  definition: 'Iteratively relaxes Voronoi seed points toward cell centroids to produce highly regular, near-hexagonal tilings',
  algorithmNotes: 'Grid-accelerated Lloyd relaxation: each pass rebuilds a spatial grid so centroid sampling uses O(~20) distance checks per pixel instead of O(n). Flat Float64Array site storage for cache locality. Jittered-grid initial placement ensures full-canvas coverage.',
  parameterSchema,
  defaultParams: {
    cellCount: 50, relaxationSteps: 5, borderWidth: 1.5,
    showSeeds: false, colorMode: 'By Index', distanceMetric: 'Euclidean',
    animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(5, params.cellCount | 0);
    const metric = metricFromName(params.distanceMetric || 'Euclidean');
    const steps = Math.max(0, (params.relaxationSteps ?? 5) | 0);

    const baseSites = jitteredGridFlat(count, w, h, rng);

    const lstep = Math.max(2, Math.floor(Math.min(w, h) / 120));
    lloydRelax(baseSites, count, w, h, metric, steps, lstep);

    const avgCellSize = Math.sqrt((w * h) / count);
    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSitesFlat(baseSites, count, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

    const grid = buildSiteGrid(sites, count, w, h);
    const colors = palette.colors.map(hexToRgb);
    const borderW = params.borderWidth ?? 1.5;
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        const { nearest, d1, d2 } = findNearest(x, y, sites, grid, metric);

        const isBorder = borderW > 0 && (d2 - d1) < borderW;
        let r: number, g: number, b: number;
        if (isBorder) {
          r = g = b = 0;
        } else if (params.colorMode === 'By Distance') {
          const t = Math.min(1, d1 / (avgCellSize * 0.6));
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        } else if (params.colorMode === 'By Position') {
          const si2 = nearest * 2;
          const t = (sites[si2] / w + sites[si2 + 1] / h) / 2;
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        } else {
          [r, g, b] = colors[nearest % colors.length];
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

    if (params.showSeeds) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const dotR = Math.max(2, w * 0.003);
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.arc(sites[i * 2], sites[i * 2 + 1], dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const c = gl.canvas as HTMLCanvasElement;
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    this.renderCanvas2D!(tmp.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost: (p) => p.cellCount * (200 + (p.relaxationSteps ?? 5) * 80),
};
