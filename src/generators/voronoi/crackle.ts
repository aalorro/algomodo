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
  algorithmNotes: 'For each pixel the crackle value is f₂−f₁ (second-nearest minus nearest distance). Small values indicate proximity to a Voronoi edge and are drawn as cracks; larger values are filled. Sites use jittered-grid placement for full-canvas coverage.',
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
    const metric = params.distanceMetric || 'Euclidean';
    const crackW = params.crackWidth ?? 2;

    const baseSites = jitteredGrid(count, w, h, rng);
    const avgCellSize = Math.sqrt((w * h) / count);
    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSites(baseSites, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

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
        let d1 = Infinity, d2 = Infinity, nearest = 0;
        for (let i = 0; i < count; i++) {
          const d = getDist(metric, x, y, sites[i][0], sites[i][1]);
          if (d < d1) { d2 = d1; d1 = d; nearest = i; }
          else if (d < d2) { d2 = d; }
        }

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
