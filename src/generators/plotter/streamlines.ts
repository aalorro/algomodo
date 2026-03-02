import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  lineCount: {
    name: 'Line Count',
    type: 'number', min: 20, max: 600, step: 10, default: 400,
    group: 'Composition',
  },
  maxSteps: {
    name: 'Max Length',
    type: 'number', min: 20, max: 500, step: 10, default: 200,
    help: 'Maximum integration steps per streamline',
    group: 'Composition',
  },
  stepLength: {
    name: 'Step Length',
    type: 'number', min: 1, max: 16, step: 0.5, default: 5,
    help: 'Euler integration step size in pixels',
    group: 'Geometry',
  },
  fieldScale: {
    name: 'Field Scale',
    type: 'number', min: 0.3, max: 6, step: 0.1, default: 1.8,
    help: 'Spatial frequency of the vector field',
    group: 'Geometry',
  },
  minSeparation: {
    name: 'Min Separation',
    type: 'number', min: 2, max: 30, step: 1, default: 8,
    help: 'Minimum pixel gap between adjacent streamlines',
    group: 'Geometry',
  },
  fieldType: {
    name: 'Field Type',
    type: 'select',
    options: ['curl-noise', 'gradient', 'sine-lattice'],
    default: 'curl-noise',
    help: 'curl-noise: swirling vortex-free field | gradient: flows toward peaks | sine-lattice: regular wave pattern',
    group: 'Composition',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.5, max: 12, step: 0.5, default: 6,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-cycle', 'velocity', 'position'],
    default: 'palette-cycle',
    help: 'velocity: color by field magnitude | position: color by canvas XY',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.15,
    help: 'Speed at which the vector field drifts over time (0 = static)',
    group: 'Flow/Motion',
  },
};

