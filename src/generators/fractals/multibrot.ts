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
  exponent: {
    name: 'Exponent', type: 'number', min: 2, max: 8, step: 0.5, default: 3,
    help: 'd in z^d + c — 2 = Mandelbrot, 3 = trefoil symmetry, higher = more lobes',
    group: 'Composition',
  },
  centerX: {
    name: 'Center X', type: 'number', min: -2, max: 2, step: 0.05, default: 0,
    group: 'Composition',
  },
  centerY: {
    name: 'Center Y', type: 'number', min: -2, max: 2, step: 0.05, default: 0,
    group: 'Composition',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.5, max: 4, step: 0.1, default: 1,
    group: 'Composition',
  },
  maxIterations: {
    name: 'Max Iterations', type: 'number', min: 16, max: 128, step: 8, default: 48,
    group: 'Composition',
  },
  colorCycles: {
    name: 'Color Cycles', type: 'number', min: 1, max: 8, step: 1, default: 3,
    group: 'Color',
  },
  interiorMode: {
    name: 'Interior', type: 'select',
    options: ['black', 'orbit-glow'],
    default: 'black',
    help: 'black: solid interior · orbit-glow: color by orbit proximity',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    group: 'Flow/Motion',
  },
};

// Zoom targets that work well across different exponents
const ZOOM_TARGETS = [
  { x: 1.0, y: 0.0 },
  { x: -0.5, y: 0.866 },
  { x: -0.5, y: -0.866 },
  { x: 0.0, y: 1.0 },
  { x: 0.7, y: 0.7 },
  { x: -1.0, y: 0.0 },
];

export const multibrot: Generator = {
  id: 'fractal-multibrot',
  family: 'fractals',
  styleName: 'Multibrot',
  definition: 'Multibrot set — generalized Mandelbrot with variable exponent z^d + c creating d-fold symmetric fractals',
  algorithmNotes:
    'Generalizes the Mandelbrot set by iterating z_{n+1} = z_n^d + c for arbitrary real exponent d. ' +
    'Uses polar form: r^d * e^(i*d*theta). When d=2, this is the standard Mandelbrot set. Higher exponents ' +
    'produce (d-1)-fold rotational symmetry. Smooth coloring uses the generalized formula: ' +
    'iter - log(log|z|) / log(d).',
  parameterSchema,
  defaultParams: {
    exponent: 3, centerX: 0, centerY: 0, zoom: 1,
    maxIterations: 48, colorCycles: 3, interiorMode: 'black', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;

    const colors = palette.colors.map(hexToRgb);
    const d = params.exponent ?? 3;
    const baseMaxIter = params.maxIterations ?? 48;
    const maxIter = quality === 'draft' ? Math.max(16, baseMaxIter >> 2)
                  : quality === 'ultra' ? Math.min(128, baseMaxIter * 2)
                  : baseMaxIter;
    const colorCycles = Math.max(1, params.colorCycles ?? 3);
    const interiorMode = (params.interiorMode ?? 'black') as string;
    const step = quality === 'draft' ? 3 : 2;
    // Fast path flag: integer exponents use repeated multiplication (no trig)
    const isIntExp = d === Math.floor(d) && d >= 2 && d <= 8;

    const zoomParam = params.zoom ?? 1;
    const target = ZOOM_TARGETS[Math.abs(seed) % ZOOM_TARGETS.length];
    let cx: number, cy: number, viewZoom: number;

    if (time > 0) {
      const speed = params.speed ?? 0.5;
      const maxAnimZoom = 60;
      const cycleDuration = Math.log(maxAnimZoom) / (Math.log(1.5) * speed);
      const cycleTime = time % cycleDuration;
      viewZoom = zoomParam * Math.pow(1.5, cycleTime * speed);
      const t = 1 - 1 / viewZoom;
      cx = (params.centerX ?? 0) + (target.x - (params.centerX ?? 0)) * t;
      cy = (params.centerY ?? 0) + (target.y - (params.centerY ?? 0)) * t;
    } else {
      cx = params.centerX ?? 0;
      cy = params.centerY ?? 0;
      viewZoom = zoomParam;
    }

    // Escape radius — keep it small for speed
    const escapeR2 = 16; // r=4
    const logD = Math.log(d);
    const logEscape = Math.log(4);

    const pixelSize = 3.0 / (viewZoom * Math.min(w, h));
    const halfW = w * 0.5, halfH = h * 0.5;

    const img = ctx.createImageData(w, h);
    const data = img.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const cReal = cx + (px - halfW) * pixelSize;
        const cImag = cy + (py - halfH) * pixelSize;

        let zr = 0, zi = 0;
        let iter = 0;
        let minOrbitDist = Infinity;
        // Periodicity checking
        let pzr = 0, pzi = 0, period = 8, pCheck = 0;

        while (iter < maxIter) {
          const r2 = zr * zr + zi * zi;
          if (r2 > escapeR2) break;

          if (r2 < minOrbitDist) minOrbitDist = r2;

          // z^d: use fast repeated multiplication for integer exponents
          if (isIntExp) {
            let wr = zr, wi = zi;
            for (let k = 1; k < d; k++) {
              const tr = wr * zr - wi * zi;
              wi = wr * zi + wi * zr;
              wr = tr;
            }
            zr = wr + cReal;
            zi = wi + cImag;
          } else {
            const r = Math.sqrt(r2);
            const theta = Math.atan2(zi, zr);
            const rd = Math.pow(r, d);
            const dTheta = d * theta;
            zr = rd * Math.cos(dTheta) + cReal;
            zi = rd * Math.sin(dTheta) + cImag;
          }
          iter++;

          // Periodicity check: if orbit returns to a saved point, it's interior
          if (Math.abs(zr - pzr) < 1e-10 && Math.abs(zi - pzi) < 1e-10) {
            iter = maxIter; break;
          }
          pCheck++;
          if (pCheck >= period) {
            pzr = zr; pzi = zi; pCheck = 0;
            if (period < 512) period <<= 1;
          }
        }

        let pr: number, pg: number, pb: number;

        if (iter >= maxIter) {
          if (interiorMode === 'orbit-glow') {
            const orbitT = Math.sqrt(minOrbitDist) * 0.4;
            const ct = Math.max(0, Math.min(1, orbitT));
            [pr, pg, pb] = paletteSample(ct, colors);
            pr = (pr * 0.3) | 0;
            pg = (pg * 0.3) | 0;
            pb = (pb * 0.3) | 0;
          } else {
            pr = pg = pb = 0;
          }
        } else {
          // Generalized smooth coloring
          const mag = Math.sqrt(zr * zr + zi * zi);
          const smoothIter = iter + 1 - Math.log(Math.log(mag) / logEscape) / logD;
          const t = ((Math.max(0, smoothIter) * colorCycles) / maxIter) % 1;
          [pr, pg, pb] = paletteSample(t, colors);
        }

        for (let sy = 0; sy < step && py + sy < h; sy++) {
          for (let sx = 0; sx < step && px + sx < w; sx++) {
            const idx = ((py + sy) * w + (px + sx)) * 4;
            data[idx] = pr; data[idx + 1] = pg; data[idx + 2] = pb; data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const iters = params.maxIterations ?? 128;
    const exp = params.exponent ?? 3;
    return Math.round(iters * exp * 2);
  },
};
