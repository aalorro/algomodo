import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

// Golden angle in radians: 2π / φ² = π(3 − √5)
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count',
    type: 'number', min: 100, max: 5000, step: 100, default: 1500,
    group: 'Composition',
  },
  spread: {
    name: 'Spread',
    type: 'number', min: 0.5, max: 6, step: 0.25, default: 3.0,
    help: 'Scale factor c in r = c·√i — controls how tightly packed the spiral is',
    group: 'Geometry',
  },
  dotSize: {
    name: 'Dot Size',
    type: 'number', min: 0.5, max: 10, step: 0.5, default: 3.5,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-radius', 'palette-angle', 'palette-noise'],
    default: 'palette-radius',
    help: 'palette-radius: color by distance from centre | palette-angle: color by golden-angle position | palette-noise: FBM tint',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
  spinSpeed: {
    name: 'Spin Speed',
    type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.05,
    help: 'Whole-pattern rotation speed (rad/s)',
    group: 'Flow/Motion',
  },
};

export const phyllotaxis: Generator = {
  id: 'plotter-phyllotaxis',
  family: 'plotter',
  styleName: 'Phyllotaxis',
  definition: 'Sunflower spiral: dots placed at successive golden-angle increments, radii growing as √i',
  algorithmNotes:
    'Each point i is placed at angle i·φ (φ = golden angle ≈ 137.508°) and radius c·√i from centre. This replicates the fibonacci/golden-ratio packing found in sunflower seed heads and pine cones. The square-root radius ensures uniform area density across the spiral.',
  parameterSchema,
  defaultParams: {
    pointCount: 1500, spread: 3.0, dotSize: 3.5,
    colorMode: 'palette-radius', background: 'cream', spinSpeed: 0.05,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const noise = new SimplexNoise(seed);
    const cx = w / 2, cy = h / 2;
    const n = Math.max(1, params.pointCount ?? 1500) | 0;
    const c = params.spread ?? 3.0;
    const dotR = params.dotSize ?? 3.5;
    const spinSpeed = params.spinSpeed ?? 0.05;
    const colorMode = params.colorMode || 'palette-radius';
    const colors = palette.colors.map(hexToRgb);
    const isDark = params.background === 'dark';
    const spin = time * spinSpeed;

    // Maximum radius to clip dots inside canvas
    const maxR = Math.min(w, h) * 0.49;

    for (let i = 0; i < n; i++) {
      const angle = i * GOLDEN_ANGLE + spin;
      const r = c * Math.sqrt(i);
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);

      if (x < 0 || x > w || y < 0 || y > h) continue;
      if (r > maxR) continue;

      let cr: number, cg: number, cb: number;
      if (colorMode === 'monochrome') {
        [cr, cg, cb] = isDark ? [220, 220, 220] : [30, 30, 30];
      } else if (colorMode === 'palette-angle') {
        // Map the golden-angle progression to palette
        const t = (i % colors.length) / colors.length;
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      } else if (colorMode === 'palette-noise') {
        const nv = noise.fbm((x / w - 0.5) * 3 + 5, (y / h - 0.5) * 3 + 5, 3, 2, 0.5);
        const t = Math.max(0, nv * 0.5 + 0.5);
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      } else {
        // palette-radius: color by normalised distance from centre
        const t = Math.min(1, r / maxR);
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      }

      ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.88 : 0.85})`;
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return ((params.pointCount ?? 1500) * 0.05) | 0;
  },
};
