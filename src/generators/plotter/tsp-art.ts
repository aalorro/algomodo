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
  densityStyle: {
    name: 'Density Style',
    type: 'select',
    options: ['fbm', 'ridged', 'radial', 'turbulent'],
    default: 'fbm',
    help: 'Shape of the density field — fbm: smooth | ridged: sharp ridges | radial: center-focused | turbulent: creases',
    group: 'Composition',
  },
  twoOptPasses: {
    name: '2-Opt Passes',
    type: 'number', min: 0, max: 8, step: 1, default: 2,
    help: 'Number of 2-opt improvement passes — more = shorter tour, slower render',
    group: 'Composition',
  },
  pathStyle: {
    name: 'Path Style',
    type: 'select',
    options: ['straight', 'curved', 'dotted', 'dashed'],
    default: 'straight',
    help: 'straight: line segments | curved: smooth Bezier splines | dotted: dots at nodes with thin lines | dashed: dash pattern along path',
    group: 'Geometry',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 1.0, max: 3, step: 0.25, default: 1.0,
    group: 'Geometry',
  },
  lineWidthVar: {
    name: 'Width Variation',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0,
    help: 'Vary stroke width by local density — 0 = uniform, 1 = thick in dense regions, thin in sparse',
    group: 'Geometry',
  },
  closePath: {
    name: 'Close Path',
    type: 'boolean', default: true,
    help: 'Connect last point back to first, completing the tour loop',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-progress', 'density', 'segment-alternate'],
    default: 'monochrome',
    help: 'monochrome: single ink | palette-progress: shifts along tour | density: by noise field | segment-alternate: alternates palette colors per segment',
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
  algorithmNotes: 'A SimplexNoise density field biases point placement via rejection sampling. An O(n²) nearest-neighbour greedy tour is constructed, then improved with a configurable number of 2-opt swap passes to reduce total path length. The result is drawn as one unbroken stroke, approximating the TSP / single-line art aesthetic. Path style options include smooth Bezier curves, dotted nodes, and dashed segments.',
  parameterSchema,
  defaultParams: {
    pointCount: 600, densityScale: 1.8, densityContrast: 2.0, densityStyle: 'fbm',
    twoOptPasses: 2, pathStyle: 'straight', lineWidth: 1.0, lineWidthVar: 0, closePath: true,
    colorMode: 'monochrome', background: 'cream',
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
    const densityStyle = params.densityStyle ?? 'fbm';
    const optPasses = Math.max(0, params.twoOptPasses ?? 3) | 0;
    const isDark = params.background === 'dark';
    const pathStyle = params.pathStyle ?? 'straight';
    const baseLineWidth = params.lineWidth ?? 0.7;
    const lineWidthVar = params.lineWidthVar ?? 0;
    const shouldClose = params.closePath !== false;

    const densityFn = (x: number, y: number): number => {
      const nx = (x / w - 0.5) * dScale + 5;
      const ny = (y / h - 0.5) * dScale + 5;
      let n: number;
      if (densityStyle === 'ridged') {
        const raw = noise.fbm(nx, ny, 4, 2, 0.5);
        const ridge = 1 - Math.abs(raw);
        n = ridge * ridge;
      } else if (densityStyle === 'turbulent') {
        n = Math.abs(noise.fbm(nx, ny, 4, 2, 0.5));
      } else if (densityStyle === 'radial') {
        const dx = x / w - 0.5, dy = y / h - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy) * 2;
        const noiseVal = noise.fbm(nx, ny, 3, 2, 0.5) * 0.3;
        n = Math.max(0, 1 - dist + noiseVal);
      } else {
        n = noise.fbm(nx, ny, 4, 2, 0.5) * 0.5 + 0.5;
      }
      return Math.pow(Math.max(0, Math.min(1, n)), dContrast);
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
    const pn = pts.length;

    // Nearest-neighbour greedy tour construction
    const visited = new Uint8Array(pn);
    const tour: number[] = new Array(pn);
    tour[0] = 0;
    visited[0] = 1;

    for (let step = 1; step < pn; step++) {
      const [cx, cy] = pts[tour[step - 1]];
      let bestIdx = -1, bestD2 = Infinity;
      for (let j = 0; j < pn; j++) {
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
      for (let i = 0; i < pn - 1; i++) {
        for (let j = i + 2; j < pn; j++) {
          if (j === pn - 1 && i === 0) continue;
          const a = tour[i], b = tour[i + 1];
          const c = tour[j], d = tour[(j + 1) % pn];
          const before = dist2(a, b) + dist2(c, d);
          const after = dist2(a, c) + dist2(b, d);
          if (after < before - 1e-6) {
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

    // Noise drift for animation
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
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const colorMode = params.colorMode || 'monochrome';

    // Pre-compute densities for width variation
    const densities = lineWidthVar > 0 ? pts.map(([px, py]) => densityFn(px, py)) : null;

    // Helper: get color for segment i
    const getSegColor = (i: number): string => {
      const alpha = isDark ? 0.88 : 0.82;
      if (colorMode === 'palette-progress') {
        const t = i / (pn - 1);
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        const cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        const cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        const cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        return `rgba(${cr},${cg},${cb},${alpha})`;
      } else if (colorMode === 'density') {
        const d = densityFn(pts[tour[i]][0], pts[tour[i]][1]);
        const ci = d * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        const cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        const cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        const cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        return `rgba(${cr},${cg},${cb},${alpha})`;
      } else if (colorMode === 'segment-alternate') {
        const [cr, cg, cb] = colors[i % colors.length];
        return `rgba(${cr},${cg},${cb},${alpha})`;
      } else {
        const [cr, cg, cb] = isDark ? [220, 220, 220] : [30, 30, 30];
        return `rgba(${cr},${cg},${cb},${alpha})`;
      }
    };

    // Helper: get line width for segment i
    const getSegWidth = (i: number): number => {
      if (lineWidthVar <= 0 || !densities) return baseLineWidth;
      const d = densities[tour[i]];
      return baseLineWidth * (1 - lineWidthVar * 0.6 + d * lineWidthVar * 1.2);
    };

    const segCount = shouldClose ? pn : pn - 1;

    if (pathStyle === 'curved') {
      // Catmull-Rom-style smooth curves through tour points
      for (let i = 0; i < segCount; i++) {
        const i0 = tour[(i - 1 + pn) % pn];
        const i1 = tour[i];
        const i2 = tour[(i + 1) % pn];
        const i3 = tour[(i + 2) % pn];
        const [x0, y0] = drawPts[i0];
        const [x1, y1] = drawPts[i1];
        const [x2, y2] = drawPts[i2];
        const [x3, y3] = drawPts[i3];

        // Control points for cubic Bezier approximating Catmull-Rom
        const cp1x = x1 + (x2 - x0) / 6;
        const cp1y = y1 + (y2 - y0) / 6;
        const cp2x = x2 - (x3 - x1) / 6;
        const cp2y = y2 - (y3 - y1) / 6;

        ctx.strokeStyle = getSegColor(i);
        ctx.lineWidth = getSegWidth(i);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
        ctx.stroke();
      }
    } else if (pathStyle === 'dotted') {
      // Thin connecting lines + dots at each node
      // Draw thin connecting lines first
      const monoColor = getSegColor(0);
      if (colorMode === 'monochrome') {
        ctx.strokeStyle = monoColor;
        ctx.lineWidth = baseLineWidth * 0.3;
        ctx.beginPath();
        const [sx, sy] = drawPts[tour[0]];
        ctx.moveTo(sx, sy);
        for (let i = 1; i < pn; i++) {
          const [x, y] = drawPts[tour[i]];
          ctx.lineTo(x, y);
        }
        if (shouldClose) ctx.closePath();
        ctx.stroke();
      } else {
        ctx.lineWidth = baseLineWidth * 0.3;
        for (let i = 0; i < segCount; i++) {
          ctx.strokeStyle = getSegColor(i);
          const [x1, y1] = drawPts[tour[i]];
          const [x2, y2] = drawPts[tour[(i + 1) % pn]];
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
      // Draw dots at each node
      for (let i = 0; i < pn; i++) {
        const [px, py] = drawPts[tour[i]];
        const dotR = getSegWidth(i) * 2.5;
        ctx.fillStyle = getSegColor(i);
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (pathStyle === 'dashed') {
      // Dashed segments with gaps
      for (let i = 0; i < segCount; i++) {
        const [x1, y1] = drawPts[tour[i]];
        const [x2, y2] = drawPts[tour[(i + 1) % pn]];
        const dx = x2 - x1, dy = y2 - y1;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        const dashLen = Math.max(3, segLen * 0.6);
        const gapLen = segLen - dashLen;

        ctx.strokeStyle = getSegColor(i);
        ctx.lineWidth = getSegWidth(i);
        ctx.beginPath();
        const ux = dx / segLen, uy = dy / segLen;
        ctx.moveTo(x1 + ux * gapLen * 0.5, y1 + uy * gapLen * 0.5);
        ctx.lineTo(x2 - ux * gapLen * 0.5, y2 - uy * gapLen * 0.5);
        ctx.stroke();
      }
    } else {
      // Straight lines (original behavior)
      if (colorMode === 'monochrome') {
        ctx.strokeStyle = getSegColor(0);
        ctx.lineWidth = baseLineWidth;
        ctx.beginPath();
        const [sx, sy] = drawPts[tour[0]];
        ctx.moveTo(sx, sy);
        for (let i = 1; i < pn; i++) {
          const [x, y] = drawPts[tour[i]];
          ctx.lineTo(x, y);
        }
        if (shouldClose) ctx.closePath();
        ctx.stroke();
      } else {
        for (let i = 0; i < segCount; i++) {
          const [x1, y1] = drawPts[tour[i]];
          const [x2, y2] = drawPts[tour[(i + 1) % pn]];
          ctx.strokeStyle = getSegColor(i);
          ctx.lineWidth = getSegWidth(i);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
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
