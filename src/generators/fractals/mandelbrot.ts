import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  centerX: {
    name: 'Center X', type: 'number', min: -1.5, max: 0.5, step: 0.05, default: -0.5,
    help: 'Real-axis center of the view',
    group: 'Composition',
  },
  centerY: {
    name: 'Center Y', type: 'number', min: -1, max: 1, step: 0.05, default: 0,
    help: 'Imaginary-axis center of the view',
    group: 'Composition',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.5, max: 4, step: 0.5, default: 1,
    help: 'Zoom level — higher values zoom deeper into the fractal',
    group: 'Composition',
  },
  maxIterations: {
    name: 'Max Iterations', type: 'number', min: 32, max: 256, step: 16, default: 100,
    help: 'Higher = more detail in boundary regions but slower',
    group: 'Composition',
  },
  colorCycles: {
    name: 'Color Cycles', type: 'number', min: 1, max: 8, step: 1, default: 3,
    help: 'How many times the palette repeats across the iteration range',
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
  { x: -0.7435669, y: 0.1314023 },
  { x: -0.1011, y: 0.9563 },
  { x: -1.2500, y: 0.0000 },
  { x: -0.16, y: 1.0405 },
];

export const mandelbrot: Generator = {
  id: 'fractal-mandelbrot',
  family: 'fractals',
  styleName: 'Mandelbrot Set',
  definition: 'The classic Mandelbrot set — iterate z = z² + c and color by escape time',
  algorithmNotes:
    'For each pixel mapped to a point c in the complex plane, iterates z_{n+1} = z_n² + c starting from z_0 = 0. ' +
    'If |z| exceeds 2 the point is outside the set and colored by iteration count with palette cycling. ' +
    'Animation zooms toward an interesting boundary region selected by the seed.',
  parameterSchema,
  defaultParams: { centerX: -0.5, centerY: 0, zoom: 1, maxIterations: 100, colorCycles: 3, speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;

    const colors = palette.colors.map(hexToRgb);
    const maxIter = quality === 'draft' ? Math.max(32, (params.maxIterations ?? 100) >> 2)
                  : quality === 'ultra' ? (params.maxIterations ?? 100) * 2
                  : (params.maxIterations ?? 100);
    const colorCycles = Math.max(1, params.colorCycles ?? 3);
    const step = quality === 'draft' ? 2 : 1;

    // View center — for animation, cycle zoom toward an interesting target
    const zoomParam = params.zoom ?? 1;
    let cx: number, cy: number, viewZoom: number;
    if (time > 0) {
      const target = ZOOM_TARGETS[Math.abs(seed) % ZOOM_TARGETS.length];
      const speed = params.speed ?? 0.5;
      const maxAnimZoom = 50;
      const cycleDuration = Math.log(maxAnimZoom) / (Math.log(1.5) * speed);
      const cycleTime = time % cycleDuration;
      viewZoom = zoomParam * Math.pow(1.5, cycleTime * speed);
      const t = 1 - 1 / viewZoom;
      cx = (params.centerX ?? -0.5) + (target.x - (params.centerX ?? -0.5)) * t;
      cy = (params.centerY ?? 0) + (target.y - (params.centerY ?? 0)) * t;
    } else {
      cx = params.centerX ?? -0.5;
      cy = params.centerY ?? 0;
      viewZoom = zoomParam;
    }

    const pixelSize = 3.0 / (viewZoom * Math.min(w, h));
    const halfW = w * 0.5, halfH = h * 0.5;

    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const cReal = cx + (px - halfW) * pixelSize;
        const cImag = cy + (py - halfH) * pixelSize;

        let zr = 0, zi = 0, zr2 = 0, zi2 = 0;
        let iter = 0;

        while (zr2 + zi2 <= 4 && iter < maxIter) {
          zi = 2 * zr * zi + cImag;
          zr = zr2 - zi2 + cReal;
          zr2 = zr * zr;
          zi2 = zi * zi;
          iter++;
        }

        let r: number, g: number, b: number;

        if (iter >= maxIter) {
          // Inside the set
          r = g = b = 0;
        } else {
          // Escaped — color by iteration with palette cycling
          const t = (iter * colorCycles / maxIter) % 1;
          const s = t * (colors.length - 1);
          const i0 = Math.floor(s);
          const i1 = Math.min(colors.length - 1, i0 + 1);
          const f = s - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        }

        for (let sy = 0; sy < step && py + sy < h; sy++) {
          for (let sx = 0; sx < step && px + sx < w; sx++) {
            const idx = ((py + sy) * w + (px + sx)) * 4;
            d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.maxIterations ?? 100) * 4) | 0; },
};
