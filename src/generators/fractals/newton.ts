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
  power: {
    name: 'Power', type: 'number', min: 2, max: 6, step: 1, default: 3,
    help: 'Degree of the polynomial z^n - 1 (determines number of roots)',
    group: 'Composition',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.5, max: 4, step: 0.5, default: 1,
    help: 'Zoom level into the fractal',
    group: 'Composition',
  },
  maxIterations: {
    name: 'Max Iterations', type: 'number', min: 16, max: 64, step: 8, default: 32,
    help: 'Maximum Newton iterations per pixel',
    group: 'Composition',
  },
  damping: {
    name: 'Damping', type: 'number', min: 0.5, max: 1.5, step: 0.05, default: 1,
    help: 'Relaxation factor — 1 = standard Newton, other values create nova fractals',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['root', 'iteration', 'blended'], default: 'blended',
    help: 'root: color by converged root | iteration: shade by speed | blended: both combined',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Speed of damping animation',
    group: 'Flow/Motion',
  },
};

export const newtonFractal: Generator = {
  id: 'fractal-newton',
  family: 'fractals',
  styleName: 'Newton Fractal',
  definition: "Newton's method fractal — color by which root each pixel converges to under z^n - 1 = 0",
  algorithmNotes:
    "Applies Newton's root-finding method to the polynomial f(z) = z^n - 1. Each pixel is an initial guess z₀; " +
    'the iteration z_{k+1} = z_k - d·f(z_k)/f\'(z_k) converges to one of the n roots of unity. ' +
    'Pixels are colored by which root they converge to (basin of attraction), with brightness modulated by ' +
    'iteration count. The damping factor d alters convergence behavior — values ≠ 1 produce "nova" fractals ' +
    'with elaborate boundary patterns. Animation oscillates the damping factor.',
  parameterSchema,
  defaultParams: { power: 3, zoom: 1, maxIterations: 32, damping: 1, colorMode: 'blended', speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;
    const colors = palette.colors.map(hexToRgb);
    const power = Math.max(2, Math.min(6, (params.power ?? 3) | 0));
    const maxIter = quality === 'draft' ? Math.max(16, (params.maxIterations ?? 32) >> 1)
                  : quality === 'ultra' ? (params.maxIterations ?? 32) * 2
                  : (params.maxIterations ?? 32);
    const colorMode = params.colorMode ?? 'blended';
    const zoom = params.zoom ?? 1;
    const step = quality === 'draft' ? 2 : 1;

    // Animate damping
    const speed = params.speed ?? 0.5;
    const baseDamping = params.damping ?? 1;
    const damping = time > 0
      ? baseDamping + 0.15 * Math.sin(time * speed * 0.5)
      : baseDamping;

    // Precompute roots of unity: z^n = 1
    const roots: [number, number][] = [];
    for (let k = 0; k < power; k++) {
      const angle = (2 * Math.PI * k) / power;
      roots.push([Math.cos(angle), Math.sin(angle)]);
    }

    const scale = 3.0 / (zoom * Math.min(w, h));
    const halfW = w * 0.5, halfH = h * 0.5;
    const tolerance = 1e-6;

    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        let zr = (px - halfW) * scale;
        let zi = (py - halfH) * scale;

        let iter = 0;
        let rootIdx = -1;

        for (; iter < maxIter; iter++) {
          // Compute z^(n-1) by repeated squaring
          let pnm1r = 1, pnm1i = 0;
          for (let k = 0; k < power - 1; k++) {
            const tr = pnm1r * zr - pnm1i * zi;
            const ti = pnm1r * zi + pnm1i * zr;
            pnm1r = tr; pnm1i = ti;
          }
          // z^n = z^(n-1) * z
          const pnr = pnm1r * zr - pnm1i * zi;
          const pni = pnm1r * zi + pnm1i * zr;

          // f(z) = z^n - 1
          const fr = pnr - 1;
          const fi = pni;

          // f'(z) = n * z^(n-1)
          const fpr = power * pnm1r;
          const fpi = power * pnm1i;

          // f(z) / f'(z) — complex division
          const denom = fpr * fpr + fpi * fpi;
          if (denom < 1e-20) break;
          const qr = (fr * fpr + fi * fpi) / denom;
          const qi = (fi * fpr - fr * fpi) / denom;

          // z = z - damping * (f/f')
          zr -= damping * qr;
          zi -= damping * qi;

          // Bail out if z diverges
          if (zr * zr + zi * zi > 1e10) break;

          // Check convergence to a root
          for (let k = 0; k < power; k++) {
            const dr = zr - roots[k][0];
            const di = zi - roots[k][1];
            if (dr * dr + di * di < tolerance) {
              rootIdx = k;
              break;
            }
          }
          if (rootIdx >= 0) break;
        }

        let r: number, g: number, b: number;

        if (rootIdx < 0) {
          // Non-convergent — dark background
          r = g = b = 10;
        } else {
          const iterT = 1 - iter / maxIter; // brighter = faster convergence
          const shade = 0.3 + 0.7 * iterT; // never fully black

          if (colorMode === 'root') {
            const c = colors[rootIdx % colors.length];
            r = c[0]; g = c[1]; b = c[2];
          } else if (colorMode === 'iteration') {
            [r, g, b] = paletteSample(iterT, colors);
          } else {
            // Blended: root determines color, iteration modulates brightness
            const c = colors[rootIdx % colors.length];
            r = (c[0] * shade) | 0;
            g = (c[1] * shade) | 0;
            b = (c[2] * shade) | 0;
          }
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
  estimateCost(params) { return ((params.maxIterations ?? 32) * (params.power ?? 3) * 8) | 0; },
};
