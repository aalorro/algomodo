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

const CREAM = '#f5f0e8';

function resolveColor(mode: string, palette: Palette): string {
  if (mode === 'black') return '#000000';
  if (mode === 'white') return '#ffffff';
  if (mode === 'cream') return CREAM;
  if (mode === 'palette-first') return palette.colors[0] ?? '#000000';
  if (mode === 'palette-last') return palette.colors[palette.colors.length - 1] ?? '#ffffff';
  return '#000000';
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  threshold: {
    name: 'Cut Threshold',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.45,
    help: 'Luminance level that separates ink from paper',
    group: 'Composition',
  },
  inkColor: {
    name: 'Ink Color',
    type: 'select',
    options: ['palette-first', 'palette-last', 'black', 'white'],
    default: 'palette-first',
    group: 'Color',
  },
  paperColor: {
    name: 'Paper Color',
    type: 'select',
    options: ['palette-last', 'palette-first', 'white', 'black', 'cream'],
    default: 'palette-last',
    group: 'Color',
  },
  edgeWidth: {
    name: 'Edge Detail',
    type: 'number',
    min: 1,
    max: 8,
    step: 1,
    default: 2,
    help: 'Pixel radius for edge detection pass',
    group: 'Geometry',
  },
  edgeMix: {
    name: 'Edge Mix',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    help: 'How much edge detection blends with the flat threshold',
    group: 'Geometry',
  },
  invert: {
    name: 'Invert',
    type: 'boolean',
    default: false,
    help: 'Swap ink and paper',
    group: 'Composition',
  },
  grain: {
    name: 'Paper Grain',
    type: 'number',
    min: 0,
    max: 0.15,
    step: 0.005,
    default: 0.03,
    help: 'Adds subtle noise texture to simulate printing on rough paper',
    group: 'Texture',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 0.8,
    help: 'Controls grain flicker rate and threshold oscillation speed',
    group: 'Flow/Motion',
  },
};

export const linoCut: Generator = {
  id: 'lino-cut',
  family: 'image',
  styleName: 'Lino Cut',
  definition: 'Converts the source image to a two-tone linocut / woodblock print using luminance thresholding and edge detection',
  algorithmNotes: 'Computes per-pixel luminance; a Sobel-blended threshold separates ink from paper. During animation the grain noise seed changes each frame to simulate a living film-grain texture, and the threshold subtly oscillates, making edge regions breathe between ink and paper.',
  parameterSchema,
  defaultParams: {
    threshold: 0.45,
    inkColor: 'palette-first',
    paperColor: 'palette-last',
    edgeWidth: 2,
    edgeMix: 0.5,
    invert: false,
    grain: 0.03,
    animSpeed: 0.8,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
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

    const { inkColor, paperColor, edgeWidth, edgeMix, invert, grain } = params;
    const animSpeed = params.animSpeed ?? 0.8;
    const t = time * animSpeed;

    // Threshold gently oscillates around the base value
    const baseThreshold = params.threshold ?? 0.45;
    const threshold = baseThreshold + Math.sin(t * 0.65) * 0.04;

    const src = getSourcePixels(img, w, h);

    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const b = i * 4;
      lum[i] = (0.299 * src[b] + 0.587 * src[b + 1] + 0.114 * src[b + 2]) / 255;
    }

    const lumAt = (x: number, y: number) =>
      lum[Math.max(0, Math.min(h - 1, y | 0)) * w + Math.max(0, Math.min(w - 1, x | 0))];

    const [ir, ig, ib] = hexToRgb(resolveColor(inkColor, palette));
    const [pr, pg, pb] = hexToRgb(resolveColor(paperColor, palette));

    const ew = Math.max(1, edgeWidth | 0);
    const grainAmt = grain ?? 0;

    // Grain seed advances with time for film-grain flicker (~24 unique frames/s)
    const frameSeed = seed ^ ((Math.floor(t * 24) | 0) * 2654435761 >>> 0);
    const noiseAt = (x: number, y: number) => {
      const n = Math.sin(x * 127.1 + y * 311.7 + frameSeed) * 43758.5453;
      return n - Math.floor(n);
    };

    const out = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = lumAt(x, y);

        const gx =
          -lumAt(x - ew, y - ew) + lumAt(x + ew, y - ew) +
          -2 * lumAt(x - ew, y) + 2 * lumAt(x + ew, y) +
          -lumAt(x - ew, y + ew) + lumAt(x + ew, y + ew);
        const gy =
          -lumAt(x - ew, y - ew) - 2 * lumAt(x, y - ew) - lumAt(x + ew, y - ew) +
          lumAt(x - ew, y + ew) + 2 * lumAt(x, y + ew) + lumAt(x + ew, y + ew);
        const edge = Math.min(1, Math.sqrt(gx * gx + gy * gy));

        const blended = l * (1 - edgeMix) + (l - edge * 0.5) * edgeMix;

        let isInk = invert ? blended > threshold : blended <= threshold;

        if (grainAmt > 0) {
          const n = noiseAt(x, y) * 2 - 1;
          isInk = invert
            ? blended + n * grainAmt > threshold
            : blended + n * grainAmt <= threshold;
        }

        const idx = (y * w + x) * 4;
        if (isInk) {
          out[idx] = ir; out[idx + 1] = ig; out[idx + 2] = ib;
        } else {
          out[idx] = pr; out[idx + 1] = pg; out[idx + 2] = pb;
        }
        out[idx + 3] = 255;
      }
    }

    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost() { return 500; },
};
