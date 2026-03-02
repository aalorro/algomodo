import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  circleCount: {
    name: 'Circle Count',
    type: 'number', min: 500, max: 5000, step: 100, default: 2500,
    help: 'Upper bound — algorithm also stops when canvas is packed',
    group: 'Composition',
  },
  densityScale: {
    name: 'Density Scale',
    type: 'number', min: 0.3, max: 6, step: 0.1, default: 2.0,
    group: 'Composition',
  },
  densityContrast: {
    name: 'Density Contrast',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 0.8,
    help: 'Controls color variation by noise density (does not affect circle size)',
    group: 'Texture',
  },
  minRadius: {
    name: 'Min Radius',
    type: 'number', min: 1, max: 20, step: 1, default: 4,
    group: 'Geometry',
  },
  maxRadius: {
    name: 'Max Radius',
    type: 'number', min: 5, max: 200, step: 5, default: 80,
    group: 'Geometry',
  },
  padding: {
    name: 'Circle Gap',
    type: 'number', min: 0, max: 10, step: 0.5, default: 2,
    help: 'Minimum gap between circle edges',
    group: 'Geometry',
  },
  fillMode: {
    name: 'Fill Mode',
    type: 'select',
    options: ['filled', 'outline', 'filled+outline'],
    default: 'filled',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-cycle', 'by-size', 'palette-density'],
    default: 'palette-cycle',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
};

export const circlePacking: Generator = {
  id: 'plotter-circle-packing',
  family: 'plotter',
  styleName: 'Circle Packing',
  definition: 'Fills the canvas with non-overlapping circles grown to maximum radius, biased by a noise density field',
  algorithmNotes: 'Candidate centres are sampled by rejection using a SimplexNoise density field. Each accepted centre grows to the largest radius permitted before touching the canvas boundary or an existing circle. A spatial-hash grid makes neighbourhood queries O(1), enabling large circle counts.',
  parameterSchema,
  defaultParams: {
    circleCount: 2500, densityScale: 2.0, densityContrast: 0.8,
    minRadius: 4, maxRadius: 80, padding: 2,
    fillMode: 'filled', colorMode: 'palette-cycle', background: 'cream',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: false,

  renderCanvas2D(ctx, params, seed, palette) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const minR = Math.max(1, params.minRadius ?? 4);
    // Enforce at least 3× ratio so small circles can fill the gaps between large ones
    const maxR = Math.max(minR * 3, params.maxRadius ?? 80);
    const pad = params.padding ?? 2;
    const target = params.circleCount ?? 2500;
    const dScale = params.densityScale ?? 2.0;
    const dContrast = params.densityContrast ?? 0.8;

    type Circle = { x: number; y: number; r: number; density: number };
    const circles: Circle[] = [];

    // Spatial hash: cell covers (maxR + pad) diameter
    const cellSize = (maxR + pad) * 2;
    const gw = Math.ceil(w / cellSize) + 1;
    const gh = Math.ceil(h / cellSize) + 1;
    const grid: number[][] = Array.from({ length: gw * gh }, () => []);

    const addToGrid = (idx: number) => {
      const c = circles[idx];
      const gx = Math.min(gw - 1, Math.floor(c.x / cellSize));
      const gy = Math.min(gh - 1, Math.floor(c.y / cellSize));
      grid[gy * gw + gx].push(idx);
    };

    /** Largest radius that can be placed at (cx, cy) without collisions. */
    const maxRadiusAt = (cx: number, cy: number): number => {
      let r = Math.min(cx, cy, w - cx, h - cy, maxR);
      if (r < minR) return -1;

      const searchCells = Math.ceil((maxR + pad) / cellSize) + 1;
      const gx = Math.floor(cx / cellSize);
      const gy = Math.floor(cy / cellSize);

      for (let dy = -searchCells; dy <= searchCells; dy++) {
        for (let dx = -searchCells; dx <= searchCells; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          for (const ci of grid[ny * gw + nx]) {
            const c = circles[ci];
            const ddx = cx - c.x, ddy = cy - c.y;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy);
            const maxAllowed = dist - c.r - pad;
            if (maxAllowed < r) r = maxAllowed;
          }
        }
      }
      return r;
    };

    const densityFn = (x: number, y: number): number => {
      // +5 offset keeps canvas center away from FBM origin (which is always 0)
      const n = noise.fbm((x / w - 0.5) * dScale + 5, (y / h - 0.5) * dScale + 5, 4, 2, 0.5);
      return Math.pow(Math.max(0, n * 0.5 + 0.5), dContrast);
    };

    // Greedy fill: pack circles to their maximum possible radius everywhere.
    // Stop when canvas is packed (600 consecutive failures) OR the upper-bound count is reached.
    // Density is recorded for coloring only — it does NOT cap circle size,
    // which guarantees every region of the canvas fills with large visible circles.
    const maxConsecutiveFailures = 600;
    let consecutiveFailures = 0;

    while (circles.length < target && consecutiveFailures < maxConsecutiveFailures) {
      const cx = rng.random() * w;
      const cy = rng.random() * h;

      const r = maxRadiusAt(cx, cy);
      if (r < minR) {
        consecutiveFailures++;
        continue;
      }

      const density = densityFn(cx, cy);
      circles.push({ x: cx, y: cy, r, density });
      addToGrid(circles.length - 1);
      consecutiveFailures = 0;
    }

    // Sort by radius descending so large circles are drawn first
    circles.sort((a, b) => b.r - a.r);

    const colors = palette.colors.map(hexToRgb);
    const isDark = params.background === 'dark';
    const fillMode = params.fillMode || 'filled';

    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];

      let cr: number, cg: number, cb: number;
      if (params.colorMode === 'by-size') {
        const t = Math.min(1, (c.r - minR) / (maxR - minR + 1e-6));
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      } else if (params.colorMode === 'palette-density') {
        const ci = c.density * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      } else {
        [cr, cg, cb] = colors[i % colors.length];
      }

      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);

      if (fillMode === 'filled' || fillMode === 'filled+outline') {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.88 : 0.82})`;
        ctx.fill();
      }
      if (fillMode === 'outline' || fillMode === 'filled+outline') {
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.9 : 0.85})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round((params.circleCount ?? 2500) * 2); },
};
