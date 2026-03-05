import type { Generator, ParameterSchema } from '../../types';

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

const parameterSchema: ParameterSchema = {
  centerX: {
    name: 'Center X', type: 'number', min: -2, max: 1, step: 0.01, default: -0.5,
    help: 'Real-axis center of the view',
    group: 'Composition',
  },
  centerY: {
    name: 'Center Y', type: 'number', min: -1.5, max: 1.5, step: 0.01, default: 0,
    help: 'Imaginary-axis center of the view',
    group: 'Composition',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.5, max: 50, step: 0.5, default: 1,
    help: 'Zoom level — higher values zoom deeper into the fractal',
    group: 'Composition',
  },
  maxIterations: {
    name: 'Max Iterations', type: 'number', min: 32, max: 512, step: 16, default: 128,
    help: 'Higher = more detail in boundary regions but slower',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['smooth', 'bands', 'binary'], default: 'smooth',
    help: 'smooth: continuous gradient | bands: stepped contours | binary: inside/outside only',
    group: 'Color',
  },
  colorCycles: {
    name: 'Color Cycles', type: 'number', min: 1, max: 10, step: 1, default: 3,
    help: 'How many times the palette repeats across the iteration range',
    group: 'Color',
  },
  bandCount: {
    name: 'Band Count', type: 'number', min: 2, max: 24, step: 1, default: 8,
    help: 'Number of color bands (bands mode only)',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation zoom speed',
    group: 'Flow/Motion',
  },
};

// Interesting locations to zoom into
const ZOOM_TARGETS = [
  { x: -0.7435669, y: 0.1314023 },   // Elephant valley
  { x: -0.1011, y: 0.9563 },          // Seahorse valley
  { x: -1.2500, y: 0.0000 },          // Main cardioid cusp
  { x: -0.16, y: 1.0405 },            // Spiral arm
];

export const mandelbrot: Generator = {
  id: 'fractal-mandelbrot',
  family: 'fractals',
  styleName: 'Mandelbrot Set',
  definition: 'The classic Mandelbrot set — iterate z = z² + c and color by escape time',
  algorithmNotes:
    'For each pixel mapped to a point c in the complex plane, iterates z_{n+1} = z_n² + c starting from z_0 = 0. ' +
    'If |z| exceeds 2 (escape radius), the point is outside the set and colored by iteration count. ' +
    'Smooth coloring uses the renormalized iteration count: n - log2(log2(|z|)) to eliminate banding. ' +
    'Animation zooms toward an interesting boundary region selected by the seed.',
  parameterSchema,
  defaultParams: { centerX: -0.5, centerY: 0, zoom: 1, maxIterations: 128, colorMode: 'smooth', colorCycles: 3, bandCount: 8, speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const colors = palette.colors.map(hexToRgb);
    const maxIter = quality === 'draft' ? Math.max(32, (params.maxIterations ?? 128) >> 2)
                  : quality === 'ultra' ? (params.maxIterations ?? 128) * 2
                  : (params.maxIterations ?? 128);
    const colorMode = params.colorMode ?? 'smooth';
    const colorCycles = params.colorCycles ?? 3;
    const bandCount = Math.max(2, (params.bandCount ?? 8) | 0);
    const step = quality === 'draft' ? 2 : 1;

    // Animated zoom: pick a target based on seed, zoom in over time
    const target = ZOOM_TARGETS[seed % ZOOM_TARGETS.length];
    const speed = params.speed ?? 0.5;
    const animZoom = time > 0 ? (params.zoom ?? 1) * Math.pow(1.5, time * speed) : (params.zoom ?? 1);
    const cx = time > 0 ? params.centerX + (target.x - params.centerX) * (1 - 1 / animZoom) : (params.centerX ?? -0.5);
    const cy = time > 0 ? params.centerY + (target.y - params.centerY) * (1 - 1 / animZoom) : (params.centerY ?? 0);

    const scale = 3.0 / (animZoom * Math.min(w, h));
    const halfW = w * 0.5, halfH = h * 0.5;
    const escapeR = 4; // standard escape radius |z| > 2
    const LOG2 = Math.log(2);

    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const cr = cx + (px - halfW) * scale;
        const ci = cy + (py - halfH) * scale;

        let zr = 0, zi = 0;
        let iter = 0;
        let zr2 = 0, zi2 = 0;

        while (zr2 + zi2 <= escapeR && iter < maxIter) {
          zi = 2 * zr * zi + ci;
          zr = zr2 - zi2 + cr;
          zr2 = zr * zr;
          zi2 = zi * zi;
          iter++;
        }

        let r: number, g: number, b: number;

        if (iter >= maxIter) {
          r = g = b = 0;
        } else if (colorMode === 'binary') {
          const c0 = colors[0];
          r = c0[0]; g = c0[1]; b = c0[2];
        } else {
          let v: number;
          if (colorMode === 'smooth') {
            // Smooth coloring: renormalized iteration count with palette cycling
            const mag2 = zr2 + zi2;
            const smoothIter = mag2 > 1 ? iter + 1 - Math.log(Math.log(mag2) * 0.5) / LOG2 : iter;
            v = (smoothIter * colorCycles / maxIter) % 1;
            if (v < 0) v += 1;
          } else {
            // Bands
            v = Math.floor((iter / maxIter) * bandCount) / bandCount;
          }
          [r, g, b] = paletteSample(v, colors);
        }

        for (let sy = 0; sy < step && py + sy < h; sy++) {
          for (let sx = 0; sx < step && px + sx < w; sx++) {
            const i = ((py + sy) * w + (px + sx)) * 4;
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.maxIterations ?? 128) * 4) | 0; },
};
