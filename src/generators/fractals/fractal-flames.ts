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

// Variation functions (Scott Draves' flame algorithm)
type VarFn = (x: number, y: number, r: number, theta: number) => [number, number];

const variations: Record<string, VarFn> = {
  linear: (x, y) => [x, y],
  sinusoidal: (x, y) => [Math.sin(x), Math.sin(y)],
  spherical: (x, y, r) => {
    const r2 = r * r || 0.0001;
    return [x / r2, y / r2];
  },
  swirl: (x, y, r) => {
    const r2 = r * r;
    const sr = Math.sin(r2), cr = Math.cos(r2);
    return [x * sr - y * cr, x * cr + y * sr];
  },
  horseshoe: (x, y, r) => {
    const ri = 1 / (r || 0.0001);
    return [ri * (x - y) * (x + y), ri * 2 * x * y];
  },
  handkerchief: (x, _y, r, theta) => [r * Math.sin(theta + r), r * Math.cos(theta - r)],
  spiral: (x, _y, r, theta) => {
    const ri = 1 / (r || 0.0001);
    return [ri * (Math.cos(theta) + Math.sin(r)), ri * (Math.sin(theta) - Math.cos(r))];
  },
  diamond: (_x, _y, r, theta) => [Math.sin(theta) * Math.cos(r), Math.cos(theta) * Math.sin(r)],
};

const VAR_NAMES = Object.keys(variations);

// Affine transform: [a, b, c, d, e, f, probability, colorIndex]
type FlameTransform = {
  a: number; b: number; c: number; d: number; e: number; f: number;
  prob: number; colorIdx: number; variation: string;
};

function generateTransforms(rng: SeededRNG, preset: string, variationMix: string): FlameTransform[] {
  const count = preset === 'random' ? 3 + (rng.integer(0, 2)) : 4;
  const transforms: FlameTransform[] = [];

  const presetCoeffs: Record<string, FlameTransform[]> = {
    serpentine: [
      { a: 0.6, b: -0.4, c: 0.4, d: 0.6, e: 0.3, f: 0, prob: 0.4, colorIdx: 0, variation: 'sinusoidal' },
      { a: -0.5, b: 0.3, c: -0.3, d: -0.5, e: -0.2, f: 0.5, prob: 0.3, colorIdx: 0.5, variation: 'swirl' },
      { a: 0.3, b: 0.5, c: -0.5, d: 0.3, e: 0, f: -0.3, prob: 0.3, colorIdx: 1, variation: 'spiral' },
    ],
    flower: [
      { a: 0.5, b: -0.5, c: 0.5, d: 0.5, e: 0, f: 0, prob: 0.35, colorIdx: 0, variation: 'spherical' },
      { a: -0.5, b: -0.5, c: 0.5, d: -0.5, e: 0, f: 0, prob: 0.35, colorIdx: 0.5, variation: 'sinusoidal' },
      { a: 0.7, b: 0, c: 0, d: 0.7, e: 0, f: 0.5, prob: 0.3, colorIdx: 1, variation: 'handkerchief' },
    ],
    vortex: [
      { a: 0.8, b: 0.2, c: -0.2, d: 0.8, e: 0, f: 0, prob: 0.5, colorIdx: 0, variation: 'swirl' },
      { a: -0.3, b: 0.6, c: -0.6, d: -0.3, e: 0, f: 0, prob: 0.3, colorIdx: 0.6, variation: 'horseshoe' },
      { a: 0.4, b: -0.4, c: 0.4, d: 0.4, e: 0.1, f: -0.2, prob: 0.2, colorIdx: 1, variation: 'spiral' },
    ],
    crystal: [
      { a: 0.5, b: 0, c: 0, d: 0.5, e: 0.5, f: 0.5, prob: 0.25, colorIdx: 0, variation: 'diamond' },
      { a: 0.5, b: 0, c: 0, d: 0.5, e: -0.5, f: 0.5, prob: 0.25, colorIdx: 0.33, variation: 'diamond' },
      { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: -0.5, prob: 0.25, colorIdx: 0.66, variation: 'linear' },
      { a: 0.4, b: 0.3, c: -0.3, d: 0.4, e: 0, f: 0, prob: 0.25, colorIdx: 1, variation: 'spherical' },
    ],
  };

  if (preset !== 'random' && presetCoeffs[preset]) {
    const base = presetCoeffs[preset];
    return base.map(t => ({
      ...t,
      variation: variationMix !== 'mixed' ? variationMix : t.variation,
    }));
  }

  // Random transforms
  let totalProb = 0;
  for (let i = 0; i < count; i++) {
    const prob = 0.2 + rng.random() * 0.8;
    totalProb += prob;
    const varName = variationMix === 'mixed'
      ? VAR_NAMES[rng.integer(0, VAR_NAMES.length - 1)]
      : variationMix;
    transforms.push({
      a: rng.range(-1, 1), b: rng.range(-1, 1),
      c: rng.range(-1, 1), d: rng.range(-1, 1),
      e: rng.range(-0.5, 0.5), f: rng.range(-0.5, 0.5),
      prob: prob / totalProb,
      colorIdx: i / (count - 1),
      variation: varName,
    });
  }
  // Normalize probabilities
  const sum = transforms.reduce((s, t) => s + t.prob, 0);
  for (const t of transforms) t.prob /= sum;
  return transforms;
}

