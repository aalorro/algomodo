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
  gridType: {
    name: 'Grid Type',
    type: 'select',
    options: ['square', 'hex', 'diamond'],
    default: 'square',
    help: 'square: standard | hex: offset rows (classic halftone) | diamond: 45° rotated',
    group: 'Composition',
  },
  gridAngle: {
    name: 'Grid Angle',
    type: 'number', min: 0, max: 45, step: 5, default: 0,
    help: 'Rotation of the entire dot grid in degrees',
    group: 'Composition',
  },
  maxRadius: {
    name: 'Max Radius',
    type: 'number', min: 2, max: 28, step: 1, default: 10,
    help: 'Radius of the largest (densest) dot',
    group: 'Geometry',
  },
  dotShape: {
    name: 'Dot Shape',
    type: 'select',
    options: ['circle', 'square', 'diamond', 'line'],
    default: 'circle',
    help: 'circle: round | square: filled rect | diamond: rotated square | line: density-driven stroke',
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
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0,
    help: 'Flowing density animation speed — 0 = static',
    group: 'Flow/Motion',
  },
};

export const halftoneDots: Generator = {
  id: 'plotter-halftone-dots',
  family: 'plotter',
  styleName: 'Halftone Dots',
  definition: 'Regular dot grid with element sizes driven by a noise density field — vector-plotter halftone',
  algorithmNotes:
    'Grid types (square, hex, diamond) place dots on regular lattices. Each element size is proportional to the FBM noise value raised to a contrast exponent. Grid rotation and multiple dot shapes (circles, squares, diamonds, lines) add variety. Animation shifts the density field over time.',
  parameterSchema,
  defaultParams: {
    gridSpacing: 22, gridType: 'square', gridAngle: 0,
    maxRadius: 10, dotShape: 'circle',
    densityScale: 2.5, densityContrast: 2.0,
    colorMode: 'palette-density', background: 'cream',
    animSpeed: 0,
  },
  supportsVector: true, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, _seed, palette, _quality, time = 0) {
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
    const gridType = params.gridType || 'square';
    const gridAngle = ((params.gridAngle ?? 0) * Math.PI) / 180;
    const dotShape = params.dotShape || 'circle';
    const animSpeed = params.animSpeed ?? 0;
    const colors = palette.colors.map(hexToRgb);
    const isDark = params.background === 'dark';

    // Time-based density field offset
    const timeOff = time * animSpeed * 0.5;

    const densityFn = (x: number, y: number): number => {
      const n = noise.fbm(
        (x / w - 0.5) * dScale + 5 + timeOff,
        (y / h - 0.5) * dScale + 5 + timeOff * 0.7,
        4, 2, 0.5,
      );
      return Math.pow(Math.max(0, n * 0.5 + 0.5), dContrast);
    };

    // Generate grid points — expand bounds to cover canvas after rotation
    const diag = Math.sqrt(w * w + h * h);
    const margin = spacing;
    const startX = -diag / 2 - margin;
    const startY = -diag / 2 - margin;
    const endX = diag / 2 + margin;
    const endY = diag / 2 + margin;

    const cosA = Math.cos(gridAngle);
    const sinA = Math.sin(gridAngle);
    const hcx = w / 2, hcy = h / 2;

    // Iterate grid in rotated space, transform back to canvas
    const cols = Math.ceil((endX - startX) / spacing) + 1;
    const rows = Math.ceil((endY - startY) / spacing) + 1;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let gx = startX + col * spacing;
        let gy = startY + row * spacing;

        // Hex grid: offset every other row
        if (gridType === 'hex') {
          if (row % 2 === 1) gx += spacing * 0.5;
          gy *= 0.866; // sin(60°) vertical compression
        } else if (gridType === 'diamond') {
          // Diamond: 45° base rotation baked in
          const dx = gx, dy = gy;
          gx = (dx - dy) * 0.7071;
          gy = (dx + dy) * 0.7071;
        }

        // Apply user grid angle rotation
        const rx = gx * cosA - gy * sinA + hcx;
        const ry = gx * sinA + gy * cosA + hcy;

        // Skip dots outside canvas
        if (rx < -maxR || rx > w + maxR || ry < -maxR || ry > h + maxR) continue;

        let density = densityFn(rx, ry);
        if (colorMode === 'invert') density = 1 - density;
        const r = density * maxR;
        if (r < 0.3) continue;

        let cr: number, cg: number, cb: number;
        if (colorMode === 'monochrome') {
          [cr, cg, cb] = isDark ? [220, 220, 220] : [30, 30, 30];
        } else if (colorMode === 'palette-position') {
          const t = ((rx / w) * 0.6 + (ry / h) * 0.4);
          const ci = Math.min(Math.floor(Math.max(0, t) * colors.length), colors.length - 1);
          [cr, cg, cb] = colors[ci];
        } else {
          // palette-density and invert: interpolate by raw density
          const rawDensity = densityFn(rx, ry);
          const ci = rawDensity * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        }

        const alpha = isDark ? 0.88 : 0.85;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;

        if (dotShape === 'square') {
          ctx.fillRect(rx - r, ry - r, r * 2, r * 2);
        } else if (dotShape === 'diamond') {
          ctx.beginPath();
          ctx.moveTo(rx, ry - r);
          ctx.lineTo(rx + r, ry);
          ctx.lineTo(rx, ry + r);
          ctx.lineTo(rx - r, ry);
          ctx.closePath();
          ctx.fill();
        } else if (dotShape === 'line') {
          // Vertical stroke whose thickness = density
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
          ctx.lineWidth = Math.max(0.5, r * 0.8);
          ctx.beginPath();
          ctx.moveTo(rx, ry - r);
          ctx.lineTo(rx, ry + r);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(rx, ry, r, 0, Math.PI * 2);
          ctx.fill();
        }
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
    const dotShape = params.dotShape || 'circle';
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
        let x = offsetX + col * spacing;
        const y = offsetY + row * spacing;
        if ((params.gridType || 'square') === 'hex' && row % 2 === 1) x += spacing * 0.5;

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

        let d: string;
        if (dotShape === 'square') {
          d = `M ${(x - r).toFixed(2)} ${(y - r).toFixed(2)} h ${(r * 2).toFixed(2)} v ${(r * 2).toFixed(2)} h ${(-r * 2).toFixed(2)} Z`;
        } else if (dotShape === 'diamond') {
          d = `M ${x.toFixed(2)} ${(y - r).toFixed(2)} L ${(x + r).toFixed(2)} ${y.toFixed(2)} L ${x.toFixed(2)} ${(y + r).toFixed(2)} L ${(x - r).toFixed(2)} ${y.toFixed(2)} Z`;
        } else {
          d = `M ${(x - r).toFixed(2)} ${y.toFixed(2)} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(r * 2).toFixed(2)} 0 a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-r * 2).toFixed(2)} 0`;
        }
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
