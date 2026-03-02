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
  shardCount: {
    name: 'Shard Count',
    type: 'number', min: 5, max: 100, step: 5, default: 25,
    help: 'Number of primary fracture regions',
    group: 'Composition',
  },
  fractureCount: {
    name: 'Fracture Lines',
    type: 'number', min: 10, max: 200, step: 10, default: 60,
    help: 'Secondary crack density within each shard',
    group: 'Composition',
  },
  crackWidth: {
    name: 'Crack Width',
    type: 'number', min: 0.5, max: 6, step: 0.5, default: 1.5,
    help: 'Width of primary shard boundaries',
    group: 'Geometry',
  },
  fractureWidth: {
    name: 'Fracture Width',
    type: 'number', min: 0.2, max: 3, step: 0.1, default: 0.8,
    help: 'Width of secondary fracture lines within shards',
    group: 'Geometry',
  },
  shadeStrength: {
    name: 'Shard Shading',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.5,
    help: 'Directional brightness gradient within each shard to suggest 3D tilt',
    group: 'Texture',
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
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 2, step: 0.05, default: 0.3,
    group: 'Flow/Motion',
  },
  animAmp: {
    name: 'Anim Amplitude',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.15,
    help: 'Drift distance as a fraction of average cell size',
    group: 'Flow/Motion',
  },
};

export const fractured: Generator = {
  id: 'voronoi-fractured',
  family: 'voronoi',
  styleName: 'Fractured',
  definition: 'Two-scale Voronoi fracture pattern simulating shattered glass or stone, with per-shard directional shading',
  algorithmNotes: 'Primary Voronoi cells define large shards separated by thick cracks. A denser secondary diagram overlays fine fracture lines within each shard. Each shard receives a seeded random tilt direction that creates a brightness gradient, giving the impression of independently angled 3D facets.',
  parameterSchema,
  defaultParams: {
    shardCount: 25, fractureCount: 60, crackWidth: 1.5, fractureWidth: 0.8,
    shadeStrength: 0.5, colorMode: 'palette-cycle', distanceMetric: 'Euclidean',
    animSpeed: 0.3, animAmp: 0.15,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const shardCount = Math.max(5, params.shardCount | 0);
    const fractureCount = Math.max(10, params.fractureCount | 0);
    const metric = params.distanceMetric || 'Euclidean';
    const crackW = params.crackWidth ?? 1.5;
    const fracW = params.fractureWidth ?? 0.8;
    const shadeStr = params.shadeStrength ?? 0.5;

    const baseShards = jitteredGrid(shardCount, w, h, rng);
    const baseFractures = jitteredGrid(fractureCount, w, h, rng);

    // Per-shard random tilt direction (fixed by seed)
    const tiltAngle: number[] = Array.from({ length: shardCount }, () => rng.random() * Math.PI * 2);

    const avgCellSize = Math.sqrt((w * h) / shardCount);
    const amp = (params.animAmp ?? 0.15) * avgCellSize;
    const speed = params.animSpeed ?? 0.3;
    const shards = time > 0 && amp > 0 ? animateSites(baseShards, amp, speed, time) : baseShards;
    // Fractures move at half amplitude for a parallax-like effect
    const fractures = time > 0 && amp > 0 ? animateSites(baseFractures, amp * 0.5, speed, time) : baseFractures;

    const colors = palette.colors.map(hexToRgb);
    const step = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        // Primary Voronoi (shards)
        let d1p = Infinity, d2p = Infinity, nearestP = 0;
        for (let i = 0; i < shardCount; i++) {
          const d = getDist(metric, x, y, shards[i][0], shards[i][1]);
          if (d < d1p) { d2p = d1p; d1p = d; nearestP = i; }
          else if (d < d2p) { d2p = d; }
        }

        // Secondary Voronoi (fractures)
        let d1s = Infinity, d2s = Infinity;
        for (let i = 0; i < fractureCount; i++) {
          const d = getDist(metric, x, y, fractures[i][0], fractures[i][1]);
          if (d < d1s) { d2s = d1s; d1s = d; }
          else if (d < d2s) { d2s = d; }
        }

        const isPrimary = crackW > 0 && (d2p - d1p) < crackW;
        const isFracture = !isPrimary && fracW > 0 && (d2s - d1s) < fracW;

        let r: number, g: number, b: number;

        if (isPrimary) {
          r = g = b = 0;
        } else if (isFracture) {
          r = g = b = 18;
        } else {
          // Base cell color
          let base: [number, number, number];
          if (params.colorMode === 'monochrome') {
            const v = 60 + (nearestP % 12) * 15;
            base = [Math.min(255, v), Math.min(255, v), Math.min(255, v)];
          } else if (params.colorMode === 'palette-gradient') {
            const t = (shards[nearestP][0] / w + shards[nearestP][1] / h) / 2;
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            base = [
              (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
              (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
              (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
            ];
          } else {
            base = colors[nearestP % colors.length];
          }

          // Directional shading — linear gradient within each shard to suggest tilt
          if (shadeStr > 0) {
            const ta = tiltAngle[nearestP];
            const dx = x - shards[nearestP][0], dy = y - shards[nearestP][1];
            const dot = (Math.cos(ta) * dx + Math.sin(ta) * dy) / (avgCellSize * 0.65);
            const sc = Math.max(0.25, Math.min(1.75, 1 + dot * shadeStr * 0.55));
            base = [
              Math.min(255, base[0] * sc) | 0,
              Math.min(255, base[1] * sc) | 0,
              Math.min(255, base[2] * sc) | 0,
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

  estimateCost: (p) => ((p.shardCount ?? 25) + (p.fractureCount ?? 60)) * 550,
};
