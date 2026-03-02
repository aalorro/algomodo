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
    type: 'number', min: 5, max: 150, step: 5, default: 35,
    group: 'Composition',
  },
  bandCount: {
    name: 'Band Count',
    type: 'number', min: 1, max: 12, step: 1, default: 4,
    help: 'Number of concentric neighbor rings around each cell — each ring gets the next palette color',
    group: 'Composition',
  },
  bandMode: {
    name: 'Band Mode',
    type: 'select',
    options: ['flat', 'gradient', 'alternating'],
    default: 'flat',
    help: 'flat = solid color per ring; gradient = smooth blend between rings; alternating = rings flip between two palette ends',
    group: 'Texture',
  },
  borderWidth: {
    name: 'Border Width',
    type: 'number', min: 0, max: 4, step: 0.5, default: 1,
    group: 'Geometry',
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

export const neighborBands: Generator = {
  id: 'voronoi-neighbor-bands',
  family: 'voronoi',
  styleName: 'Neighbor Bands',
  definition: 'Colors each pixel by how many Voronoi boundaries it sits away from the nearest seed, producing concentric ring patterns across the diagram',
  algorithmNotes: 'The "neighbor depth" of a pixel is derived from the ratio of the kth-nearest distance to the 1st-nearest distance. Pixels whose k-th nearest site is within a threshold become band k. This creates concentric rings that tile across all cells simultaneously, like contour lines following the topology of the entire Voronoi diagram.',
  parameterSchema,
  defaultParams: {
    cellCount: 35, bandCount: 4, bandMode: 'flat',
    borderWidth: 1, distanceMetric: 'Euclidean', relaxed: false,
    animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(5, params.cellCount | 0);
    const metric = params.distanceMetric || 'Euclidean';
    const bandCount = Math.max(1, Math.min(params.bandCount | 0, count - 1));
    const borderW = params.borderWidth ?? 1;
    const bandMode = params.bandMode || 'flat';

    let baseSites = jitteredGrid(count, w, h, rng);

    if (params.relaxed) {
      const sumX = new Array(count).fill(0), sumY = new Array(count).fill(0), cnt = new Array(count).fill(0);
      const lstep = Math.max(2, Math.floor(Math.min(w, h) / 120));
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

    // We need the k-nearest distances for each pixel (k up to bandCount+1)
    // Sort the top (bandCount+2) distances per pixel
    const k = bandCount + 1; // we need distances d1..dk

    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Reusable sorted distances buffer
    const dists = new Float32Array(k);

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        // Collect the k smallest distances
        dists.fill(Infinity);
        for (let i = 0; i < count; i++) {
          const d = getDist(metric, x, y, sites[i][0], sites[i][1]);
          if (d < dists[k - 1]) {
            dists[k - 1] = d;
            // Insertion sort to keep sorted
            let j = k - 1;
            while (j > 0 && dists[j] < dists[j - 1]) {
              const tmp = dists[j]; dists[j] = dists[j - 1]; dists[j - 1] = tmp;
              j--;
            }
          }
        }

        const d1 = dists[0]; // nearest
        const d2 = dists[1]; // 2nd nearest → band boundary

        // Detect border via d2-d1 gap
        const isBorder = borderW > 0 && (d2 - d1) < borderW;

        let r: number, g: number, b: number;

        if (isBorder) {
          r = g = b = 0;
        } else {
          // Determine which band this pixel belongs to.
          // Band 0: nearest cell (d[1]/d[0] ratio is large)
          // Band b: first band where d[b+1] - d[0] < threshold * b
          // Simpler: use the ratio d[b] / d[1] to assign band
          // Band b starts where d[b] < d[1] * (b + 1) * bandSpacing
          // We use: band = number of distances dk (k>1) that are < d1 * bandThreshold
          // With bandThreshold = average spacing between ranks
          //
          // Most direct approach: band = floor(d2 / d1) clamped to [0, bandCount-1]
          // But this doesn't scale. Better: band = floor((d2-d1)/d1 * scale)
          //
          // Practical approach: use the sorted order directly.
          // Compute how many of the k nearest sites are "close" relative to spacing.
          // band = argmin over b in [1..k-1] such that dists[b] > dists[0] * (1 + b * gap)

          // Simplest readable approach: band index from ratio of kth to 1st distance
          // Each band covers a ratio range of avgCellSize / d1
          const spacing = avgCellSize * 0.6;
          let band = 0;
          for (let b = 1; b < k; b++) {
            if (dists[b] - d1 < spacing * b) band = b;
            else break;
          }
          band = Math.min(band, bandCount - 1);

          const colors2 = colors;
          if (bandMode === 'alternating') {
            // Flip between first and last palette color per band
            const base = band % 2 === 0 ? colors2[0] : colors2[colors2.length - 1];
            [r, g, b] = base;
          } else if (bandMode === 'gradient') {
            const t = band / (bandCount - 1 || 1);
            const ci = t * (colors2.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors2.length - 1, i0 + 1);
            const f = ci - i0;
            r = (colors2[i0][0] + (colors2[i1][0] - colors2[i0][0]) * f) | 0;
            g = (colors2[i0][1] + (colors2[i1][1] - colors2[i0][1]) * f) | 0;
            b = (colors2[i0][2] + (colors2[i1][2] - colors2[i0][2]) * f) | 0;
          } else {
            // flat: cycle through palette per band
            [r, g, b] = colors2[band % colors2.length];
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

  estimateCost: (p) => p.cellCount * 600,
};
