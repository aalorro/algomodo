import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count',
    type: 'number', min: 500, max: 30000, step: 500, default: 8000,
    group: 'Composition',
  },
  densityScale: {
    name: 'Density Scale',
    type: 'number', min: 0.3, max: 8, step: 0.1, default: 2.5,
    help: 'Spatial scale of the density field',
    group: 'Composition',
  },
  densityContrast: {
    name: 'Density Contrast',
    type: 'number', min: 0.5, max: 5, step: 0.25, default: 2.0,
    help: 'Exponent sharpening dense vs sparse regions',
    group: 'Texture',
  },
  minDotSize: {
    name: 'Min Dot Size',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 1.0,
    group: 'Geometry',
  },
  maxDotSize: {
    name: 'Max Dot Size',
    type: 'number', min: 1, max: 10, step: 0.5, default: 4.5,
    help: 'Dots are larger in dense regions',
    group: 'Geometry',
  },
  minDistance: {
    name: 'Min Spacing',
    type: 'number', min: 1, max: 30, step: 1, default: 5,
    help: 'Minimum gap between dot centres',
    group: 'Geometry',
  },
  dotShape: {
    name: 'Dot Shape',
    type: 'select',
    options: ['circle', 'square', 'diamond', 'dash', 'star'],
    default: 'circle',
    help: 'Shape of each stipple mark',
    group: 'Geometry',
  },
  sizeVariation: {
    name: 'Size Variation',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0,
    help: 'Random size jitter for a more organic feel — 0 = uniform, 1 = very varied',
    group: 'Texture',
  },
  densityStyle: {
    name: 'Density Style',
    type: 'select',
    options: ['fbm', 'ridged', 'turbulent', 'radial'],
    default: 'fbm',
    help: 'Shape of the density field — fbm: standard noise | ridged: ridge lines | turbulent: creases | radial: center-focused gradient',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-density', 'palette-position', 'monochrome', 'multi-layer'],
    default: 'palette-density',
    help: 'palette-density: color follows noise | multi-layer: separate passes per color',
    group: 'Color',
  },
  opacity: {
    name: 'Opacity',
    type: 'number', min: 0.2, max: 1.0, step: 0.05, default: 0.85,
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

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

// Density-weighted Poisson disc sampling
function weightedPoissonDisc(
  w: number, h: number,
  minDist: number,
  maxPoints: number,
  rng: SeededRNG,
  densityFn: (x: number, y: number) => number,
): [number, number, number][] {  // x, y, density
  const cellSize = Math.max(1, minDist / Math.sqrt(2));
  const gw = Math.max(1, Math.ceil(w / cellSize));
  const gh = Math.max(1, Math.ceil(h / cellSize));
  const grid = new Int32Array(gw * gh).fill(-1);

  const points: [number, number, number][] = [];
  const active: number[] = [];

  const addPoint = (x: number, y: number) => {
    const d = densityFn(x, y);
    const idx = points.length;
    points.push([x, y, d]);
    active.push(idx);
    const gx = Math.min(gw - 1, Math.floor(x / cellSize));
    const gy = Math.min(gh - 1, Math.floor(y / cellSize));
    grid[gy * gw + gx] = idx;
  };

  addPoint(rng.random() * w, rng.random() * h);

  while (active.length > 0 && points.length < maxPoints) {
    const ai = rng.integer(0, active.length - 1);
    const [px, py, pd] = points[active[ai]];

    // Adaptive minimum distance: moderate ratio so whole canvas fills
    const localMinDist = minDist * (0.65 + (1 - pd) * 0.55);

    let found = false;
    for (let k = 0; k < 25; k++) {
      const angle = rng.random() * Math.PI * 2;
      const dist = localMinDist * (1 + rng.random() * 1.5);
      const nx = px + Math.cos(angle) * dist;
      const ny = py + Math.sin(angle) * dist;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

      const nd = densityFn(nx, ny);

      const gnx = Math.min(gw - 1, Math.floor(nx / cellSize));
      const gny = Math.min(gh - 1, Math.floor(ny / cellSize));
      const sr = Math.ceil(localMinDist / cellSize) + 1;

      let ok = true;
      for (let sx = Math.max(0, gnx - sr); sx <= Math.min(gw - 1, gnx + sr) && ok; sx++) {
        for (let sy = Math.max(0, gny - sr); sy <= Math.min(gh - 1, gny + sr) && ok; sy++) {
          const pi = grid[sy * gw + sx];
          if (pi >= 0) {
            const dx = nx - points[pi][0];
            const dy = ny - points[pi][1];
            if (dx * dx + dy * dy < localMinDist * localMinDist) ok = false;
          }
        }
      }

      if (ok) {
        addPoint(nx, ny);
        found = true;
        break;
      }
    }

    if (!found) active.splice(ai, 1);
  }

  return points;
}

export const stippling: Generator = {
  id: 'stippling',
  family: 'plotter',
  styleName: 'Stippling',
  definition: 'Density-adaptive stippling with noise-driven dot clustering, variable size, and per-dot color mapping',
  algorithmNotes: 'Weighted Poisson disc sampling biases point placement toward dense noise regions. Dot radius inversely scales with local spacing, giving larger dots in darker areas. Color follows the noise density value mapped through the palette.',
  parameterSchema,
  defaultParams: { pointCount: 8000, densityScale: 2.5, densityContrast: 2.0, minDotSize: 1.0, maxDotSize: 4.5, minDistance: 5, dotShape: 'circle', sizeVariation: 0, densityStyle: 'fbm', colorMode: 'palette-density', opacity: 0.85, background: 'cream' },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderCanvas2D(ctx, params, seed, palette) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { pointCount, densityScale, densityContrast, minDotSize, maxDotSize, minDistance, dotShape, sizeVariation, densityStyle, colorMode, opacity, background } = params;

    ctx.fillStyle = BG[background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const densityFn = (x: number, y: number): number => {
      const nx = (x / w - 0.5) * densityScale + 5;
      const ny = (y / h - 0.5) * densityScale + 5;
      let n: number;
      if (densityStyle === 'ridged') {
        const raw = noise.fbm(nx, ny, 5, 2.0, 0.5);
        const ridge = 1 - Math.abs(raw);
        n = ridge * ridge;
      } else if (densityStyle === 'turbulent') {
        n = Math.abs(noise.fbm(nx, ny, 5, 2.0, 0.5));
      } else if (densityStyle === 'radial') {
        const dx = x / w - 0.5, dy = y / h - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy) * 2;
        const noiseVal = noise.fbm(nx, ny, 3, 2.0, 0.5) * 0.3;
        n = Math.max(0, 1 - dist + noiseVal);
      } else {
        n = noise.fbm(nx, ny, 5, 2.0, 0.5) * 0.5 + 0.5;
      }
      return Math.pow(Math.max(0, Math.min(1, n)), densityContrast);
    };

    // Draw a single mark at (px, py) with given radius
    const drawMark = (px: number, py: number, radius: number) => {
      if (dotShape === 'square') {
        ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
      } else if (dotShape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(px, py - radius);
        ctx.lineTo(px + radius, py);
        ctx.lineTo(px, py + radius);
        ctx.lineTo(px - radius, py);
        ctx.closePath();
        ctx.fill();
      } else if (dotShape === 'dash') {
        const a = rng.random() * Math.PI;
        const dx = Math.cos(a) * radius * 1.5;
        const dy = Math.sin(a) * radius * 1.5;
        ctx.beginPath();
        ctx.moveTo(px - dx, py - dy);
        ctx.lineTo(px + dx, py + dy);
        ctx.lineWidth = radius * 0.7;
        ctx.stroke();
      } else if (dotShape === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const outerA = (i * 2 * Math.PI / 5) - Math.PI / 2;
          const innerA = outerA + Math.PI / 5;
          const ox = px + Math.cos(outerA) * radius;
          const oy = py + Math.sin(outerA) * radius;
          const ix = px + Math.cos(innerA) * radius * 0.4;
          const iy = py + Math.sin(innerA) * radius * 0.4;
          if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
          ctx.lineTo(ix, iy);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (colorMode === 'multi-layer') {
      // Separate pass per palette color, each with its own noise octave offset
      const perLayer = Math.ceil(pointCount / palette.colors.length);
      for (let li = 0; li < palette.colors.length; li++) {
        const layerNoise = new SimplexNoise(seed + li * 7919);
        const layerDensity = (x: number, y: number): number => {
          const n = layerNoise.fbm(
            (x / w - 0.5) * densityScale + 5 + li * 1.3,
            (y / h - 0.5) * densityScale + 5 + li * 0.9,
            4, 2.0, 0.5,
          );
          return Math.pow(Math.max(0, n * 0.5 + 0.5), densityContrast);
        };

        const pts = weightedPoissonDisc(w, h, minDistance * 1.4, perLayer, new SeededRNG(seed + li * 113), layerDensity);
        const [r, g, b] = hexToRgb(palette.colors[li]);

        for (const [px, py, density] of pts) {
          let radius = minDotSize + (maxDotSize - minDotSize) * density;
          if (sizeVariation > 0) radius *= 1 + (rng.random() - 0.5) * sizeVariation;
          ctx.fillStyle = `rgba(${r},${g},${b},${opacity * density})`;
          ctx.strokeStyle = ctx.fillStyle;
          drawMark(px, py, Math.max(0.5, radius));
        }
      }
      return;
    }

    // Single-pass weighted Poisson disc
    const pts = weightedPoissonDisc(w, h, minDistance, pointCount, rng, densityFn);

    for (const [px, py, density] of pts) {
      let radius = minDotSize + (maxDotSize - minDotSize) * density;
      if (sizeVariation > 0) radius *= 1 + (rng.random() - 0.5) * sizeVariation;
      radius = Math.max(0.5, radius);

      let fillStyle: string;
      if (colorMode === 'monochrome') {
        const v = (density * 200) | 0;
        fillStyle = `rgba(${v},${v},${v},${opacity})`;
      } else if (colorMode === 'palette-position') {
        const t = (px / w * 0.6 + py / h * 0.4);
        const ci = Math.min(Math.floor(t * palette.colors.length), palette.colors.length - 1);
        const [r, g, b] = hexToRgb(palette.colors[ci]);
        fillStyle = `rgba(${r},${g},${b},${opacity})`;
      } else {
        const ci = density * (palette.colors.length - 1);
        const c0 = Math.floor(ci), c1 = Math.min(c0 + 1, palette.colors.length - 1);
        const frac = ci - c0;
        const [r0, g0, b0] = hexToRgb(palette.colors[c0]);
        const [r1, g1, b1] = hexToRgb(palette.colors[c1]);
        const r = (r0 + (r1 - r0) * frac) | 0;
        const g = (g0 + (g1 - g0) * frac) | 0;
        const b = (b0 + (b1 - b0) * frac) | 0;
        fillStyle = `rgba(${r},${g},${b},${opacity * (0.5 + density * 0.5)})`;
      }

      ctx.fillStyle = fillStyle;
      ctx.strokeStyle = fillStyle;
      drawMark(px, py, radius);
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(params.pointCount * 1.5); },
};
