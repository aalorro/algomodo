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
    max: 80,
    step: 2,
    default: 16,
    help: 'Pixel size of each mosaic tile',
    group: 'Composition',
  },
  gap: {
    name: 'Gap',
    type: 'number',
    min: 0,
    max: 8,
    step: 1,
    default: 1,
    help: 'Space between tiles',
    group: 'Composition',
  },
  shape: {
    name: 'Tile Shape',
    type: 'select',
    options: ['square', 'circle', 'diamond'],
    default: 'square',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['original', 'palette', 'palette-blend'],
    default: 'palette',
    help: 'original = exact image color, palette = nearest palette color, palette-blend = mix both',
    group: 'Color',
  },
  blendStrength: {
    name: 'Palette Blend',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.7,
    help: 'How much to shift toward the palette color (palette-blend mode)',
    group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 0.8,
    help: 'Speed of the brightness ripple wave that expands from the canvas centre',
    group: 'Flow/Motion',
  },
};

export const mosaic: Generator = {
  id: 'mosaic',
  family: 'image',
  styleName: 'Mosaic',
  definition: 'Pixelates the source image into a grid of tiles, optionally mapping colors to the active palette',
  algorithmNotes: 'Samples average RGB per grid cell, then renders each cell as square/circle/diamond. Nearest-neighbour palette mapping via Euclidean RGB distance. During animation a radial sinusoidal ripple expands from the canvas centre, modulating each tile\'s brightness to create a pulsing mosaic wave.',
  parameterSchema,
  defaultParams: {
    cellSize: 16,
    gap: 1,
    shape: 'square',
    colorMode: 'palette',
    blendStrength: 0.7,
    animSpeed: 0.8,
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

    const srcData = getSourcePixels(img, w, h);
    const { cellSize, gap, shape, colorMode, blendStrength } = params;
    const animSpeed = params.animSpeed ?? 0.8;
    const t = time * animSpeed;
    const tileInner = cellSize - gap;
    if (tileInner <= 0) return;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    for (let ty = 0; ty < h; ty += cellSize) {
      for (let tx = 0; tx < w; tx += cellSize) {
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let py = ty; py < ty + cellSize && py < h; py++) {
          for (let px = tx; px < tx + cellSize && px < w; px++) {
            const i = (py * w + px) * 4;
            sumR += srcData[i];
            sumG += srcData[i + 1];
            sumB += srcData[i + 2];
            count++;
          }
        }
        if (count === 0) continue;
        let r = sumR / count, g = sumG / count, b = sumB / count;

        // Radial brightness ripple expanding from canvas centre
        const dcx = (tx + cellSize / 2) - w / 2;
        const dcy = (ty + cellSize / 2) - h / 2;
        const dist = Math.sqrt(dcx * dcx + dcy * dcy);
        const wave = Math.sin(t * 2.2 - dist / cellSize * 0.45) * 0.14;
        r = Math.max(0, Math.min(255, r * (1 + wave)));
        g = Math.max(0, Math.min(255, g * (1 + wave)));
        b = Math.max(0, Math.min(255, b * (1 + wave)));

        let fillColor: string;
        if (colorMode === 'original') {
          fillColor = `rgb(${r | 0},${g | 0},${b | 0})`;
        } else if (colorMode === 'palette') {
          fillColor = nearestPaletteColor(r, g, b, palette);
        } else {
          const pal = nearestPaletteColor(r, g, b, palette);
          const [pr, pg, pb] = hexToRgb(pal);
          const blend = blendStrength ?? 0.7;
          r = r * (1 - blend) + pr * blend;
          g = g * (1 - blend) + pg * blend;
          b = b * (1 - blend) + pb * blend;
          fillColor = `rgb(${r | 0},${g | 0},${b | 0})`;
        }

        ctx.fillStyle = fillColor;

        const cx = tx + cellSize / 2;
        const cy = ty + cellSize / 2;
        const half = tileInner / 2;

        if (shape === 'circle') {
          ctx.beginPath();
          ctx.arc(cx, cy, half, 0, Math.PI * 2);
          ctx.fill();
        } else if (shape === 'diamond') {
          ctx.beginPath();
          ctx.moveTo(cx, cy - half);
          ctx.lineTo(cx + half, cy);
          ctx.lineTo(cx, cy + half);
          ctx.lineTo(cx - half, cy);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(tx + gap / 2, ty + gap / 2, tileInner, tileInner);
        }
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(2000 / (params.cellSize || 16)); },
};
