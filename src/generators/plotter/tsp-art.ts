import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count',
    type: 'number', min: 50, max: 1500, step: 50, default: 600,
    help: 'Number of stipple points that form the TSP tour',
    group: 'Composition',
  },
  densityScale: {
    name: 'Density Scale',
    type: 'number', min: 0.3, max: 6, step: 0.1, default: 1.8,
    group: 'Composition',
  },
  densityContrast: {
    name: 'Density Contrast',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 2.0,
    group: 'Texture',
  },
  twoOptPasses: {
    name: '2-Opt Passes',
    type: 'number', min: 0, max: 8, step: 1, default: 2,
    help: 'Number of 2-opt improvement passes — more = shorter tour, slower render',
    group: 'Composition',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.25, max: 3, step: 0.25, default: 0.7,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-progress', 'density'],
    default: 'monochrome',
    help: 'monochrome: single ink color | palette-progress: color shifts along tour | density: color by local noise density',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
  drift: {
    name: 'Drift',
    type: 'number', min: 0, max: 40, step: 1, default: 15,
    help: 'Point drift amplitude in pixels (animated only)',
    group: 'Flow/Motion',
  },
  driftSpeed: {
    name: 'Drift Speed',
    type: 'number', min: 0.02, max: 0.5, step: 0.02, default: 0.1,
    group: 'Flow/Motion',
  },
};

export const tspArt: Generator = {
  id: 'plotter-tsp',
  family: 'plotter',
  styleName: 'TSP Art',
  definition: 'Generates a single continuous tour through density-weighted stipple points using nearest-neighbour construction and 2-opt refinement',
  algorithmNotes: 'A SimplexNoise density field biases point placement via rejection sampling. An O(n²) nearest-neighbour greedy tour is constructed, then improved with a configurable number of 2-opt swap passes to reduce total path length. The result is drawn as one unbroken stroke, approximating the TSP / single-line art aesthetic.',
  parameterSchema,
  defaultParams: {
    pointCount: 600, densityScale: 1.8, densityContrast: 2.0,
    twoOptPasses: 2, lineWidth: 0.7, colorMode: 'monochrome', background: 'cream',
    drift: 15, driftSpeed: 0.1,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const target = params.pointCount ?? 400;
    const dScale = params.densityScale ?? 1.8;
    const dContrast = params.densityContrast ?? 2.0;
    const optPasses = Math.max(0, params.twoOptPasses ?? 3) | 0;
    const isDark = params.background === 'dark';

    const densityFn = (x: number, y: number): number => {
      // +5 offset keeps canvas center away from FBM origin (which is always 0)
      const n = noise.fbm((x / w - 0.5) * dScale + 5, (y / h - 0.5) * dScale + 5, 4, 2, 0.5);
      return Math.pow(Math.max(0, n * 0.5 + 0.5), dContrast);
    };

    // Phase 1: jittered grid — guarantees uniform canvas coverage for ~half the points.
    const pts: [number, number][] = [];
    const baseCount = Math.floor(target * 0.5);
    const cols = Math.max(1, Math.ceil(Math.sqrt(baseCount * (w / h))));
    const rows = Math.max(1, Math.ceil(baseCount / cols));
    const cellW = w / cols, cellH = h / rows;
    for (let row = 0; row < rows && pts.length < baseCount; row++) {
      for (let col = 0; col < cols && pts.length < baseCount; col++) {
        pts.push([(col + rng.random()) * cellW, (row + rng.random()) * cellH]);
      }
    }

    // Phase 2: density-weighted random points for artistic variation.
    const maxAttempts = (target - pts.length) * 30;
    let attempts = 0;
    while (pts.length < target && attempts < maxAttempts) {
      attempts++;
      const x = rng.random() * w;
      const y = rng.random() * h;
      const effectiveDensity = 0.25 + densityFn(x, y) * 0.75;
      if (rng.random() < effectiveDensity) pts.push([x, y]);
    }

    if (pts.length < 3) return;
    const n = pts.length;

    // Nearest-neighbour greedy tour construction
    const visited = new Uint8Array(n);
    const tour: number[] = new Array(n);
    tour[0] = 0;
    visited[0] = 1;

    for (let step = 1; step < n; step++) {
      const [cx, cy] = pts[tour[step - 1]];
      let bestIdx = -1, bestD2 = Infinity;
      for (let j = 0; j < n; j++) {
        if (visited[j]) continue;
        const dx = cx - pts[j][0], dy = cy - pts[j][1];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestIdx = j; }
      }
      tour[step] = bestIdx;
      visited[bestIdx] = 1;
    }

    // 2-opt improvement
    const dist2 = (a: number, b: number): number => {
      const dx = pts[a][0] - pts[b][0], dy = pts[a][1] - pts[b][1];
      return dx * dx + dy * dy;
    };

    for (let pass = 0; pass < optPasses; pass++) {
      let improved = false;
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 2; j < n; j++) {
          if (j === n - 1 && i === 0) continue; // skip wrap-around edge
          const a = tour[i], b = tour[i + 1];
          const c = tour[j], d = tour[(j + 1) % n];
          const before = dist2(a, b) + dist2(c, d);
          const after = dist2(a, c) + dist2(b, d);
          if (after < before - 1e-6) {
            // Reverse segment between i+1 and j
            let lo = i + 1, hi = j;
            while (lo < hi) {
              const tmp = tour[lo]; tour[lo] = tour[hi]; tour[hi] = tmp;
              lo++; hi--;
            }
            improved = true;
          }
        }
      }
      if (!improved) break;
    }

    // Noise drift for animation — zero displacement at time=0 keeps static render identical
    const driftAmt = params.drift ?? 15;
    const driftSpd = params.driftSpeed ?? 0.1;
    const drawPts: [number, number][] = driftAmt > 0 && time > 0
      ? pts.map(([px, py], i) => [
          px + (noise.noise2D(i * 0.4, time * driftSpd) - noise.noise2D(i * 0.4, 0)) * driftAmt,
          py + (noise.noise2D(i * 0.4 + 77, time * driftSpd) - noise.noise2D(i * 0.4 + 77, 0)) * driftAmt,
        ])
      : pts;

    // Color setup
    const colors = palette.colors.map(hexToRgb);
    ctx.lineWidth = params.lineWidth ?? 0.7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const colorMode = params.colorMode || 'monochrome';

    if (colorMode === 'palette-progress') {
      // Draw in segments, each getting a color based on progress along tour
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        const cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        const cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        const cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.88 : 0.82})`;
        const [x1, y1] = drawPts[tour[i]];
        const [x2, y2] = drawPts[tour[(i + 1) % n]];
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    } else if (colorMode === 'density') {
      for (let i = 0; i < n; i++) {
        const [x1, y1] = drawPts[tour[i]];
        const d = densityFn(pts[tour[i]][0], pts[tour[i]][1]); // density from stable original position
        const ci = d * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        const cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        const cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        const cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        const [x2, y2] = drawPts[tour[(i + 1) % n]];
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.88 : 0.82})`;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    } else {
      // monochrome: single color, one path
      const [cr, cg, cb] = isDark ? [220, 220, 220] : [30, 30, 30];
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.85 : 0.78})`;
      ctx.beginPath();
      const [sx, sy] = drawPts[tour[0]];
      ctx.moveTo(sx, sy);
      for (let i = 1; i < n; i++) {
        const [x, y] = drawPts[tour[i]];
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    const n = params.pointCount ?? 600;
    const passes = params.twoOptPasses ?? 2;
    return Math.round(n * n * (1 + passes * 0.4) * 0.002);
  },
};
