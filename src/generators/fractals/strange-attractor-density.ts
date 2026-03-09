import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  if (isNaN(v)) return colors[0];
  const s = v * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

// Known good parameter ranges per attractor type for seed-based randomization
const PARAM_RANGES: Record<string, { a: [number, number]; b: [number, number]; c: [number, number]; d: [number, number] }> = {
  clifford: { a: [-2, 2], b: [-2, 2], c: [-2, 2], d: [-2, 2] },
  'de-jong': { a: [-3, 3], b: [-3, 3], c: [-3, 3], d: [-3, 3] },
  svensson: { a: [-2, 2], b: [-2, 2], c: [-2, 2], d: [-2, 2] },
  bedhead: { a: [-1, 1], b: [-1, 1], c: [-1, 1], d: [-1, 1] },
  hopalong: { a: [-3, 3], b: [-1, 1], c: [-1, 1], d: [-1, 1] },
};

const parameterSchema: ParameterSchema = {
  attractor: {
    name: 'Attractor', type: 'select',
    options: ['clifford', 'de-jong', 'svensson', 'bedhead', 'hopalong'],
    default: 'clifford',
    help: 'Type of strange attractor formula',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations', type: 'number', min: 50000, max: 800000, step: 50000, default: 200000,
    help: 'More iterations = denser, more detailed image',
    group: 'Composition',
  },
  paramA: {
    name: 'Param A', type: 'number', min: -3, max: 3, step: 0.1, default: -1.7,
    group: 'Geometry',
  },
  paramB: {
    name: 'Param B', type: 'number', min: -3, max: 3, step: 0.1, default: 1.3,
    group: 'Geometry',
  },
  paramC: {
    name: 'Param C', type: 'number', min: -3, max: 3, step: 0.1, default: -0.1,
    group: 'Geometry',
  },
  paramD: {
    name: 'Param D', type: 'number', min: -3, max: 3, step: 0.1, default: -1.2,
    group: 'Geometry',
  },
  gamma: {
    name: 'Gamma', type: 'number', min: 1, max: 5, step: 0.1, default: 2.2,
    help: 'Tone mapping gamma — higher values reveal faint structure',
    group: 'Color',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['density', 'velocity', 'angle'],
    default: 'density',
    help: 'density: by point count · velocity: by movement speed · angle: by direction',
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['black', 'dark', 'white'],
    default: 'black', group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation speed for parameter morphing',
    group: 'Flow/Motion',
  },
};

const BG: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  dark: [10, 10, 15],
  white: [248, 248, 245],
};

// Iterate attractor one step
function iterateAttractor(
  type: string, x: number, y: number, a: number, b: number, c: number, d: number,
): [number, number] {
  switch (type) {
    case 'clifford':
      return [
        Math.sin(a * y) + c * Math.cos(a * x),
        Math.sin(b * x) + d * Math.cos(b * y),
      ];
    case 'de-jong':
      return [
        Math.sin(a * y) - Math.cos(b * x),
        Math.sin(c * x) - Math.cos(d * y),
      ];
    case 'svensson':
      return [
        d * Math.sin(a * x) - Math.sin(b * y),
        c * Math.cos(a * x) + Math.cos(b * y),
      ];
    case 'bedhead':
      return [
        Math.sin(x * y / (Math.abs(b) + 0.01)) * y + Math.cos(a * x - y),
        x + Math.sin(y) / (Math.abs(b) + 0.01),
      ];
    case 'hopalong': {
      const signX = x >= 0 ? 1 : -1;
      return [
        y - signX * Math.sqrt(Math.abs(b * x - c)),
        a - x,
      ];
    }
    default:
      return [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y)];
  }
}

