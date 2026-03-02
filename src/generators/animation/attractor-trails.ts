import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Seeded parameter presets for good-looking attractors
function getPreset(seed: number, type: string): [number, number, number, number] {
  const rng = new SeededRNG(seed);
  if (type === 'clifford') {
    // Good Clifford ranges: a,b ∈ [-2,2], c,d ∈ [-1.5,1.5]
    return [
      rng.range(-2, 2),
      rng.range(-2, 2),
      rng.range(-1.5, 1.5),
      rng.range(-1.5, 1.5),
    ];
  }
  // De Jong
  return [
    rng.range(-3, 3),
    rng.range(-3, 3),
    rng.range(-3, 3),
    rng.range(-3, 3),
  ];
}

const parameterSchema: ParameterSchema = {
  attractorType: {
    name: 'Attractor Type',
    type: 'select',
    options: ['clifford', 'dejong', 'bedhead'],
    default: 'clifford',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations (×1000)',
    type: 'number', min: 100, max: 2000, step: 100, default: 800,
    help: 'More iterations = denser output; lower values improve animation frame-rate',
    group: 'Composition',
  },
  brightness: {
    name: 'Brightness',
    type: 'number', min: 0.5, max: 4, step: 0.1, default: 1.5,
    help: 'Tone-map exponent for density',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['density', 'velocity', 'angle'],
    default: 'density',
    group: 'Color',
  },
  pointSize: {
    name: 'Point Size',
    type: 'number', min: 1, max: 4, step: 1, default: 1,
    group: 'Geometry',
  },
  driftSpeed: {
    name: 'Drift Speed',
    type: 'number', min: 0, max: 1.0, step: 0.05, default: 0.2,
    help: 'How fast the attractor parameters oscillate over time — each parameter drifts at a distinct seeded frequency so the shape morphs continuously',
    group: 'Flow/Motion',
  },
  driftAmp: {
    name: 'Drift Amplitude',
    type: 'number', min: 0, max: 0.5, step: 0.02, default: 0.15,
    help: 'Maximum ±offset applied to each parameter during animation; larger values = more extreme morphing',
    group: 'Flow/Motion',
  },
};

function iterateClifford(x: number, y: number, a: number, b: number, c: number, d: number): [number, number] {
  return [
    Math.sin(a * y) + c * Math.cos(a * x),
    Math.sin(b * x) + d * Math.cos(b * y),
  ];
}

function iterateDeJong(x: number, y: number, a: number, b: number, c: number, d: number): [number, number] {
  return [
    Math.sin(a * y) - Math.cos(b * x),
    Math.sin(c * x) - Math.cos(d * y),
  ];
}

function iterateBedhead(x: number, y: number, a: number, b: number): [number, number] {
  return [
    Math.sin(x * y / b) * y + Math.cos(a * x - y),
    x + Math.sin(y) / b,
  ];
}