export const streamlines: Generator = {
  id: 'plotter-streamlines',
  family: 'plotter',
  styleName: 'Streamlines',
  definition: 'Traces evenly-spaced streamlines through a smooth 2D vector field derived from noise',
  algorithmNotes: 'A SimplexNoise scalar field generates the flow via curl (divergence-free), gradient (converging), or sine-lattice modes. Each streamline is integrated with the Euler method and terminated when it exits the canvas or approaches an existing line. A separation grid prevents overcrowding.',
  parameterSchema,
  defaultParams: {
    lineCount: 400, maxSteps: 200, stepLength: 5, fieldScale: 1.8,
    minSeparation: 8, fieldType: 'curl-noise', lineWidth: 6,
    colorMode: 'palette-cycle', background: 'cream', animSpeed: 0.15,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const animSpeed = params.animSpeed ?? 0.15;
    const timeOffset = time * animSpeed * 0.4;

    const maxLines = params.lineCount ?? 400;
    const maxSteps = params.maxSteps ?? 200;
    const step = params.stepLength ?? 5;
    const fScale = params.fieldScale ?? 1.8;
    const minSep = params.minSeparation ?? 8;
    const fieldType = params.fieldType || 'curl-noise';
    const isDark = params.background === 'dark';

    // Separation grid
    const sepCell = Math.max(1, minSep / Math.sqrt(2));
    const sgw = Math.ceil(w / sepCell) + 1;
    const sgh = Math.ceil(h / sepCell) + 1;
    const sepGrid = new Uint8Array(sgw * sgh);

    const markOccupied = (x: number, y: number) => {
      const gx = Math.min(sgw - 1, Math.max(0, Math.floor(x / sepCell)));
      const gy = Math.min(sgh - 1, Math.max(0, Math.floor(y / sepCell)));
      sepGrid[gy * sgw + gx] = 1;
    };

    const isOccupied = (x: number, y: number): boolean => {
      const gx = Math.floor(x / sepCell);
      const gy = Math.floor(y / sepCell);
      const r = Math.ceil(minSep / sepCell);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx < sgw && ny >= 0 && ny < sgh && sepGrid[ny * sgw + nx]) {
            const px = (nx + 0.5) * sepCell, py = (ny + 0.5) * sepCell;
            const ddx = x - px, ddy = y - py;
            if (ddx * ddx + ddy * ddy < minSep * minSep) return true;
          }
        }
      }
      return false;
    };

    const getField = (x: number, y: number): [number, number] => {
      // +5 offset keeps canvas center away from FBM origin (which is always 0)
      const nx = (x / w - 0.5) * fScale + 5 + timeOffset, ny = (y / h - 0.5) * fScale + 5 + timeOffset * 0.7;
      if (fieldType === 'sine-lattice') {
        const freq = fScale * 3;
        return [
          Math.sin(ny * freq) + 0.3 * Math.sin(nx * freq * 1.5),
          Math.cos(nx * freq) + 0.3 * Math.cos(ny * freq * 1.5),
        ];
      }
      // Epsilon in noise-space units (NOT pixel units) — must be ~1-2% of fScale
      // so that adjacent evaluations sample meaningfully different noise values.
      const eps = fScale * 0.015;
      if (fieldType === 'gradient') {
        const dFx = noise.fbm(nx + eps, ny, 4, 2, 0.5) - noise.fbm(nx - eps, ny, 4, 2, 0.5);
        const dFy = noise.fbm(nx, ny + eps, 4, 2, 0.5) - noise.fbm(nx, ny - eps, 4, 2, 0.5);
        const len = Math.sqrt(dFx * dFx + dFy * dFy) + 1e-6;
        return [dFx / len, dFy / len];
      }
      // curl-noise (default): divergence-free field gives swirling, space-filling paths
      const dFy = noise.fbm(nx, ny + eps, 4, 2, 0.5) - noise.fbm(nx, ny - eps, 4, 2, 0.5);
      const dFx = noise.fbm(nx + eps, ny, 4, 2, 0.5) - noise.fbm(nx - eps, ny, 4, 2, 0.5);
      // curl: (dF/dy, -dF/dx)
      const vx = dFy, vy = -dFx;
      const len = Math.sqrt(vx * vx + vy * vy) + 1e-6;
      return [vx / len, vy / len];
    };

    const colors = palette.colors.map(hexToRgb);
    ctx.lineWidth = params.lineWidth ?? 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Jittered grid seed pool — guarantees uniform canvas coverage regardless of field topology.
    // Grid spacing = minSep * 1.5 so each cell holds at most one line start.
    const gridSpacing = minSep * 1.5;
    const gCols = Math.ceil(w / gridSpacing);
    const gRows = Math.ceil(h / gridSpacing);
    const seeds: [number, number][] = [];
    for (let gr = 0; gr < gRows; gr++) {
      for (let gc = 0; gc < gCols; gc++) {
        seeds.push([(gc + rng.random()) * gridSpacing, (gr + rng.random()) * gridSpacing]);
      }
    }
    // Fisher-Yates shuffle so seeds are visited in random order
    for (let i = seeds.length - 1; i > 0; i--) {
      const j = Math.floor(rng.random() * (i + 1));
      const tmp = seeds[i]; seeds[i] = seeds[j]; seeds[j] = tmp;
    }

    let linesDrawn = 0;
    let seedIdx = 0;

    while (linesDrawn < maxLines && seedIdx < seeds.length) {
      const [sx, sy] = seeds[seedIdx++];

      if (isOccupied(sx, sy)) continue;

      // Trace forward
      const pts: [number, number][] = [[sx, sy]];
      let x = sx, y = sy;

      for (let s = 0; s < maxSteps; s++) {
        const [vx, vy] = getField(x, y);
        const nx = x + vx * step;
        const ny = y + vy * step;
        if (nx < 0 || nx > w || ny < 0 || ny > h) break;
        if (s > 0 && isOccupied(nx, ny)) break;
        pts.push([nx, ny]);
        x = nx; y = ny;
      }

      if (pts.length < 3) continue;

      // Determine color
      let cr: number, cg: number, cb: number;
      if (params.colorMode === 'position') {
        const t = (sx / w * 0.5 + sy / h * 0.5);
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      } else if (params.colorMode === 'velocity') {
        const [vx, vy] = getField(sx, sy);
        const speed = Math.min(1, Math.sqrt(vx * vx + vy * vy));
        const ci = speed * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      } else {
        [cr, cg, cb] = colors[linesDrawn % colors.length];
      }

      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.85 : 0.75})`;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();

      // Mark all points as occupied
      for (const [px, py] of pts) markOccupied(px, py);

      linesDrawn++;
    }
  },

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const c = gl.canvas as HTMLCanvasElement;
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    this.renderCanvas2D!(tmp.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost(params) {
    return Math.round((params.lineCount ?? 280) * (params.maxSteps ?? 200) * 0.8);
  },
};
