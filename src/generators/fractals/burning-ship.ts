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
    name: 'Center X', type: 'number', min: -2, max: 2, step: 0.05, default: -1.7,
    help: 'Real-axis center of the view',
    group: 'Composition',
  },
  centerY: {
    name: 'Center Y', type: 'number', min: -2, max: 2, step: 0.05, default: -0.03,
    help: 'Imaginary-axis center of the view',
    group: 'Composition',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.3, max: 4, step: 0.1, default: 0.5,
    help: 'Zoom level — higher values zoom deeper',
    group: 'Composition',
  },
  maxIterations: {
    name: 'Max Iterations', type: 'number', min: 16, max: 128, step: 8, default: 48,
    help: 'Higher = more detail but slower',
    group: 'Composition',
  },
  colorCycles: {
    name: 'Color Cycles', type: 'number', min: 1, max: 10, step: 1, default: 4,
    help: 'How many times the palette repeats',
    group: 'Color',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['smooth', 'bands', 'distance'],
    default: 'smooth',
    help: 'smooth: continuous gradient · bands: discrete steps · distance: boundary estimation',
    group: 'Color',
  },
  invert: {
    name: 'Invert', type: 'boolean', default: false,
    help: 'Flip palette direction',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation zoom speed',
    group: 'Flow/Motion',
  },
};

// Ship-specific zoom targets: antenna, mast, mini-ships, hull detail
const ZOOM_TARGETS = [
  { x: -1.755, y: -0.028 },   // main antenna
  { x: -1.7612, y: -0.0284 }, // antenna tip detail
  { x: -0.515, y: -0.515 },   // mini-ship in hull
  { x: -1.786, y: -0.0 },     // left mast
  { x: -1.862, y: 0.0 },      // far left
  { x: -1.258, y: -0.382 },   // side decoration
  { x: -0.593, y: -1.045 },   // keel structure
  { x: -1.478, y: -0.01 },    // mid-hull
];

export const burningShip: Generator = {
  id: 'fractal-burning-ship',
  family: 'fractals',
  styleName: 'Burning Ship',
  definition: 'The Burning Ship fractal — z = (|Re(z)| + i|Im(z)|)² + c with ship-shaped structures and asymmetric detail',
  algorithmNotes:
    'Iterates z_{n+1} = (|Re(z_n)| + i|Im(z_n)|)² + c. The absolute value operation breaks symmetry, ' +
    'creating ship-like structures with masts, hulls, and antenna formations. Supports smooth escape-time ' +
    'coloring, discrete bands, and distance estimation for boundary highlighting. The fractal is rendered ' +
    'flipped vertically to show the canonical "ship" orientation.',
  parameterSchema,
  defaultParams: {
    centerX: -1.7, centerY: -0.03, zoom: 0.5, maxIterations: 48,
    colorCycles: 4, colorMode: 'smooth', invert: false, speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;

    const colors = palette.colors.map(hexToRgb);
    const baseMaxIter = params.maxIterations ?? 48;
    const maxIter = quality === 'draft' ? Math.max(16, baseMaxIter >> 2)
                  : quality === 'ultra' ? Math.min(128, baseMaxIter * 2)
                  : baseMaxIter;
    const colorCycles = Math.max(1, params.colorCycles ?? 4);
    const colorMode = (params.colorMode ?? 'smooth') as string;
    const invertPalette = params.invert ?? false;
    const step = quality === 'draft' ? 3 : 2;

    const zoomParam = params.zoom ?? 0.5;
    const target = ZOOM_TARGETS[Math.abs(seed) % ZOOM_TARGETS.length];
    let cx: number, cy: number, viewZoom: number;

    if (time > 0) {
      const speed = params.speed ?? 0.5;
      const maxAnimZoom = 100;
      const cycleDuration = Math.log(maxAnimZoom) / (Math.log(1.5) * speed);
      const cycleTime = time % cycleDuration;
      viewZoom = zoomParam * Math.pow(1.5, cycleTime * speed);
      const t = 1 - 1 / viewZoom;
      cx = (params.centerX ?? -1.7) + (target.x - (params.centerX ?? -1.7)) * t;
      cy = (params.centerY ?? -0.03) + (target.y - (params.centerY ?? -0.03)) * t;
    } else {
      cx = params.centerX ?? -1.7;
      cy = params.centerY ?? -0.03;
      viewZoom = zoomParam;
    }

    const pixelSize = 3.0 / (viewZoom * Math.min(w, h));
    const halfW = w * 0.5, halfH = h * 0.5;
    const LOG2 = Math.log(2);
    const BAILOUT_SQ = 16; // bailout r=4, much cheaper than 256²

    const img = ctx.createImageData(w, h);
    const d = img.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const cReal = cx + (px - halfW) * pixelSize;
        // Flip Y for canonical ship orientation
        const cImag = cy - (py - halfH) * pixelSize;

        let zr = 0, zi = 0;
        let zr2 = 0, zi2 = 0;
        let iter = 0;
        let minOrbitDist = Infinity;
        // Distance estimation derivative
        let dzr = 0, dzi = 0;
        const trackDist = colorMode === 'distance';
        // Periodicity checking — detect cycles to skip interior pixels early
        let pzr = 0, pzi = 0, period = 8, pCheck = 0;

        while (zr2 + zi2 <= BAILOUT_SQ && iter < maxIter) {
          const orbitDist = zr2 + zi2;
          if (orbitDist < minOrbitDist) minOrbitDist = orbitDist;

          if (trackDist) {
            const newDzr = 2 * (Math.abs(zr) * dzr - Math.abs(zi) * dzi) + 1;
            const newDzi = 2 * (Math.abs(zr) * dzi + Math.abs(zi) * dzr);
            dzr = newDzr; dzi = newDzi;
          }

          // Burning Ship: take abs before squaring
          const azr = Math.abs(zr), azi = Math.abs(zi);
          zr = azr * azr - azi * azi + cReal;
          zi = 2 * azr * azi + cImag;
          zr2 = zr * zr;
          zi2 = zi * zi;
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

        let r: number, g: number, b: number;

        if (iter >= maxIter) {
          // Interior — subtle orbit-based glow
          const orbitT = Math.sqrt(minOrbitDist) * 0.4;
          const ct = Math.max(0, Math.min(1, invertPalette ? 1 - orbitT : orbitT));
          [r, g, b] = paletteSample(ct, colors);
          r = (r * 0.2) | 0;
          g = (g * 0.2) | 0;
          b = (b * 0.2) | 0;
        } else {
          const mag = Math.sqrt(zr2 + zi2);
          const smoothIter = iter + 1 - Math.log(Math.log(mag)) / LOG2;

          let t: number;
          if (colorMode === 'bands') {
            t = ((iter * colorCycles) / maxIter) % 1;
          } else {
            t = ((smoothIter * colorCycles) / maxIter) % 1;
          }

          if (invertPalette) t = 1 - t;
          [r, g, b] = paletteSample(Math.max(0, t), colors);

          // Distance estimation overlay for 'distance' mode
          if (trackDist) {
            const dzMag = Math.sqrt(dzr * dzr + dzi * dzi);
            if (dzMag > 0) {
              const dist = mag * Math.log(mag) / dzMag;
              const edgeT = Math.exp(-dist * viewZoom * 0.8);
              if (edgeT > 0.01) {
                r = Math.min(255, r + (255 - r) * edgeT) | 0;
                g = Math.min(255, g + (255 - g) * edgeT) | 0;
                b = Math.min(255, b + (255 - b) * edgeT) | 0;
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
  estimateCost(params) { return ((params.maxIterations ?? 200) * 5) | 0; },
};
