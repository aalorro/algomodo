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

// Distance from point (zr, zi) to trap shape
function trapDistance(zr: number, zi: number, shape: string, size: number): number {
  switch (shape) {
    case 'point':
      return Math.sqrt(zr * zr + zi * zi);
    case 'circle':
      return Math.abs(Math.sqrt(zr * zr + zi * zi) - size);
    case 'cross':
      return Math.min(Math.abs(zr), Math.abs(zi));
    case 'ring': {
      const r = Math.sqrt(zr * zr + zi * zi);
      const band = Math.abs(r - size);
      return band;
    }
    case 'square':
      return Math.abs(Math.max(Math.abs(zr), Math.abs(zi)) - size);
    default:
      return Math.sqrt(zr * zr + zi * zi);
  }
}

const parameterSchema: ParameterSchema = {
  trapShape: {
    name: 'Trap Shape', type: 'select',
    options: ['point', 'circle', 'cross', 'ring', 'square'],
    default: 'circle',
    help: 'Geometric shape used as the orbit trap',
    group: 'Composition',
  },
  trapSize: {
    name: 'Trap Size', type: 'number', min: 0.1, max: 2, step: 0.05, default: 0.5,
    help: 'Size of the trap shape (radius for circle/ring, half-side for square)',
    group: 'Geometry',
  },
  centerX: {
    name: 'Center X', type: 'number', min: -2, max: 2, step: 0.05, default: -0.5,
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
    name: 'Max Iterations', type: 'number', min: 32, max: 512, step: 16, default: 128,
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['distance', 'angle', 'iteration', 'composite'],
    default: 'distance',
    help: 'distance: min trap distance · angle: angle at closest approach · iteration: which iteration · composite: blend',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation speed — morphs trap size and rotates trap',
    group: 'Flow/Motion',
  },
};

const ZOOM_TARGETS = [
  { x: -0.7435669, y: 0.1314023 },
  { x: -0.1011, y: 0.9563 },
  { x: -1.25, y: 0 },
  { x: -0.16, y: 1.0405 },
  { x: 0.285, y: 0.01 },
  { x: -0.745, y: 0.113 },
];

export const orbitTraps: Generator = {
  id: 'fractal-orbit-traps',
  family: 'fractals',
  styleName: 'Orbit Traps',
  definition: 'Orbit trap fractal — Mandelbrot iteration colored by proximity of orbit points to geometric trap shapes',
  algorithmNotes:
    'Runs standard Mandelbrot iteration but instead of coloring by escape time, colors by the minimum ' +
    'distance from any orbit point z_n to a geometric "trap" shape (point, circle, cross, ring, or square). ' +
    'Multiple color modes: distance (direct mapping), angle (direction at closest approach), iteration ' +
    '(which step hit the trap), and composite (blend of all three). Produces organic, layered imagery ' +
    'distinct from standard escape-time coloring.',
  parameterSchema,
  defaultParams: {
    trapShape: 'circle', trapSize: 0.5, centerX: -0.5, centerY: 0, zoom: 1,
    maxIterations: 128, colorMode: 'distance', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;

    const colors = palette.colors.map(hexToRgb);
    const trapShape = (params.trapShape ?? 'circle') as string;
    let trapSize = params.trapSize ?? 0.5;
    const colorMode = (params.colorMode ?? 'distance') as string;
    const baseMaxIter = params.maxIterations ?? 128;
    const maxIter = quality === 'draft' ? Math.max(32, baseMaxIter >> 2)
                  : quality === 'ultra' ? baseMaxIter * 2
                  : baseMaxIter;
    const step = quality === 'draft' ? 2 : 1;

    const zoomParam = params.zoom ?? 1;
    const target = ZOOM_TARGETS[Math.abs(seed) % ZOOM_TARGETS.length];
    let cx: number, cy: number, viewZoom: number;

    // Animate trap size oscillation
    const speed = params.speed ?? 0.5;
    if (time > 0) {
      trapSize += Math.sin(time * speed * 0.5) * 0.15;
      const maxAnimZoom = 60;
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

    // Trap rotation for animation
    const trapRotation = time > 0 ? time * speed * 0.3 : 0;
    const cosRot = Math.cos(trapRotation), sinRot = Math.sin(trapRotation);

    const pixelSize = 3.0 / (viewZoom * Math.min(w, h));
    const halfW = w * 0.5, halfH = h * 0.5;
    const BAILOUT_SQ = 256 * 256;

    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const cReal = cx + (px - halfW) * pixelSize;
        const cImag = cy + (py - halfH) * pixelSize;

        let zr = 0, zi = 0;
        let iter = 0;
        let minDist = Infinity;
        let minAngle = 0;
        let minIter = 0;
        let minZr = 0, minZi = 0;

        while (zr * zr + zi * zi <= BAILOUT_SQ && iter < maxIter) {
          // Rotate orbit point for trap evaluation
          const rZr = zr * cosRot - zi * sinRot;
          const rZi = zr * sinRot + zi * cosRot;

          const dist = trapDistance(rZr, rZi, trapShape, trapSize);
          if (dist < minDist) {
            minDist = dist;
            minAngle = Math.atan2(rZi, rZr);
            minIter = iter;
            minZr = rZr;
            minZi = rZi;
          }

          // Standard Mandelbrot iteration
          const newZr = zr * zr - zi * zi + cReal;
          zi = 2 * zr * zi + cImag;
          zr = newZr;
          iter++;
        }

        let r: number, g: number, b: number;

        // Clamp min distance for color mapping
        const distT = Math.min(1, minDist / (trapSize * 2 + 0.5));
        const angleT = ((minAngle / Math.PI) + 1) * 0.5 % 1;
        const iterT = minIter / maxIter;

        if (colorMode === 'distance') {
          [r, g, b] = paletteSample(distT, colors);
        } else if (colorMode === 'angle') {
          [r, g, b] = paletteSample(angleT, colors);
          // Modulate brightness by distance (closer = brighter)
          const bright = 1 - distT * 0.6;
          r = (r * bright) | 0;
          g = (g * bright) | 0;
          b = (b * bright) | 0;
        } else if (colorMode === 'iteration') {
          [r, g, b] = paletteSample(iterT, colors);
          const bright = 1 - distT * 0.5;
          r = (r * bright) | 0;
          g = (g * bright) | 0;
          b = (b * bright) | 0;
        } else {
          // Composite: blend distance, angle, and iteration
          const [dr, dg, db] = paletteSample(distT, colors);
          const [ar, ag, ab] = paletteSample(angleT, colors);
          const [ir, ig, ib] = paletteSample(iterT, colors);
          r = ((dr * 0.4 + ar * 0.35 + ir * 0.25)) | 0;
          g = ((dg * 0.4 + ag * 0.35 + ig * 0.25)) | 0;
          b = ((db * 0.4 + ab * 0.35 + ib * 0.25)) | 0;
        }

        // Darken escaped pixels slightly by distance
        if (iter >= maxIter) {
          r = (r * 0.3) | 0;
          g = (g * 0.3) | 0;
          b = (b * 0.3) | 0;
        }

        // Add subtle highlight where orbit was very close to trap
        if (minDist < 0.02) {
          const glow = (0.02 - minDist) / 0.02;
          r = Math.min(255, r + (255 - r) * glow * 0.5) | 0;
          g = Math.min(255, g + (255 - g) * glow * 0.5) | 0;
          b = Math.min(255, b + (255 - b) * glow * 0.5) | 0;
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
  estimateCost(params) { return ((params.maxIterations ?? 128) * 5) | 0; },
};
