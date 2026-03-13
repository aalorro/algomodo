import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';
import {
  hexToRgb, metricFromName, jitteredGridFlat, animateSitesFlat,
  buildSiteGrid, findNearest,
} from './voronoi-utils';

const parameterSchema: ParameterSchema = {
  cellCount: {
    name: 'Cell Count',
    type: 'number', min: 5, max: 300, step: 5, default: 80,
    group: 'Composition',
  },
  crackWidth: {
    name: 'Crack Width',
    type: 'number', min: 0.5, max: 8, step: 0.5, default: 2,
    help: 'Thickness of crack lines',
    group: 'Geometry',
  },
  crackColor: {
    name: 'Crack Color',
    type: 'select',
    options: ['black', 'white', 'palette-first', 'palette-last'],
    default: 'black',
    group: 'Color',
  },
  fillMode: {
    name: 'Fill Mode',
    type: 'select',
    options: ['flat-dark', 'flat-light', 'gradient', 'palette'],
    default: 'gradient',
    help: 'How cell interiors are colored',
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

export const crackle: Generator = {
  id: 'voronoi-crackle',
  family: 'voronoi',
  styleName: 'Crackle',
  definition: 'Renders the gap between nearest and second-nearest Voronoi distances as a cracked ceramic / dried-mud texture',
  algorithmNotes: 'Spatial-grid acceleration with flat Float64Array sites reduces per-pixel nearest-neighbor search from O(n) to O(~20). Crackle value is f₂−f₁; small values drawn as cracks, larger values filled. Euclidean mode uses squared distances internally.',
  parameterSchema,
  defaultParams: {
    cellCount: 80, crackWidth: 2, crackColor: 'black',
    fillMode: 'gradient', distanceMetric: 'Euclidean', animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(5, params.cellCount | 0);
    const metric = metricFromName(params.distanceMetric || 'Euclidean');
    const crackW = params.crackWidth ?? 2;

    const baseSites = jitteredGridFlat(count, w, h, rng);
    const avgCellSize = Math.sqrt((w * h) / count);
    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSitesFlat(baseSites, count, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

    const grid = buildSiteGrid(sites, count, w, h);
    const colors = palette.colors.map(hexToRgb);
    const crackRgb: [number, number, number] =
      params.crackColor === 'white' ? [255, 255, 255] :
      params.crackColor === 'palette-first' ? hexToRgb(palette.colors[0]) :
      params.crackColor === 'palette-last' ? hexToRgb(palette.colors[palette.colors.length - 1]) :
      [0, 0, 0];

    const step = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const { nearest, d1, d2 } = findNearest(x, y, sites, grid, metric);

        const crackVal = d2 - d1;
        const isCrack = crackVal < crackW;

        let r: number, g: number, b: number;
        if (isCrack) {
          [r, g, b] = crackRgb;
        } else if (params.fillMode === 'flat-dark') {
          const v = 30 + (nearest % colors.length) * 10;
          r = g = b = Math.min(255, v);
        } else if (params.fillMode === 'flat-light') {
          const v = 180 + (nearest % colors.length) * 15;
          r = g = b = Math.min(255, v);
        } else if (params.fillMode === 'palette') {
          [r, g, b] = colors[nearest % colors.length];
        } else {
          const t = Math.min(1, d1 / (avgCellSize * 0.6));
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        }

        for (let sy = 0; sy < step && y + sy < h; sy++) {
          for (let sx = 0; sx < step && x + sx < w; sx++) {
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

  estimateCost: (p) => p.cellCount * 400,
};
