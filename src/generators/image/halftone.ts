import type { Generator, Palette, ParameterSchema } from '../../types';

// ─── Source image pixel cache ─────────────────────────────────────────────────
const _imgCache = new WeakMap<HTMLImageElement, { w: number; h: number; data: Uint8ClampedArray }>();
function getSourcePixels(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const c = _imgCache.get(img);
  if (c && c.w === w && c.h === h) return c.data;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const offCtx = off.getContext('2d')!;
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  offCtx.drawImage(img, (w - img.naturalWidth * scale) / 2, (h - img.naturalHeight * scale) / 2,
    img.naturalWidth * scale, img.naturalHeight * scale);
  const data = new Uint8ClampedArray(offCtx.getImageData(0, 0, w, h).data);
  _imgCache.set(img, { w, h, data });
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearestPaletteColor(r: number, g: number, b: number, palette: Palette): string {
  let best = palette.colors[0];
  let bestDist = Infinity;
  for (const c of palette.colors) {
    const [pr, pg, pb] = hexToRgb(c);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  cellSize: {
    name: 'Cell Size',
    type: 'number',
    min: 4,
    max: 60,
    step: 2,
    default: 12,
    help: 'Grid cell size — controls dot density',
    group: 'Composition',
  },
  dotScale: {
    name: 'Dot Scale',
    type: 'number',
    min: 0.2,
    max: 1.4,
    step: 0.05,
    default: 0.9,
    help: 'Max dot radius as a fraction of the cell half-size',
    group: 'Geometry',
  },
  shape: {
    name: 'Dot Shape',
    type: 'select',
    options: ['circle', 'square', 'diamond', 'line'],
    default: 'circle',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'original', 'monochrome'],
    default: 'palette',
    group: 'Color',
  },
  invert: {
    name: 'Invert',
    type: 'boolean',
    default: false,
    help: 'Invert brightness mapping (dark areas = large dots)',
    group: 'Composition',
  },
  angle: {
    name: 'Grid Angle',
    type: 'number',
    min: 0,
    max: 90,
    step: 1,
    default: 0,
    help: 'Starting angle of the dot grid',
    group: 'Geometry',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.05,
    max: 2,
    step: 0.05,
    default: 0.4,
    help: 'Speed of grid rotation and dot-size pulsing during animation',
    group: 'Flow/Motion',
  },
};

export const halftone: Generator = {
  id: 'halftone',
  family: 'image',
  styleName: 'Halftone',
  definition: 'Renders the source image as a grid of dots sized by local brightness, like classic print halftone screens',
  algorithmNotes: 'For each grid cell the average luminance drives the dot radius. Color is sourced from the cell average or mapped to the palette. During animation the grid slowly rotates and dots subtly pulse in size, producing a living moiré shimmer.',
  parameterSchema,
  defaultParams: {
    cellSize: 12,
    dotScale: 0.9,
    shape: 'circle',
    colorMode: 'palette',
    invert: false,
    angle: 0,
    animSpeed: 0.4,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, _seed, palette, _quality, time = 0) {
    const img: HTMLImageElement | undefined = params._sourceImage;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    if (!img) {
      const fs = Math.round(w * 0.022);
      ctx.textAlign = 'center';
      ctx.font = `600 ${fs}px sans-serif`;
      ctx.fillStyle = '#aaa';
      ctx.fillText('Drag and drop your file here', w / 2, h / 2 - fs * 0.8);
      ctx.font = `${fs}px sans-serif`;
      ctx.fillStyle = '#666';
      ctx.fillText('or copy and paste (Ctrl+V) here', w / 2, h / 2 + fs * 0.8);
      ctx.textAlign = 'left';
      return;
    }

    const { cellSize, dotScale, shape, colorMode, invert, angle } = params;
    const animSpeed = params.animSpeed ?? 0.4;
    const t = time * animSpeed;

    // Grid angle rotates continuously; starting angle offsets the rotation
    const animAngle = angle + t * 25; // 25°/s at speed 1
    const rad = (animAngle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const srcData = getSourcePixels(img, w, h);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const diagonal = Math.sqrt(w * w + h * h);
    const steps = Math.ceil(diagonal / cellSize) + 2;

    for (let gy = -steps; gy <= steps; gy++) {
      for (let gx = -steps; gx <= steps; gx++) {
        const lx = gx * cellSize;
        const ly = gy * cellSize;
        const cx = cos * lx - sin * ly + w / 2;
        const cy = sin * lx + cos * ly + h / 2;

        if (cx < -cellSize || cx > w + cellSize || cy < -cellSize || cy > h + cellSize) continue;

        const r0 = Math.max(0, Math.floor(cy - cellSize / 2));
        const r1 = Math.min(h - 1, Math.floor(cy + cellSize / 2));
        const c0 = Math.max(0, Math.floor(cx - cellSize / 2));
        const c1 = Math.min(w - 1, Math.floor(cx + cellSize / 2));

        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let py = r0; py <= r1; py++) {
          for (let px = c0; px <= c1; px++) {
            const i = (py * w + px) * 4;
            sumR += srcData[i]; sumG += srcData[i + 1]; sumB += srcData[i + 2];
            count++;
          }
        }
        if (count === 0) continue;

        const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count;
        const lum = (0.299 * avgR + 0.587 * avgG + 0.114 * avgB) / 255;
        let brightness = invert ? 1 - lum : lum;

        // Subtle dot-size pulse; wave phase offset by grid position creates shimmer
        brightness *= 1 + 0.07 * Math.sin(t * 2.5 + gx * 0.35 + gy * 0.28);
        brightness = Math.max(0, brightness);

        const maxR = (cellSize / 2) * dotScale;
        const dotR = maxR * brightness;
        if (dotR < 0.5) continue;

        if (colorMode === 'original') {
          ctx.fillStyle = `rgb(${avgR | 0},${avgG | 0},${avgB | 0})`;
        } else if (colorMode === 'monochrome') {
          const v = (brightness * 255) | 0;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
        } else {
          ctx.fillStyle = nearestPaletteColor(avgR, avgG, avgB, palette);
        }

        ctx.beginPath();
        if (shape === 'circle') {
          ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
          ctx.fill();
        } else if (shape === 'square') {
          ctx.fillRect(cx - dotR, cy - dotR, dotR * 2, dotR * 2);
        } else if (shape === 'diamond') {
          ctx.beginPath();
          ctx.moveTo(cx, cy - dotR);
          ctx.lineTo(cx + dotR, cy);
          ctx.lineTo(cx, cy + dotR);
          ctx.lineTo(cx - dotR, cy);
          ctx.closePath();
          ctx.fill();
        } else if (shape === 'line') {
          ctx.lineWidth = dotR * 0.7;
          ctx.strokeStyle = ctx.fillStyle;
          ctx.beginPath();
          ctx.moveTo(cx - dotR, cy);
          ctx.lineTo(cx + dotR, cy);
          ctx.stroke();
        }
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(1500 / (params.cellSize || 12)); },
};
