import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  variant: {
    name: 'Variant', type: 'select',
    options: ['mandelbrot', 'julia', 'burning-ship', 'tricorn'],
    default: 'mandelbrot',
    help: 'mandelbrot: classic z²+c · julia: fixed c, varying z₀ · burning-ship: |Re|,|Im| variant · tricorn: conjugate variant',
    group: 'Composition',
  },
  centerX: {
    name: 'Center X', type: 'number', min: -2, max: 2, step: 0.05, default: -0.5,
    help: 'Real-axis center of the view',
    group: 'Composition',
  },
  centerY: {
    name: 'Center Y', type: 'number', min: -2, max: 2, step: 0.05, default: 0,
    help: 'Imaginary-axis center of the view',
    group: 'Composition',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.5, max: 4, step: 0.5, default: 1,
    help: 'Zoom level — higher values zoom deeper into the fractal',
    group: 'Composition',
  },
  maxIterations: {
    name: 'Max Iterations', type: 'number', min: 16, max: 128, step: 8, default: 48,
    help: 'Higher = more detail in boundary regions but slower',
    group: 'Composition',
  },
  colorCycles: {
    name: 'Color Cycles', type: 'number', min: 1, max: 8, step: 1, default: 3,
    help: 'How many times the palette repeats across the iteration range',
    group: 'Color',
  },
  interiorColor: {
    name: 'Interior', type: 'select',
    options: ['black', 'orbit-glow', 'distance-hue'],
    default: 'black',
    help: 'black: classic solid · orbit-glow: color by orbit magnitude · distance-hue: color by final distance',
    group: 'Color',
  },
  edgeGlow: {
    name: 'Edge Glow', type: 'number', min: 0, max: 1, step: 0.1, default: 0.3,
    help: 'Highlight fractal boundary edges with a luminous glow',
    group: 'Texture',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation zoom speed',
    group: 'Flow/Motion',
  },
};

// Interesting zoom targets per variant
const ZOOM_TARGETS: Record<string, Array<{ x: number; y: number }>> = {
  mandelbrot: [
    { x: -0.7435669, y: 0.1314023 },
    { x: -0.1011, y: 0.9563 },
    { x: -1.2500, y: 0.0000 },
    { x: -0.16, y: 1.0405 },
    { x: -0.7463, y: 0.1102 },
    { x: -0.0452, y: 0.9868 },
  ],
  julia: [
    { x: 0, y: 0 },
    { x: -0.3, y: 0.5 },
    { x: 0.35, y: -0.35 },
  ],
  'burning-ship': [
    { x: -1.755, y: -0.028 },
    { x: -1.7612, y: -0.0284 },
    { x: -0.515, y: -0.515 },
  ],
  tricorn: [
    { x: -0.4, y: 0.6 },
    { x: -1.0, y: 0.3 },
    { x: 0.3, y: -0.5 },
  ],
};

// Julia set c-values for interesting shapes (selected by seed)
const JULIA_C = [
  { cr: -0.7269, ci: 0.1889 },
  { cr: -0.8, ci: 0.156 },
  { cr: 0.285, ci: 0.01 },
  { cr: -0.4, ci: 0.6 },
  { cr: 0.355, ci: 0.355 },
  { cr: -0.54, ci: 0.54 },
];

