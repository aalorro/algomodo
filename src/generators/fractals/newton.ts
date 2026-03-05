import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  power: {
    name: 'Power', type: 'number', min: 2, max: 8, step: 1, default: 3,
    help: 'Degree of the polynomial z^n - 1 (determines number of roots)',
    group: 'Composition',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.5, max: 50, step: 0.5, default: 1,
    help: 'Zoom level into the fractal',
    group: 'Composition',
  },
  maxIterations: {
    name: 'Max Iterations', type: 'number', min: 16, max: 256, step: 8, default: 64,
    help: 'Maximum Newton iterations per pixel',
    group: 'Composition',
  },
  damping: {
    name: 'Damping', type: 'number', min: 0.1, max: 2, step: 0.05, default: 1,
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
  defaultParams: { power: 3, zoom: 1, maxIterations: 64, damping: 1, colorMode: 'blended', speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const colors = palette.colors.map(hexToRgb);
    const power = Math.max(2, Math.min(8, (params.power ?? 3) | 0));
    const maxIter = quality === 'draft' ? Math.max(16, (params.maxIterations ?? 64) >> 1)
                  : quality === 'ultra' ? (params.maxIterations ?? 64) * 2
                  : (params.maxIterations ?? 64);
    const colorMode = params.colorMode ?? 'blended';
    const zoom = params.zoom ?? 1;
    const step = quality === 'draft' ? 2 : 1;

    // Animate damping
    const speed = params.speed ?? 0.5;
    const baseDamping = params.damping ?? 1;
    const damping = time > 0
      ? baseDamping + 0.3 * Math.sin(time * speed * 0.5)
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
          // Compute z^n and z^(n-1) for Newton step
          // z^(n-1)
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
          r = g = b = 0;
        } else {
          const iterT = 1 - iter / maxIter; // brighter = faster convergence

          if (colorMode === 'root') {
            const c = colors[rootIdx % colors.length];
            r = c[0]; g = c[1]; b = c[2];
          } else if (colorMode === 'iteration') {
            const c = colors[Math.floor(iterT * (colors.length - 1))];
            r = c[0]; g = c[1]; b = c[2];
          } else {
            // Blended: root determines hue region, iteration modulates brightness
            const c = colors[rootIdx % colors.length];
            r = (c[0] * iterT) | 0;
            g = (c[1] * iterT) | 0;
            b = (c[2] * iterT) | 0;
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
  estimateCost(params) { return ((params.maxIterations ?? 64) * (params.power ?? 3) * 8) | 0; },
};
