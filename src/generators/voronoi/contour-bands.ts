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
    type: 'number', min: 3, max: 120, step: 3, default: 25,
    group: 'Composition',
  },
  bandCount: {
    name: 'Bands per Cell',
    type: 'number', min: 2, max: 20, step: 1, default: 8,
    help: 'Number of concentric contour rings around each seed',
    group: 'Composition',
  },
  bandMode: {
    name: 'Band Mode',
    type: 'select',
    options: ['hard', 'smooth', 'stepped'],
    default: 'hard',
    help: 'hard = crisp contour lines; smooth = continuous gradient; stepped = quantised levels',
    group: 'Texture',
  },
  contourLineWidth: {
    name: 'Contour Line',
    type: 'number', min: 0, max: 6, step: 0.5, default: 1,
    help: 'Width of the dark contour boundary (hard/stepped modes)',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-cycle', 'palette-gradient', 'monochrome'],
    default: 'palette-cycle',
    group: 'Color',
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

export const contourBands: Generator = {
  id: 'voronoi-contours',
  family: 'voronoi',
  styleName: 'Contour Bands',
  definition: 'Draws concentric topographic-style contour rings around each Voronoi seed point based on the nearest-distance field',
  algorithmNotes: 'Spatial-grid acceleration with flat Float64Array sites. d₁ quantised into evenly spaced bands; band boundaries produce contour lines. Three modes: hard (crisp), smooth (continuous), stepped (posterised).',
  parameterSchema,
  defaultParams: {
    cellCount: 25, bandCount: 8, bandMode: 'hard', contourLineWidth: 1,
    colorMode: 'palette-cycle', distanceMetric: 'Euclidean', relaxed: false,
    animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(3, params.cellCount | 0);
    const metric = metricFromName(params.distanceMetric || 'Euclidean');
    const bands = Math.max(2, params.bandCount | 0);

    const baseSites = jitteredGridFlat(count, w, h, rng);

    if (params.relaxed) {
      const lstep = Math.max(2, Math.floor(Math.min(w, h) / 100));
      lloydRelax(baseSites, count, w, h, metric, 1, lstep);
    }

    const avgRadius = Math.sqrt((w * h) / count) * 0.65;
    const amp = (params.animAmp ?? 0.2) * Math.sqrt((w * h) / count);
    const sites = time > 0 && amp > 0
      ? animateSitesFlat(baseSites, count, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

    const grid = buildSiteGrid(sites, count, w, h);
    const colors = palette.colors.map(hexToRgb);
    const lineW = params.contourLineWidth ?? 1;
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        const { nearest, d1 } = findNearest(x, y, sites, grid, metric);

        const tRaw = Math.min(1, d1 / avgRadius);
        const bandIdx = tRaw * bands;
        const bandFloor = Math.floor(bandIdx);
        const bandFrac = bandIdx - bandFloor;

        const nearBoundary = lineW > 0 && (bandFrac < lineW / (avgRadius / bands) || bandFrac > 1 - lineW / (avgRadius / bands));

        let r: number, g: number, b: number;

        if (nearBoundary && params.bandMode !== 'smooth') {
          r = g = b = 0;
        } else {
          let t: number;
          if (params.bandMode === 'smooth') {
            t = tRaw;
          } else {
            t = bandFloor / bands;
          }

          if (params.colorMode === 'monochrome') {
            const v = (t * 255) | 0;
            r = g = b = v;
          } else if (params.colorMode === 'palette-gradient') {
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
            g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
            b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
          } else {
            const ci = (bandFloor + nearest) % colors.length;
            [r, g, b] = colors[ci];
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

  estimateCost: (p) => p.cellCount * 300,
};
