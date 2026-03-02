import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return [r, g, b];
}

function getDist(metric: string, x1: number, y1: number, x2: number, y2: number): number {
  const dx = Math.abs(x1 - x2);
  const dy = Math.abs(y1 - y2);
  if (metric === 'Manhattan') return dx + dy;
  if (metric === 'Chebyshev') return Math.max(dx, dy);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Jittered grid — spreads sites evenly across the full canvas */
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

/** Animate sites: each site drifts on a per-site Lissajous path */
function animateSites(
  base: [number, number][],
  amp: number,
  speed: number,
  time: number,
): [number, number][] {
  return base.map(([bx, by], i) => {
    const ph = i * 2.39996;
    return [bx + Math.cos(time * speed + ph) * amp, by + Math.sin(time * speed * 1.3 + ph * 1.7) * amp];
  });
}

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
    'Each pixel is colored by nearest seed point using selected distance metric. Border detected via second-nearest gap. Sites use jittered-grid placement for even edge-to-edge coverage.',
  parameterSchema,
  defaultParams: {
    cellCount: 40, distanceMetric: 'Euclidean', borderWidth: 1,
    colorMode: 'By Index', relaxed: false, animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    clearCanvas(ctx, width, height, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.min(Math.max(params.cellCount, 1), 200);
    const metric = params.distanceMetric || 'Euclidean';
    const borderWidth = params.borderWidth ?? 1;
    const colorMode = params.colorMode || 'By Index';

    let baseSites = jitteredGrid(count, width, height, rng);

    if (params.relaxed) {
      const sumX = new Array(count).fill(0);
      const sumY = new Array(count).fill(0);
      const cnt = new Array(count).fill(0);
      const step = Math.max(2, Math.floor(Math.min(width, height) / 150));
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          let nearest = 0, minD = Infinity;
          for (let i = 0; i < count; i++) {
            const d = getDist(metric, x, y, baseSites[i][0], baseSites[i][1]);
            if (d < minD) { minD = d; nearest = i; }
          }
          sumX[nearest] += x; sumY[nearest] += y; cnt[nearest]++;
        }
      }
      for (let i = 0; i < count; i++) {
        if (cnt[i] > 0) baseSites[i] = [sumX[i] / cnt[i], sumY[i] / cnt[i]];
      }
    }

    const avgCellSize = Math.sqrt((width * height) / count);
    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const sites = time > 0 && amp > 0
      ? animateSites(baseSites, amp, params.animSpeed ?? 0.4, time)
      : baseSites;

    const colors = palette.colors.map(hexToRgb);
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y += pstep) {
      for (let x = 0; x < width; x += pstep) {
        let nearest = 0, minD = Infinity, minD2 = Infinity;
        for (let i = 0; i < count; i++) {
          const d = getDist(metric, x, y, sites[i][0], sites[i][1]);
          if (d < minD) { minD2 = minD; minD = d; nearest = i; }
          else if (d < minD2) { minD2 = d; }
        }
        const isBorder = borderWidth > 0 && (minD2 - minD) < borderWidth;
        let r: number, g: number, b: number;
        if (isBorder) {
          r = g = b = 0;
        } else if (colorMode === 'By Index') {
          [r, g, b] = colors[nearest % colors.length];
        } else if (colorMode === 'By Distance') {
          const t = Math.min(1, minD / (avgCellSize * 0.7));
          const i0 = Math.floor(t * (colors.length - 1));
          const i1 = Math.min(colors.length - 1, i0 + 1);
          const frac = t * (colors.length - 1) - i0;
          r = colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac;
          g = colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac;
          b = colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac;
        } else {
          const angle = Math.atan2(y - sites[nearest][1], x - sites[nearest][0]);
          const t = (angle + Math.PI) / (2 * Math.PI);
          [r, g, b] = colors[Math.floor(t * colors.length) % colors.length];
        }
        for (let sy = 0; sy < pstep && y + sy < height; sy++) {
          for (let sx = 0; sx < pstep && x + sx < width; sx++) {
            const idx = ((y + sy) * width + (x + sx)) * 4;
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