export const strangeAttractorDensity: Generator = {
  id: 'fractal-strange-attractor',
  family: 'fractals',
  styleName: 'Strange Attractor Density',
  definition: 'Strange attractor density plot — chaotic iterated maps rendered as luminous density histograms',
  algorithmNotes:
    'Iterates a chaotic attractor formula (Clifford, De Jong, Svensson, Bedhead, or Hopalong) millions of times, ' +
    'accumulating point density into a histogram grid. The density is tone-mapped via log scaling and gamma ' +
    'correction, then colored by the palette. Velocity and angle color modes track movement properties per cell ' +
    'for richer visual information.',
  parameterSchema,
  defaultParams: {
    attractor: 'clifford', iterations: 200000,
    paramA: -1.7, paramB: 1.3, paramC: -0.1, paramD: -1.2,
    gamma: 2.2, colorMode: 'density', background: 'black', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;

    const rng = new SeededRNG(seed);
    const colors = palette.colors.map(hexToRgb);
    const bgColor = BG[(params.background ?? 'black') as string] ?? BG.black;
    const isLightBg = (params.background as string) === 'white';

    const attractorType = (params.attractor ?? 'clifford') as string;
    const gamma = params.gamma ?? 2.2;
    const colorMode = (params.colorMode ?? 'density') as string;
    const speed = params.speed ?? 0.5;

    let totalIter = params.iterations ?? 200000;
    if (quality === 'draft') totalIter = Math.max(20000, totalIter >> 2);
    else if (quality === 'ultra') totalIter = Math.min(800000, totalIter * 2);
    const trackAux = colorMode !== 'density';

    // Blend seed-based random params with user params
    const ranges = PARAM_RANGES[attractorType] || PARAM_RANGES.clifford;
    const seedA = rng.range(ranges.a[0], ranges.a[1]);
    const seedB = rng.range(ranges.b[0], ranges.b[1]);
    const seedC = rng.range(ranges.c[0], ranges.c[1]);
    const seedD = rng.range(ranges.d[0], ranges.d[1]);

    // Mix: 50% seed, 50% user param
    let a = seedA * 0.5 + (params.paramA ?? -1.7) * 0.5;
    let b = seedB * 0.5 + (params.paramB ?? 1.3) * 0.5;
    let c = seedC * 0.5 + (params.paramC ?? -0.1) * 0.5;
    let d = seedD * 0.5 + (params.paramD ?? -1.2) * 0.5;

    // Animate: morph parameters
    if (time > 0) {
      a += Math.sin(time * speed * 0.2) * 0.3;
      b += Math.cos(time * speed * 0.15) * 0.3;
      c += Math.sin(time * speed * 0.25 + 1.5) * 0.2;
      d += Math.cos(time * speed * 0.18 + 2.0) * 0.2;
    }

    // Density + auxiliary histograms (only alloc aux when needed)
    const hist = new Float32Array(w * h);
    const auxHist = trackAux ? new Float32Array(w * h) : null;

    // Inline attractor iteration to avoid function call + array allocation per step
    const iterate = (ix: number, iy: number): [number, number] => {
      switch (attractorType) {
        case 'de-jong':
          return [Math.sin(a * iy) - Math.cos(b * ix), Math.sin(c * ix) - Math.cos(d * iy)];
        case 'svensson':
          return [d * Math.sin(a * ix) - Math.sin(b * iy), c * Math.cos(a * ix) + Math.cos(b * iy)];
        case 'bedhead': {
          const bAbs = Math.abs(b) + 0.01;
          return [Math.sin(ix * iy / bAbs) * iy + Math.cos(a * ix - iy), ix + Math.sin(iy) / bAbs];
        }
        case 'hopalong': {
          const s = ix >= 0 ? 1 : -1;
          return [iy - s * Math.sqrt(Math.abs(b * ix - c)), a - ix];
        }
        default: // clifford
          return [Math.sin(a * iy) + c * Math.cos(a * ix), Math.sin(b * ix) + d * Math.cos(b * iy)];
      }
    };

    // First pass: determine bounds (small sample)
    let x = 0.1, y = 0.1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const boundSample = Math.min(3000, totalIter);
    for (let i = 0; i < boundSample; i++) {
      const res = iterate(x, y);
      const nx = res[0], ny = res[1];
      if (!isFinite(nx) || !isFinite(ny) || Math.abs(nx) > 1e6 || Math.abs(ny) > 1e6) {
        x = rng.range(-1, 1); y = rng.range(-1, 1);
        continue;
      }
      x = nx; y = ny;
      if (i > 50) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }

    // Handle degenerate bounds
    if (!isFinite(minX) || maxX - minX < 0.001) { minX = -3; maxX = 3; }
    if (!isFinite(minY) || maxY - minY < 0.001) { minY = -3; maxY = 3; }

    const padX = (maxX - minX) * 0.05, padY = (maxY - minY) * 0.05;
    minX -= padX; maxX += padX;
    minY -= padY; maxY += padY;

    const rangeX = maxX - minX, rangeY = maxY - minY;
    const scaleX = (w - 1) / rangeX, scaleY = (h - 1) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const offX = (w - rangeX * scale) * 0.5;
    const offY = (h - rangeY * scale) * 0.5;

    // Main accumulation pass
    x = 0.1; y = 0.1;
    for (let i = 0; i < totalIter; i++) {
      const res = iterate(x, y);
      const nx = res[0], ny = res[1];
      if (!isFinite(nx) || !isFinite(ny) || Math.abs(nx) > 1e6 || Math.abs(ny) > 1e6) {
        x = rng.range(-1, 1); y = rng.range(-1, 1);
        continue;
      }

      const prevX = x, prevY = y;
      x = nx; y = ny;

      if (i < 50) continue; // Skip warmup

      const px = ((x - minX) * scale + offX) | 0;
      const py = ((y - minY) * scale + offY) | 0;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;

      const idx = py * w + px;
      hist[idx]++;

      if (auxHist) {
        if (colorMode === 'velocity') {
          const dx = x - prevX, dy = y - prevY;
          auxHist[idx] += Math.sqrt(dx * dx + dy * dy);
        } else {
          auxHist[idx] += Math.atan2(y - prevY, x - prevX);
        }
      }
    }

    // Find max density and max aux
    let maxDensity = 0, maxAux = 0;
    for (let i = 0; i < w * h; i++) {
      if (hist[i] > maxDensity) maxDensity = hist[i];
      if (auxHist && hist[i] > 0) {
        const avgAux = Math.abs(auxHist[i] / hist[i]);
        if (avgAux > maxAux) maxAux = avgAux;
      }
    }

    const logMax = Math.log(1 + maxDensity) || 1;
    const invGamma = 1 / gamma;

    // Render to ImageData
    const img = ctx.createImageData(w, h);
    const data = img.data;

    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      if (hist[i] === 0) {
        data[idx] = bgColor[0]; data[idx + 1] = bgColor[1]; data[idx + 2] = bgColor[2]; data[idx + 3] = 255;
        continue;
      }

      const density = hist[i];
      const alpha = Math.log(1 + density) / logMax;
      const gammaAlpha = Math.pow(alpha, invGamma);
      const clampAlpha = Math.min(1, gammaAlpha);

      let colorT: number;
      if (auxHist && colorMode === 'velocity') {
        const avgVel = auxHist[i] / density;
        colorT = maxAux > 0 ? Math.min(1, avgVel / maxAux) : 0;
      } else if (auxHist && colorMode === 'angle') {
        const avgAngle = auxHist[i] / density;
        colorT = (avgAngle / Math.PI + 1) * 0.5 % 1;
      } else {
        colorT = clampAlpha;
      }

      const [cr, cg, cb] = paletteSample(colorT, colors);

      if (isLightBg) {
        data[idx] = Math.max(0, bgColor[0] - cr * clampAlpha) | 0;
        data[idx + 1] = Math.max(0, bgColor[1] - cg * clampAlpha) | 0;
        data[idx + 2] = Math.max(0, bgColor[2] - cb * clampAlpha) | 0;
      } else {
        data[idx] = Math.min(255, cr * clampAlpha) | 0;
        data[idx + 1] = Math.min(255, cg * clampAlpha) | 0;
        data[idx + 2] = Math.min(255, cb * clampAlpha) | 0;
      }
      data[idx + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const iters = params.iterations ?? 1000000;
    return Math.round(iters / 1000);
  },
};
