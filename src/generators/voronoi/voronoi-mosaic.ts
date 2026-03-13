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
    type: 'number', min: 5, max: 200, step: 5, default: 60,
    group: 'Composition',
  },
  groutWidth: {
    name: 'Grout Width',
    type: 'number', min: 0, max: 12, step: 0.5, default: 3,
    help: 'Width of the grout lines between tiles',
    group: 'Geometry',
  },
  groutColor: {
    name: 'Grout Color',
    type: 'select',
    options: ['grey', 'white', 'black', 'palette-last'],
    default: 'grey',
    group: 'Color',
  },
  tileStyle: {
    name: 'Tile Style',
    type: 'select',
    options: ['flat', 'raised', 'inset'],
    default: 'flat',
    help: 'flat = solid color; raised/inset adds a shading gradient inside each tile',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-cycle', 'palette-angle', 'palette-distance'],
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
    type: 'boolean',
    default: true,
    help: 'Apply one pass of Lloyd relaxation for more uniform tiles',
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

export const voronoiMosaic: Generator = {
  id: 'voronoi-mosaic',
  family: 'voronoi',
  styleName: 'Mosaic',
  definition: 'Renders a tiled mosaic where each Voronoi cell becomes a colored tile with grout lines and optional bevel shading',
  algorithmNotes: 'Flat Float64Array site storage with spatial-grid acceleration (5×5 cell search) reduces per-pixel cost from O(n) to O(~20). Cells colored by index/angle/distance from palette. Grout detected via f₂−f₁ gap. Raised/inset modes add directional brightness gradient inside each tile.',
  parameterSchema,
  defaultParams: {
    cellCount: 60, groutWidth: 3, groutColor: 'grey', tileStyle: 'flat',
    colorMode: 'palette-cycle', distanceMetric: 'Euclidean', relaxed: true,
    animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(5, params.cellCount | 0);
    const metric = metricFromName(params.distanceMetric || 'Euclidean');
    const groutW = params.groutWidth ?? 3;

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

    const groutRgb: [number, number, number] =
      params.groutColor === 'white' ? [220, 220, 220] :
      params.groutColor === 'black' ? [20, 20, 20] :
      params.groutColor === 'palette-last' ? hexToRgb(palette.colors[palette.colors.length - 1]) :
      [110, 110, 110];

    const colors = palette.colors.map(hexToRgb);
    const step = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const { nearest, d1, d2 } = findNearest(x, y, sites, grid, metric);

        const isGrout = groutW > 0 && (d2 - d1) < groutW;

        let r: number, g: number, b: number;
        if (isGrout) {
          [r, g, b] = groutRgb;
        } else {
          let base: [number, number, number];
          if (params.colorMode === 'palette-angle') {
            const si2 = nearest * 2;
            const angle = Math.atan2(y - sites[si2 + 1], x - sites[si2]);
            const t = (angle + Math.PI) / (2 * Math.PI);
            base = colors[Math.floor(t * colors.length) % colors.length];
          } else if (params.colorMode === 'palette-distance') {
            const t = Math.min(1, d1 / (avgCellSize * 0.6));
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

          if (params.tileStyle !== 'flat') {
            const edgeDist = (d2 - d1) / Math.max(groutW, 1);
            const shade = Math.min(1, edgeDist / (avgCellSize * 0.5));
            const light = params.tileStyle === 'raised'
              ? 0.6 + shade * 0.4
              : 1.4 - shade * 0.4;
            base = [
              Math.min(255, base[0] * light) | 0,
              Math.min(255, base[1] * light) | 0,
              Math.min(255, base[2] * light) | 0,
            ];
          }

          [r, g, b] = base;
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

  estimateCost: (p) => p.cellCount * 450,
};
