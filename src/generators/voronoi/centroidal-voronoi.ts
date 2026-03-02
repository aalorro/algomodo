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
  algorithmNotes: 'Repeatedly executes Lloyd relaxation: computes the centroid of each cell, then moves the site to that centroid. More steps produce tighter hexagonal packing. Jittered-grid initial placement ensures full-canvas coverage.',
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
    const metric = params.distanceMetric || 'Euclidean';
    const steps = Math.max(0, (params.relaxationSteps ?? 5) | 0);

    let baseSites = jitteredGrid(count, w, h, rng);

    const lstep = Math.max(2, Math.floor(Math.min(w, h) / 120));
    for (let pass = 0; pass < steps; pass++) {
      const sumX = new Array(count).fill(0), sumY = new Array(count).fill(0), cnt = new Array(count).fill(0);
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

    const colors = palette.colors.map(hexToRgb);
    const borderW = params.borderWidth ?? 1.5;
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        let d1 = Infinity, d2 = Infinity, nearest = 0;
        for (let i = 0; i < count; i++) {
          const d = getDist(metric, x, y, sites[i][0], sites[i][1]);
          if (d < d1) { d2 = d1; d1 = d; nearest = i; }
          else if (d < d2) { d2 = d; }
        }

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
          const t = (sites[nearest][0] / w + sites[nearest][1] / h) / 2;
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
      for (const [sx, sy] of sites) {
        ctx.beginPath(); ctx.arc(sx, sy, dotR, 0, Math.PI * 2); ctx.fill();
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
