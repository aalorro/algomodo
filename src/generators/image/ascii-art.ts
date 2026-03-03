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

// Standard ramp from darkest to lightest
const RAMPS: Record<string, string> = {
  'standard':  ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  'blocks':    ' ░▒▓█',
  'simple':    ' .:+*#@',
  'binary':    ' 0',
  'braille':   ' ⠂⠆⠇⠧⠿',
};

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  charSet: {
    name: 'Character Set',
    type: 'select',
    options: ['standard', 'blocks', 'simple', 'binary', 'braille'],
    default: 'standard',
    group: 'Composition',
  },
  cellSize: {
    name: 'Cell Size',
    type: 'number',
    min: 4,
    max: 32,
    step: 2,
    default: 10,
    help: 'Width of each character cell in canvas pixels',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['original', 'palette', 'monochrome'],
    default: 'original',
    group: 'Color',
  },
  bgColor: {
    name: 'Background',
    type: 'select',
    options: ['black', 'white', 'palette-last', 'transparent'],
    default: 'black',
    group: 'Color',
  },
  bold: {
    name: 'Bold',
    type: 'boolean',
    default: false,
    group: 'Texture',
  },
  fontFamily: {
    name: 'Font',
    type: 'select',
    options: ['monospace', 'Courier New', 'Lucida Console', 'Consolas'],
    default: 'monospace',
    group: 'Texture',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 0.8,
    help: 'Speed of the luminance ripple wave that sweeps across characters',
    group: 'Flow/Motion',
  },
};

export const asciiArt: Generator = {
  id: 'ascii-art',
  family: 'image',
  styleName: 'ASCII',
  definition: 'Renders the source image as a grid of ASCII (or block) characters sized by local luminance',
  algorithmNotes: 'Averages luminance over each character cell, maps it to a character in a density ramp, and draws that character in the cell center. During animation a sinusoidal luminance ripple wave sweeps diagonally across the grid, causing cells to morph through denser and sparser characters — producing a flowing, living text effect.',
  parameterSchema,
  defaultParams: {
    charSet: 'standard',
    cellSize: 10,
    colorMode: 'original',
    bgColor: 'black',
    bold: false,
    fontFamily: 'monospace',
    animSpeed: 0.8,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, _seed, palette, _quality, time = 0) {
    const img: HTMLImageElement | undefined = params._sourceImage;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const bgColorStr = (() => {
      if (params.bgColor === 'white') return '#ffffff';
      if (params.bgColor === 'palette-last') return palette.colors[palette.colors.length - 1] ?? '#000000';
      if (params.bgColor === 'transparent') return 'rgba(0,0,0,0)';
      return '#000000';
    })();
    ctx.fillStyle = bgColorStr;
    ctx.fillRect(0, 0, w, h);

    if (!img) {
      const fs = Math.round(w * 0.022);
      ctx.textAlign = 'center';
      ctx.font = `600 ${fs}px sans-serif`;
      ctx.fillStyle = bgColorStr === '#000000' ? '#aaa' : '#333';
      ctx.fillText('Drag and drop your file here', w / 2, h / 2 - fs * 0.8);
      ctx.font = `${fs}px sans-serif`;
      ctx.fillStyle = '#666';
      ctx.fillText('or copy and paste (Ctrl+V) here', w / 2, h / 2 + fs * 0.8);
      ctx.textAlign = 'left';
      return;
    }

    const { charSet, cellSize, colorMode, bold, fontFamily } = params;
    const animSpeed = params.animSpeed ?? 0.8;
    const t = time * animSpeed;
    const cs = Math.max(4, cellSize | 0);
    const ramp = RAMPS[charSet] ?? RAMPS['standard'];

    const src = getSourcePixels(img, w, h);

    const fontSize = Math.round(cs * 0.9);
    ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const cols = Math.ceil(w / cs);
    const rows = Math.ceil(h / cs);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x0 = col * cs;
        const y0 = row * cs;
        const x1 = Math.min(w, x0 + cs);
        const y1 = Math.min(h, y0 + cs);

        let sumR = 0, sumG = 0, sumB = 0, sumL = 0, count = 0;
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            const i = (py * w + px) * 4;
            const r = src[i], g = src[i + 1], b = src[i + 2];
            sumR += r; sumG += g; sumB += b;
            sumL += 0.299 * r + 0.587 * g + 0.114 * b;
            count++;
          }
        }
        if (count === 0) continue;

        const avgR = sumR / count;
        const avgG = sumG / count;
        const avgB = sumB / count;
        const lum = sumL / count / 255;

        // Luminance ripple: diagonal wave sweeps across the character grid
        const ripple = Math.sin(t * 2.2 + col * 0.22 + row * 0.18) * 0.18;
        const animLum = Math.max(0, Math.min(1, lum + ripple));

        const charIdx = Math.floor(animLum * (ramp.length - 1));
        const char = ramp[charIdx];
        if (!char || char === ' ') continue;

        if (colorMode === 'original') {
          ctx.fillStyle = `rgb(${avgR | 0},${avgG | 0},${avgB | 0})`;
        } else if (colorMode === 'monochrome') {
          const v = (animLum * 255) | 0;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
        } else {
          const [pr, pg, pb] = hexToRgb(
            palette.colors[Math.floor(animLum * (palette.colors.length - 1))] ?? palette.colors[0]
          );
          ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
        }

        ctx.fillText(char, x0 + cs / 2, y0 + cs / 2);
      }
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(3000 / ((params.cellSize || 10) ** 2) * 100); },
};