export const mandelbrot: Generator = {
  id: 'fractal-mandelbrot',
  family: 'fractals',
  styleName: 'Mandelbrot Set',
  definition: 'The classic Mandelbrot set and variants — iterate z = z² + c and color by smooth escape time',
  algorithmNotes:
    'For each pixel mapped to a point c in the complex plane, iterates z_{n+1} = z_n² + c starting from z_0 = 0. ' +
    'Uses smooth iteration count (log₂ log₂ |z|) for continuous gradient coloring. Supports four variants: ' +
    'classic Mandelbrot, Julia (fixed c), Burning Ship (absolute value), and Tricorn (conjugate). ' +
    'Distance estimation provides edge glow, and orbit analysis colors the interior.',
  parameterSchema,
  defaultParams: {
    variant: 'mandelbrot', centerX: -0.5, centerY: 0, zoom: 1,
    maxIterations: 48, colorCycles: 3, interiorColor: 'black',
    edgeGlow: 0.3, speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;

    const colors = palette.colors.map(hexToRgb);
    const nColors = colors.length;
    const variant = (params.variant ?? 'mandelbrot') as string;
    const baseMaxIter = params.maxIterations ?? 128;
    const maxIter = quality === 'draft' ? Math.max(32, baseMaxIter >> 2)
                  : quality === 'ultra' ? baseMaxIter * 2
                  : baseMaxIter;
    const colorCycles = Math.max(1, params.colorCycles ?? 3);
    const interiorColor = (params.interiorColor ?? 'black') as string;
    const edgeGlow = params.edgeGlow ?? 0.3;
    const step = quality === 'draft' ? 2 : 1;

    // Julia c-value from seed
    const juliaC = JULIA_C[Math.abs(seed) % JULIA_C.length];

    // View center — for animation, zoom toward an interesting target
    const zoomParam = params.zoom ?? 1;
    const targets = ZOOM_TARGETS[variant] || ZOOM_TARGETS.mandelbrot;
    let cx: number, cy: number, viewZoom: number;

    if (time > 0) {
      const target = targets[Math.abs(seed) % targets.length];
      const speed = params.speed ?? 0.5;
      const maxAnimZoom = 80;
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

    // Adjust default center for variants
    if (time === 0 && variant === 'burning-ship' && params.centerX === -0.5) {
      cx = -0.4; cy = -0.6;
    } else if (time === 0 && variant === 'julia' && params.centerX === -0.5) {
      cx = 0; cy = 0;
    }

    const pixelSize = 3.0 / (viewZoom * Math.min(w, h));
    const halfW = w * 0.5, halfH = h * 0.5;

    const LOG2 = Math.log(2);
    const BAILOUT = 256; // Higher bailout for smoother coloring
    const BAILOUT_SQ = BAILOUT * BAILOUT;

    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const pReal = cx + (px - halfW) * pixelSize;
        const pImag = cy + (py - halfH) * pixelSize;

        let zr: number, zi: number, cReal: number, cImag: number;

        if (variant === 'julia') {
          zr = pReal; zi = pImag;
          cReal = juliaC.cr; cImag = juliaC.ci;
        } else {
          zr = 0; zi = 0;
          cReal = pReal; cImag = pImag;
        }

        let zr2 = zr * zr, zi2 = zi * zi;
        let iter = 0;
        let minOrbitDist = Infinity;
        // Track derivative for distance estimation (edge glow)
        let dzr = 1, dzi = 0;

        while (zr2 + zi2 <= BAILOUT_SQ && iter < maxIter) {
          // Track minimum orbit distance to origin (for interior coloring)
          const orbitDist = zr2 + zi2;
          if (orbitDist < minOrbitDist) minOrbitDist = orbitDist;

          // Distance estimation derivative: dz = 2*z*dz + 1
          if (edgeGlow > 0) {
            const newDzr = 2 * (zr * dzr - zi * dzi) + 1;
            const newDzi = 2 * (zr * dzi + zi * dzr);
            dzr = newDzr; dzi = newDzi;
          }

          if (variant === 'burning-ship') {
            zr = Math.abs(zr); zi = Math.abs(zi);
            const newZr = zr2 - zi2 + cReal;
            zi = 2 * zr * zi + cImag;
            zr = newZr;
          } else if (variant === 'tricorn') {
            // Conjugate: use -zi
            const newZr = zr2 - zi2 + cReal;
            zi = -2 * zr * zi + cImag;
            zr = newZr;
          } else {
            // Standard Mandelbrot / Julia
            const newZr = zr2 - zi2 + cReal;
            zi = 2 * zr * zi + cImag;
            zr = newZr;
          }

          zr2 = zr * zr;
          zi2 = zi * zi;
          iter++;
        }

        let r: number, g: number, b: number;

        if (iter >= maxIter) {
          // Inside the set — apply interior coloring
          if (interiorColor === 'orbit-glow') {
            const orbitT = Math.sqrt(minOrbitDist) * 0.5;
            const ct = Math.max(0, Math.min(1, orbitT));
            [r, g, b] = interpolateColor(colors, nColors, ct);
            // Dim the interior
            r = (r * 0.35) | 0;
            g = (g * 0.35) | 0;
            b = (b * 0.35) | 0;
          } else if (interiorColor === 'distance-hue') {
            const finalDist = Math.sqrt(zr2 + zi2);
            const ct = (finalDist * 0.3) % 1;
            [r, g, b] = interpolateColor(colors, nColors, ct);
            r = (r * 0.25) | 0;
            g = (g * 0.25) | 0;
            b = (b * 0.25) | 0;
          } else {
            r = g = b = 0;
          }
        } else {
          // Escaped — smooth iteration count for continuous coloring
          const mag = Math.sqrt(zr2 + zi2);
          const smoothIter = iter + 1 - Math.log(Math.log(mag)) / LOG2;
          const t = ((smoothIter * colorCycles) / maxIter) % 1;
          [r, g, b] = interpolateColor(colors, nColors, Math.max(0, t));

          // Distance estimation edge glow
          if (edgeGlow > 0) {
            const dzMag = Math.sqrt(dzr * dzr + dzi * dzi);
            if (dzMag > 0) {
              const dist = mag * Math.log(mag) / dzMag;
              const edgeT = Math.exp(-dist * viewZoom * 0.5);
              if (edgeT > 0.01) {
                const glow = edgeT * edgeGlow;
                r = Math.min(255, r + (255 - r) * glow) | 0;
                g = Math.min(255, g + (255 - g) * glow) | 0;
                b = Math.min(255, b + (255 - b) * glow) | 0;
              }
            }
          }
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
  estimateCost(params) { return ((params.maxIterations ?? 128) * 4) | 0; },
};

function interpolateColor(
  colors: [number, number, number][], nColors: number, t: number,
): [number, number, number] {
  const s = t * (nColors - 1);
  const i0 = Math.floor(s);
  const i1 = Math.min(nColors - 1, i0 + 1);
  const f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}
