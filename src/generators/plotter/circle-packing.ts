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
  densityStyle: {
    name: 'Density Style',
    type: 'select',
    options: ['fbm', 'ridged', 'radial', 'turbulent'],
    default: 'fbm',
    help: 'Shape of the density field — fbm: smooth | ridged: sharp ridges | radial: center-focused | turbulent: creases',
    group: 'Composition',
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
  shape: {
    name: 'Shape',
    type: 'select',
    options: ['circles', 'squares', 'hexagons', 'mixed'],
    default: 'circles',
    help: 'circles: round | squares: rotated rects | hexagons: 6-sided | mixed: random per element',
    group: 'Geometry',
  },
  fillMode: {
    name: 'Fill Mode',
    type: 'select',
    options: ['filled', 'outline', 'filled+outline'],
    default: 'filled',
    group: 'Texture',
  },
  innerDetail: {
    name: 'Inner Detail',
    type: 'select',
    options: ['none', 'rings', 'spokes', 'cross', 'spiral'],
    default: 'none',
    help: 'Decorative detail drawn inside each shape — rings: concentric | spokes: radial lines | cross: X pattern | spiral: Archimedean spiral',
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
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.15,
    help: 'Breathing/pulsing speed — 0 = static',
    group: 'Flow/Motion',
  },
};

export const circlePacking: Generator = {
  id: 'plotter-circle-packing',
  family: 'plotter',
  styleName: 'Circle Packing',
  definition: 'Fills the canvas with non-overlapping shapes grown to maximum radius, biased by a noise density field',
  algorithmNotes: 'Candidate centres are sampled by rejection using a SimplexNoise density field. Each accepted centre grows to the largest radius permitted before touching the canvas boundary or an existing circle. A spatial-hash grid makes neighbourhood queries O(1), enabling large circle counts. Shape variants (squares, hexagons) use the same collision radius but different draw paths. Inner details add decorative patterns inside each shape.',
  parameterSchema,
  defaultParams: {
    circleCount: 2500, densityScale: 2.0, densityContrast: 0.8, densityStyle: 'fbm',
    minRadius: 4, maxRadius: 80, padding: 2, shape: 'circles',
    fillMode: 'filled', innerDetail: 'none', colorMode: 'palette-cycle', background: 'cream',
    animSpeed: 0.15,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    // Reset any stale transform from a previous generator
    ctx.resetTransform();
    const w = ctx.canvas.width, h = ctx.canvas.height;

    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);


    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    // Scale parameter values relative to canvas size so visuals stay consistent
    const sizeScale = Math.min(w, h) / 1080;
    const minR = Math.max(1, (params.minRadius ?? 4) * sizeScale);
    const maxR = Math.max(minR * 3, (params.maxRadius ?? 80) * sizeScale);
    const pad = (params.padding ?? 2) * sizeScale;
    const target = params.circleCount ?? 2500;
    const dScale = params.densityScale ?? 2.0;
    const dContrast = params.densityContrast ?? 0.8;
    const densityStyle = params.densityStyle ?? 'fbm';
    const shapeType = params.shape ?? 'circles';
    const innerDetail = params.innerDetail ?? 'none';
    const animSpeed = params.animSpeed ?? 0.15;

    type Circle = { x: number; y: number; r: number; density: number; shapeKind: string; angle: number };
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

    // Greedy fill
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
      let kind: string;
      if (shapeType === 'mixed') {
        const pick = rng.random();
        kind = pick < 0.4 ? 'circle' : pick < 0.7 ? 'square' : 'hexagon';
      } else if (shapeType === 'squares') kind = 'square';
      else if (shapeType === 'hexagons') kind = 'hexagon';
      else kind = 'circle';

      const angle = rng.random() * Math.PI * 2;
      circles.push({ x: cx, y: cy, r, density, shapeKind: kind, angle });
      addToGrid(circles.length - 1);
      consecutiveFailures = 0;
    }

    // Sort by radius descending so large shapes are drawn first
    circles.sort((a, b) => b.r - a.r);

    const colors = palette.colors.map(hexToRgb);
    const isDark = params.background === 'dark';
    const fillMode = params.fillMode || 'filled';

    // Animation: breathing pulse
    const breathe = animSpeed > 0 && time > 0;

    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];

      // Per-circle breathing: each circle pulses at its own phase
      let drawR = c.r;
      if (breathe) {
        const phase = c.x * 0.01 + c.y * 0.013 + i * 0.3;
        const pulse = Math.sin(time * animSpeed * 2 + phase) * 0.12;
        drawR = c.r * (1 + pulse);
      }

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

      const fillAlpha = isDark ? 0.88 : 0.82;
      const strokeAlpha = isDark ? 0.9 : 0.85;

      ctx.save();
      ctx.translate(c.x, c.y);

      // Draw shape
      if (c.shapeKind === 'square') {
        ctx.rotate(c.angle);
        const half = drawR * 0.85; // inscribed square
        ctx.beginPath();
        ctx.rect(-half, -half, half * 2, half * 2);
      } else if (c.shapeKind === 'hexagon') {
        ctx.beginPath();
        for (let v = 0; v < 6; v++) {
          const a = c.angle + v * Math.PI / 3;
          const hx = Math.cos(a) * drawR;
          const hy = Math.sin(a) * drawR;
          if (v === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, drawR, 0, Math.PI * 2);
      }

      if (fillMode === 'filled' || fillMode === 'filled+outline') {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${fillAlpha})`;
        ctx.fill();
      }
      if (fillMode === 'outline' || fillMode === 'filled+outline') {
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${strokeAlpha})`;
        ctx.lineWidth = sizeScale;
        ctx.stroke();
      }

      // Inner detail (only for shapes large enough to see)
      if (innerDetail !== 'none' && drawR > 8 * sizeScale) {
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(isDark ? 0.45 : 0.35)})`;
        ctx.lineWidth = 0.6 * sizeScale;

        if (innerDetail === 'rings') {
          const ringStep = Math.max(3, drawR * 0.25);
          for (let ri = ringStep; ri < drawR - 1; ri += ringStep) {
            ctx.beginPath();
            ctx.arc(0, 0, ri, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (innerDetail === 'spokes') {
          const spokeCount = Math.min(12, Math.max(4, Math.floor(drawR / 6)));
          for (let si = 0; si < spokeCount; si++) {
            const a = (si / spokeCount) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(a) * (drawR - 1), Math.sin(a) * (drawR - 1));
            ctx.stroke();
          }
        } else if (innerDetail === 'cross') {
          const cr2 = drawR * 0.75;
          ctx.beginPath();
          ctx.moveTo(-cr2, -cr2); ctx.lineTo(cr2, cr2);
          ctx.moveTo(cr2, -cr2); ctx.lineTo(-cr2, cr2);
          ctx.stroke();
        } else if (innerDetail === 'spiral') {
          ctx.beginPath();
          const turns = Math.max(2, drawR / 8);
          const steps = Math.floor(turns * 20);
          for (let si = 0; si <= steps; si++) {
            const t = si / steps;
            const a = t * turns * Math.PI * 2;
            const sr = t * (drawR - 1);
            const sx = Math.cos(a) * sr;
            const sy = Math.sin(a) * sr;
            if (si === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
      }

      ctx.restore();
    }

  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round((params.circleCount ?? 2500) * 2); },
};