export const attractorTrails: Generator = {
  id: 'attractor-trails',
  family: 'animation',
  styleName: 'Attractor Trails',
  definition: 'Strange attractors — Clifford, De Jong and Bedhead — rendered by iterating millions of points through chaotic maps',
  algorithmNotes: 'Each seed maps to unique attractor parameters. A 2D density histogram is built from iterated points, then log-tone-mapped and colored through the palette.',
  parameterSchema,
  defaultParams: { attractorType: 'clifford', iterations: 800, brightness: 1.5, colorMode: 'density', pointSize: 1, driftSpeed: 0.2, driftAmp: 0.15 },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { attractorType, iterations, brightness, colorMode, pointSize } = params;

    const isAnimating = time !== 0;
    // In animation mode scale down iterations so we can hit real-time frame rates
    const animScale = isAnimating ? 0.2 : 1;
    const qualityScale = quality === 'ultra' ? 2 : quality === 'draft' ? 0.3 : 1;
    const iters = (iterations * 1000 * animScale * qualityScale) | 0;

    let [a, b, c, d] = getPreset(seed, attractorType);

    if (isAnimating) {
      // Each parameter drifts at its own seeded frequency so they never sync up
      const driftRng = new SeededRNG(seed ^ 0xabcd1234);
      const phases = [
        driftRng.random() * Math.PI * 2,
        driftRng.random() * Math.PI * 2,
        driftRng.random() * Math.PI * 2,
        driftRng.random() * Math.PI * 2,
      ];
      // Irrational-ish frequency ratios keep the motion aperiodic
      const freqs = [0.37, 0.53, 0.29, 0.61];
      const speed = params.driftSpeed ?? 0.2;
      const amp = params.driftAmp ?? 0.15;
      a += amp * Math.sin(time * speed * freqs[0] + phases[0]);
      b += amp * Math.cos(time * speed * freqs[1] + phases[1]);
      c += amp * Math.sin(time * speed * freqs[2] + phases[2]);
      d += amp * Math.cos(time * speed * freqs[3] + phases[3]);
    }

    // Bounds discovery pass (10k warmup)
    let x = 0.1, y = 0.1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 10000; i++) {
      let nx: number, ny: number;
      if (attractorType === 'clifford') [nx, ny] = iterateClifford(x, y, a, b, c, d);
      else if (attractorType === 'bedhead') [nx, ny] = iterateBedhead(x, y, a, b);
      else [nx, ny] = iterateDeJong(x, y, a, b, c, d);
      x = nx; y = ny;
      if (i > 100) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }

    const pad = 0.05;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const margin = Math.min(w, h) * pad;

    const toPixelX = (v: number) => margin + ((v - minX) / rangeX) * (w - 2 * margin);
    const toPixelY = (v: number) => margin + ((v - minY) / rangeY) * (h - 2 * margin);

    // Density histogram
    const hist = new Float32Array(w * h);
    const velHist = new Float32Array(w * h);

    x = 0.1; y = 0.1;
    for (let i = 0; i < iters; i++) {
      let nx: number, ny: number;
      if (attractorType === 'clifford') [nx, ny] = iterateClifford(x, y, a, b, c, d);
      else if (attractorType === 'bedhead') [nx, ny] = iterateBedhead(x, y, a, b);
      else [nx, ny] = iterateDeJong(x, y, a, b, c, d);

      const px = toPixelX(nx) | 0;
      const py = toPixelY(ny) | 0;

      if (px >= 0 && px < w && py >= 0 && py < h) {
        const idx = py * w + px;
        hist[idx]++;
        const vel = Math.sqrt((nx - x) ** 2 + (ny - y) ** 2);
        velHist[idx] = (velHist[idx] + vel) * 0.5;
      }

      x = nx; y = ny;
    }

    // Find max density for normalisation
    let maxDens = 0;
    for (let i = 0; i < hist.length; i++) if (hist[i] > maxDens) maxDens = hist[i];
    if (maxDens === 0) return;

    const logMax = Math.log(maxDens + 1);

    // Render
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < hist.length; i++) {
      if (hist[i] === 0) continue;

      const t = Math.pow(Math.log(hist[i] + 1) / logMax, 1 / brightness);
      let r: number, g: number, b2: number;

      if (colorMode === 'density') {
        const ci = t * (palette.colors.length - 1);
        const c0 = Math.floor(ci), c1 = Math.min(c0 + 1, palette.colors.length - 1);
        const frac = ci - c0;
        const [r0, g0, b0] = hexToRgb(palette.colors[c0]);
        const [r1, g1, b1] = hexToRgb(palette.colors[c1]);
        r = r0 + (r1 - r0) * frac; g = g0 + (g1 - g0) * frac; b2 = b0 + (b1 - b0) * frac;
      } else {
        const vel = Math.min(1, velHist[i] / 2);
        const colIdx = Math.floor(vel * (palette.colors.length - 1));
        [r, g, b2] = hexToRgb(palette.colors[Math.min(colIdx, palette.colors.length - 1)]);
      }

      const px = i % w, py = (i / w) | 0;
      for (let dy = 0; dy < pointSize && py + dy < h; dy++) {
        for (let dx = 0; dx < pointSize && px + dx < w; dx++) {
          const idx = ((py + dy) * w + (px + dx)) * 4;
          data[idx]     = Math.min(255, (data[idx]     + r * t) | 0);
          data[idx + 1] = Math.min(255, (data[idx + 1] + g * t) | 0);
          data[idx + 2] = Math.min(255, (data[idx + 2] + b2 * t) | 0);
          data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(params.iterations * 8); },
};
