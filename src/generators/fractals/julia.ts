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
  cReal: {
    name: 'C Real', type: 'number', min: -1.5, max: 1.5, step: 0.01, default: -0.7,
    help: 'Real part of the constant c',
    group: 'Composition',
  },
  cImag: {
    name: 'C Imaginary', type: 'number', min: -1.5, max: 1.5, step: 0.01, default: 0.27,
    help: 'Imaginary part of the constant c',
    group: 'Composition',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.5, max: 5, step: 0.5, default: 1,
    help: 'Zoom level into the Julia set',
    group: 'Composition',
  },
  maxIterations: {
    name: 'Max Iterations', type: 'number', min: 32, max: 256, step: 16, default: 100,
    help: 'Higher = more detail but slower',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['smooth', 'bands'], default: 'smooth',
    help: 'smooth: continuous gradient | bands: stepped contours',
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
    help: 'Speed of the c-parameter orbit animation',
    group: 'Flow/Motion',
  },
};

export const julia: Generator = {
  id: 'fractal-julia',
  family: 'fractals',
  styleName: 'Julia Set',
  definition: 'Julia sets — fix c, iterate z = z² + c from each pixel and color by escape time',
  algorithmNotes:
    'Each pixel maps to an initial z₀ in the complex plane. A fixed constant c (user-controlled or animated) ' +
    'drives the iteration z_{n+1} = z_n² + c. Unlike Mandelbrot where c varies per pixel, here c is constant ' +
    'and the initial condition z₀ varies. Animation orbits c around a circle in parameter space, smoothly ' +
    'morphing the fractal between connected and disconnected Julia sets. Smooth coloring uses renormalized ' +
    'iteration count.',
  parameterSchema,
  defaultParams: { cReal: -0.7, cImag: 0.27, zoom: 1, maxIterations: 100, colorMode: 'smooth', colorCycles: 3, bandCount: 8, speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;
    const colors = palette.colors.map(hexToRgb);
    const maxIter = quality === 'draft' ? Math.max(32, (params.maxIterations ?? 100) >> 2)
                  : quality === 'ultra' ? (params.maxIterations ?? 100) * 2
                  : (params.maxIterations ?? 100);
    const colorMode = params.colorMode ?? 'smooth';
    const colorCycles = params.colorCycles ?? 3;
    const bandCount = Math.max(2, (params.bandCount ?? 8) | 0);
    const step = quality === 'draft' ? 2 : 1;
    const zoom = params.zoom ?? 1;

    // Animate c along an orbit in parameter space
    const speed = params.speed ?? 0.5;
    const baseAngle = (seed % 360) * Math.PI / 180;
    let cr: number, ci: number;
    if (time > 0) {
      const angle = baseAngle + time * speed * 0.3;
      const radius = 0.7885; // classic Julia orbit radius
      cr = radius * Math.cos(angle);
      ci = radius * Math.sin(angle);
    } else {
      cr = params.cReal ?? -0.7;
      ci = params.cImag ?? 0.27;
    }

    const scale = 3.0 / (zoom * Math.min(w, h));
    const halfW = w * 0.5, halfH = h * 0.5;
    const escapeR = 4;
    const LOG2 = Math.log(2);

    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        let zr = (px - halfW) * scale;
        let zi = (py - halfH) * scale;

        let iter = 0;
        let zr2 = zr * zr, zi2 = zi * zi;

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
        } else {
          let v: number;
          if (colorMode === 'smooth') {
            const mag2 = zr2 + zi2;
            const smoothIter = mag2 > 1 ? iter + 1 - Math.log(Math.log(mag2) * 0.5) / LOG2 : iter;
            v = (smoothIter * colorCycles / maxIter) % 1;
            if (v < 0) v += 1;
          } else {
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
