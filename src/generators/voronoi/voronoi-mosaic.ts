import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function getDist(metric: string, ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  if (metric === 'Manhattan') return dx + dy;
  if (metric === 'Chebyshev') return Math.max(dx, dy);
  return Math.sqrt(dx * dx + dy * dy);
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
  algorithmNotes: 'Cells are colored by index/angle/distance from the palette. Grout is detected via the f₂−f₁ gap. Raised and inset modes add a directional brightness gradient inside each tile. Sites use jittered-grid placement for full-canvas coverage.',
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
    const metric = params.distanceMetric || 'Euclidean';
    const groutW = params.groutWidth ?? 3;

    let baseSites = jitteredGrid(count, w, h, rng);

    if (params.relaxed) {
      const sumX = new Array(count).fill(0), sumY = new Array(count).fill(0), cnt = new Array(count).fill(0);
      const lstep = Math.max(2, Math.floor(Math.min(w, h) / 150));
      for (let y = 0; y < h; y += lstep) {
        for (let x = 0; x < w; x += lstep) {
          let best = 0, bestD = Infinity;
          for (let i = 0; i < count; i++) {
            const d = getDist(metric, x, y, baseSites[i][0], baseSites[i][1]);
            if (d < bestD) { bestD = d; best = i; }
          }
          sumX[best] += x; sumY[best] += y; cnt[best]++;
        }
      }
      for (let i = 0; i < count; i++) if (cnt[i] > 0) baseSites[i] = [sumX[i] / cnt[i], sumY[i] / cnt[i]];
    }

    const avgCellSize = Math.sqrt((w * h) / count);
    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSites(baseSites, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

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
        let d1 = Infinity, d2 = Infinity, nearest = 0;
        for (let i = 0; i < count; i++) {
          const d = getDist(metric, x, y, sites[i][0], sites[i][1]);
          if (d < d1) { d2 = d1; d1 = d; nearest = i; }
          else if (d < d2) { d2 = d; }
        }

        const isGrout = groutW > 0 && (d2 - d1) < groutW;

        let r: number, g: number, b: number;
        if (isGrout) {
          [r, g, b] = groutRgb;
        } else {
          let base: [number, number, number];
          if (params.colorMode === 'palette-angle') {
            const angle = Math.atan2(y - sites[nearest][1], x - sites[nearest][0]);
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
