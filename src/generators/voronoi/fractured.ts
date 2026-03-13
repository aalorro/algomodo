import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';
import {
  hexToRgb, metricFromName, jitteredGridFlat, animateSitesFlat,
  buildSiteGrid, findNearest,
} from './voronoi-utils';

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
  algorithmNotes: 'Dual spatial-grid acceleration: primary shards and secondary fractures each get their own grid for O(~20) lookups instead of O(n). Flat Float64Array sites, squared-distance inner loop for Euclidean. Per-shard seeded tilt creates directional brightness gradient.',
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
    const metric = metricFromName(params.distanceMetric || 'Euclidean');
    const crackW = params.crackWidth ?? 1.5;
    const fracW = params.fractureWidth ?? 0.8;
    const shadeStr = params.shadeStrength ?? 0.5;

    const baseShards = jitteredGridFlat(shardCount, w, h, rng);
    const baseFractures = jitteredGridFlat(fractureCount, w, h, rng);

    // Per-shard random tilt direction (fixed by seed)
    const tiltAngle = new Float64Array(shardCount);
    for (let i = 0; i < shardCount; i++) tiltAngle[i] = rng.random() * Math.PI * 2;

    const avgCellSize = Math.sqrt((w * h) / shardCount);
    const amp = (params.animAmp ?? 0.15) * avgCellSize;
    const speed = params.animSpeed ?? 0.3;
    const shards = time > 0 && amp > 0 ? animateSitesFlat(baseShards, shardCount, amp, speed, time) : baseShards;
    const fractures = time > 0 && amp > 0 ? animateSitesFlat(baseFractures, fractureCount, amp * 0.5, speed, time) : baseFractures;

    // Build TWO spatial grids — one per site set
    const shardGrid = buildSiteGrid(shards, shardCount, w, h);
    const fractureGrid = buildSiteGrid(fractures, fractureCount, w, h);

    const colors = palette.colors.map(hexToRgb);
    const step = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        // Primary Voronoi (shards) — grid-accelerated
        const sp = findNearest(x, y, shards, shardGrid, metric);

        // Secondary Voronoi (fractures) — grid-accelerated
        const sf = findNearest(x, y, fractures, fractureGrid, metric);

        const isPrimary = crackW > 0 && (sp.d2 - sp.d1) < crackW;
        const isFracture = !isPrimary && fracW > 0 && (sf.d2 - sf.d1) < fracW;

        let r: number, g: number, b: number;

        if (isPrimary) {
          r = g = b = 0;
        } else if (isFracture) {
          r = g = b = 18;
        } else {
          const nearestP = sp.nearest;
          let base: [number, number, number];
          if (params.colorMode === 'monochrome') {
            const v = 60 + (nearestP % 12) * 15;
            base = [Math.min(255, v), Math.min(255, v), Math.min(255, v)];
          } else if (params.colorMode === 'palette-gradient') {
            const si2 = nearestP * 2;
            const t = (shards[si2] / w + shards[si2 + 1] / h) / 2;
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

          if (shadeStr > 0) {
            const ta = tiltAngle[nearestP];
            const si2 = nearestP * 2;
            const dx = x - shards[si2], dy = y - shards[si2 + 1];
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