const BG: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  dark: [10, 10, 15],
  white: [248, 248, 245],
};

const parameterSchema: ParameterSchema = {
  preset: {
    name: 'Preset', type: 'select',
    options: ['random', 'serpentine', 'flower', 'vortex', 'crystal'],
    default: 'random',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations', type: 'number', min: 50000, max: 500000, step: 50000, default: 150000,
    help: 'More iterations = denser, more detailed image',
    group: 'Composition',
  },
  variations: {
    name: 'Variation', type: 'select',
    options: ['mixed', 'linear', 'sinusoidal', 'spherical', 'swirl', 'horseshoe'],
    default: 'mixed',
    help: 'Nonlinear transform applied to each iteration',
    group: 'Geometry',
  },
  gamma: {
    name: 'Gamma', type: 'number', min: 1, max: 5, step: 0.1, default: 2.5,
    help: 'Tone mapping gamma — higher values reveal more subtle structure',
    group: 'Color',
  },
  brightness: {
    name: 'Brightness', type: 'number', min: 0.5, max: 3, step: 0.1, default: 1.5,
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['black', 'dark', 'white'],
    default: 'black', group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation speed for transform morphing',
    group: 'Flow/Motion',
  },
};

export const fractalFlames: Generator = {
  id: 'fractal-fractal-flames',
  family: 'fractals',
  styleName: 'Fractal Flames',
  definition: 'Fractal flame — iterated function system with nonlinear variation functions and density histogram rendering',
  algorithmNotes:
    'Uses the chaos game with multiple affine transforms, each paired with a nonlinear variation function ' +
    '(sinusoidal, spherical, swirl, horseshoe, etc.). Points are accumulated into a density histogram and ' +
    'rendered via log-density tone mapping with gamma correction. Per-transform color indices blend smoothly ' +
    'to produce rich, organic flame structures.',
  parameterSchema,
  defaultParams: {
    preset: 'random', iterations: 150000, variations: 'mixed',
    gamma: 2.5, brightness: 1.5, background: 'black', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;

    const rng = new SeededRNG(seed);
    const colors = palette.colors.map(hexToRgb);
    const bgColor = BG[(params.background ?? 'black') as string] ?? BG.black;
    const isLightBg = (params.background as string) === 'white';

    const preset = (params.preset ?? 'random') as string;
    const variationMix = (params.variations ?? 'mixed') as string;
    const gamma = params.gamma ?? 2.5;
    const brightness = params.brightness ?? 1.5;
    const speed = params.speed ?? 0.5;

    let totalIter = params.iterations ?? 150000;
    if (quality === 'draft') totalIter = Math.max(20000, totalIter >> 2);
    else if (quality === 'ultra') totalIter = Math.min(500000, totalIter * 2);

    // Generate transforms (morph over time for animation)
    const transforms = generateTransforms(rng, preset, variationMix);

    if (time > 0) {
      const morphAmt = Math.sin(time * speed * 0.3) * 0.15;
      for (const t of transforms) {
        t.a += morphAmt * Math.sin(time * speed * 0.7 + t.colorIdx * 5);
        t.d += morphAmt * Math.cos(time * speed * 0.5 + t.colorIdx * 3);
        t.e += morphAmt * 0.3 * Math.sin(time * speed * 0.4);
      }
    }

    // Build cumulative probability table
    const cumProb: number[] = [];
    let cp = 0;
    for (const t of transforms) { cp += t.prob; cumProb.push(cp); }

    // Pre-cache color per transform (avoids paletteSample per iteration)
    const tColors: [number, number, number][] = transforms.map(t => paletteSample(t.colorIdx, colors));
    // Resolve variation functions once
    const tVarFns: VarFn[] = transforms.map(t => variations[t.variation] || variations.linear);

    // Density + color histograms
    const hist = new Float32Array(w * h);
    const histR = new Float32Array(w * h);
    const histG = new Float32Array(w * h);
    const histB = new Float32Array(w * h);

    // Chaos game
    let x = rng.range(-1, 1), y = rng.range(-1, 1);

    // Determine bounding box by running a small sample
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const sampleIter = Math.min(3000, totalIter);
    for (let i = 0; i < sampleIter; i++) {
      const rv = rng.random();
      let ti = 0;
      for (; ti < cumProb.length - 1; ti++) { if (rv < cumProb[ti]) break; }
      const t = transforms[ti];
      const nx = t.a * x + t.b * y + t.e;
      const ny = t.c * x + t.d * y + t.f;
      const r2 = nx * nx + ny * ny;
      const r = Math.sqrt(r2) || 0.0001;
      const theta = Math.atan2(ny, nx);
      const res = tVarFns[ti](nx, ny, r, theta);
      x = res[0]; y = res[1];
      if (i > 20) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }

    // Expand bounds slightly and handle degenerate cases
    const rangeX = (maxX - minX) || 2;
    const rangeY = (maxY - minY) || 2;
    const padX = rangeX * 0.1, padY = rangeY * 0.1;
    minX -= padX; maxX += padX;
    minY -= padY; maxY += padY;
    const finalRangeX = maxX - minX;
    const finalRangeY = maxY - minY;

    // Fit to canvas maintaining aspect ratio
    const scaleX = w / finalRangeX;
    const scaleY = h / finalRangeY;
    const scale = Math.min(scaleX, scaleY);
    const offX = (w - finalRangeX * scale) * 0.5;
    const offY = (h - finalRangeY * scale) * 0.5;

    // Reset and accumulate
    x = rng.range(-1, 1); y = rng.range(-1, 1);

    for (let i = 0; i < totalIter; i++) {
      const rv = rng.random();
      let ti = 0;
      for (; ti < cumProb.length - 1; ti++) { if (rv < cumProb[ti]) break; }
      const t = transforms[ti];
      const nx = t.a * x + t.b * y + t.e;
      const ny = t.c * x + t.d * y + t.f;
      const r = Math.sqrt(nx * nx + ny * ny) || 0.0001;
      const theta = Math.atan2(ny, nx);
      const res = tVarFns[ti](nx, ny, r, theta);
      x = res[0]; y = res[1];

      if (i < 20) continue; // Skip warmup

      const px = ((x - minX) * scale + offX) | 0;
      const py = ((y - minY) * scale + offY) | 0;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;

      const idx = py * w + px;
      hist[idx]++;
      const tc = tColors[ti];
      histR[idx] += tc[0];
      histG[idx] += tc[1];
      histB[idx] += tc[2];
    }

    // Find max density
    let maxDensity = 0;
    for (let i = 0; i < w * h; i++) {
      if (hist[i] > maxDensity) maxDensity = hist[i];
    }
    const logMax = Math.log(1 + maxDensity) || 1;
    const invGamma = 1 / gamma;

    // Render to ImageData
    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      if (hist[i] === 0) {
        d[idx] = bgColor[0]; d[idx + 1] = bgColor[1]; d[idx + 2] = bgColor[2]; d[idx + 3] = 255;
        continue;
      }

      const density = hist[i];
      const alpha = Math.log(1 + density) / logMax;
      const gammaAlpha = Math.pow(alpha, invGamma) * brightness;
      const clampAlpha = Math.min(1, gammaAlpha);

      const avgR = histR[i] / density;
      const avgG = histG[i] / density;
      const avgB = histB[i] / density;

      if (isLightBg) {
        // Darken on light background
        d[idx] = Math.max(0, bgColor[0] - avgR * clampAlpha) | 0;
        d[idx + 1] = Math.max(0, bgColor[1] - avgG * clampAlpha) | 0;
        d[idx + 2] = Math.max(0, bgColor[2] - avgB * clampAlpha) | 0;
      } else {
        d[idx] = Math.min(255, avgR * clampAlpha) | 0;
        d[idx + 1] = Math.min(255, avgG * clampAlpha) | 0;
        d[idx + 2] = Math.min(255, avgB * clampAlpha) | 0;
      }
      d[idx + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const iters = params.iterations ?? 500000;
    return Math.round(iters / 1000);
  },
};
