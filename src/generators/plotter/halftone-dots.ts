import type { Generator, ParameterSchema, SVGPath } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  gridSpacing: {
    name: 'Grid Spacing',
    type: 'number', min: 8, max: 60, step: 2, default: 22,
    help: 'Distance between dot centres in pixels',
    group: 'Composition',
  },
  maxRadius: {
    name: 'Max Radius',
    type: 'number', min: 2, max: 28, step: 1, default: 10,
    help: 'Radius of the largest (densest) dot',
    group: 'Geometry',
  },
  densityScale: {
    name: 'Density Scale',
    type: 'number', min: 0.5, max: 8, step: 0.25, default: 2.5,
    help: 'Spatial scale of the noise density field',
    group: 'Composition',
  },
  densityContrast: {
    name: 'Density Contrast',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 2.0,
    help: 'Gamma exponent sharpening dense vs sparse regions',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-density', 'palette-position', 'invert'],
    default: 'palette-density',
    help: 'invert: largest dots on low-density regions (negative halftone)',
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

export const halftoneDots: Generator = {
  id: 'plotter-halftone-dots',
  family: 'plotter',
  styleName: 'Halftone Dots',
  definition: 'Regular dot grid with circle radii driven by a noise density field — vector-plotter halftone',
  algorithmNotes:
    'A uniform grid of dots fills the canvas. Each dot radius is proportional to the FBM noise value at that position (raised to a contrast exponent). An "invert" mode swaps the density mapping, placing large dots in sparse regions for a negative-halftone or engraved-shadow effect.',
  parameterSchema,
  defaultParams: {
    gridSpacing: 22, maxRadius: 10, densityScale: 2.5, densityContrast: 2.0,
    colorMode: 'palette-density', background: 'cream',
  },
  supportsVector: true, supportsWebGPU: false, supportsAnimation: false,

  renderCanvas2D(ctx, params, _seed, palette) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const seed = _seed;
    const noise = new SimplexNoise(seed);
    const spacing = Math.max(4, params.gridSpacing ?? 22);
    const maxR = Math.min(spacing * 0.5, params.maxRadius ?? 10);
    const dScale = params.densityScale ?? 2.5;
    const dContrast = params.densityContrast ?? 2.0;
    const colorMode = params.colorMode || 'palette-density';
    const colors = palette.colors.map(hexToRgb);
    const isDark = params.background === 'dark';

    const densityFn = (x: number, y: number): number => {
      const n = noise.fbm((x / w - 0.5) * dScale + 5, (y / h - 0.5) * dScale + 5, 4, 2, 0.5);
      return Math.pow(Math.max(0, n * 0.5 + 0.5), dContrast);
    };

    const cols = Math.ceil(w / spacing) + 1;
    const rows = Math.ceil(h / spacing) + 1;
    // Offset grid by half spacing to avoid edge dots being cut off
    const offsetX = (w - (cols - 1) * spacing) / 2;
    const offsetY = (h - (rows - 1) * spacing) / 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = offsetX + col * spacing;
        const y = offsetY + row * spacing;
        let density = densityFn(x, y);
        if (colorMode === 'invert') density = 1 - density;
        const r = density * maxR;
        if (r < 0.3) continue;

        let cr: number, cg: number, cb: number;
        if (colorMode === 'monochrome') {
          [cr, cg, cb] = isDark ? [220, 220, 220] : [30, 30, 30];
        } else if (colorMode === 'palette-position') {
          const t = (col / (cols - 1) * 0.6 + row / (rows - 1) * 0.4);
          const ci = Math.min(Math.floor(t * colors.length), colors.length - 1);
          [cr, cg, cb] = colors[ci];
        } else {
          // palette-density and invert: interpolate by density
          const rawDensity = densityFn(x, y);
          const ci = rawDensity * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        }
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.88 : 0.85})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderVector(params, seed, palette): SVGPath[] {
    const viewW = 1000, viewH = 1000;
    const noise = new SimplexNoise(seed);
    const spacing = Math.max(4, params.gridSpacing ?? 22);
    const maxR = Math.min(spacing * 0.5, params.maxRadius ?? 10);
    const dScale = params.densityScale ?? 2.5;
    const dContrast = params.densityContrast ?? 2.0;
    const colorMode = params.colorMode || 'palette-density';
    const colors = palette.colors.map(hexToRgb);

    const densityFn = (x: number, y: number): number => {
      const n = noise.fbm((x / viewW - 0.5) * dScale + 5, (y / viewH - 0.5) * dScale + 5, 4, 2, 0.5);
      return Math.pow(Math.max(0, n * 0.5 + 0.5), dContrast);
    };

    const cols = Math.ceil(viewW / spacing) + 1;
    const rows = Math.ceil(viewH / spacing) + 1;
    const offsetX = (viewW - (cols - 1) * spacing) / 2;
    const offsetY = (viewH - (rows - 1) * spacing) / 2;
    const paths: SVGPath[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = offsetX + col * spacing;
        const y = offsetY + row * spacing;
        let density = densityFn(x, y);
        if (colorMode === 'invert') density = 1 - density;
        const r = density * maxR;
        if (r < 0.3) continue;

        let cr: number, cg: number, cb: number;
        if (colorMode === 'palette-position') {
          const t = (col / (cols - 1) * 0.6 + row / (rows - 1) * 0.4);
          const ci = Math.min(Math.floor(t * colors.length), colors.length - 1);
          [cr, cg, cb] = colors[ci];
        } else {
          const rawDensity = densityFn(x, y);
          const ci = rawDensity * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        }
        // SVG circle as arc path
        const d = `M ${(x - r).toFixed(2)} ${y.toFixed(2)} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(r * 2).toFixed(2)} 0 a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-r * 2).toFixed(2)} 0`;
        paths.push({ d, fill: `rgb(${cr},${cg},${cb})`, stroke: 'none' });
      }
    }
    return paths;
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    const spacing = params.gridSpacing ?? 22;
    const dots = Math.ceil(1080 / spacing) * Math.ceil(1080 / spacing);
    return (dots * 0.05) | 0;
  },
};
