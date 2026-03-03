import type { Generator, Palette, ParameterSchema } from '../../types';

// ─── Source image pixel cache (at reduced scale resolution) ───────────────────
const _imgCache = new WeakMap<HTMLImageElement, Map<string, Uint8ClampedArray>>();
function getSourcePixels(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  let sizeMap = _imgCache.get(img);
  if (!sizeMap) { sizeMap = new Map(); _imgCache.set(img, sizeMap); }
  const key = `${w}_${h}`;
  const cached = sizeMap.get(key);
  if (cached) return cached;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const offCtx = off.getContext('2d')!;
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  offCtx.drawImage(img, (w - img.naturalWidth * scale) / 2, (h - img.naturalHeight * scale) / 2,
    img.naturalWidth * scale, img.naturalHeight * scale);
  const data = new Uint8ClampedArray(offCtx.getImageData(0, 0, w, h).data);
  sizeMap.set(key, data);
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Bayer matrix 8×8 (normalized 0–1)
const BAYER8: number[] = [
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
].map(v => v / 64);

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  algorithm: {
    name: 'Algorithm',
    type: 'select',
    options: ['floyd-steinberg', 'bayer-2', 'bayer-4', 'bayer-8', 'ordered-dot', 'atkinson'],
    default: 'floyd-steinberg',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'monochrome-2', 'monochrome-4'],
    default: 'palette',
    help: 'palette = snap to active palette colors; monochrome = black/white (2) or 4-level grey',
    group: 'Color',
  },
  scale: {
    name: 'Pixel Scale',
    type: 'number',
    min: 1,
    max: 8,
    step: 1,
    default: 2,
    help: 'Downscale factor before dithering — larger = chunkier pixels',
    group: 'Composition',
  },
  strength: {
    name: 'Dither Strength',
    type: 'number',
    min: 0.1,
    max: 2,
    step: 0.05,
    default: 1.0,
    help: 'Scales the error or threshold spread (>1 = more aggressive)',
    group: 'Texture',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 0.8,
    help: 'For Bayer modes: scrolls the threshold matrix. For error-diffusion: oscillates strength.',
    group: 'Flow/Motion',
  },
};

export const ditherImage: Generator = {
  id: 'dither-image',
  family: 'image',
  styleName: 'Dither',
  definition: 'Applies classic dithering algorithms to the source image, snapping colours to the active palette',
  algorithmNotes: 'Floyd-Steinberg and Atkinson use error diffusion; Bayer and ordered-dot use threshold matrices. All algorithms work at reduced resolution (Pixel Scale) then upscale. During animation, Bayer/ordered modes scroll the threshold matrix diagonally for a shimmering moiré; error-diffusion modes oscillate dither strength.',
  parameterSchema,
  defaultParams: {
    algorithm: 'floyd-steinberg',
    colorMode: 'palette',
    scale: 2,
    strength: 1.0,
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

    const { algorithm, colorMode } = params;
    const ps = Math.max(1, (params.scale | 0) || 2);
    const animSpeed = params.animSpeed ?? 0.8;
    const t = time * animSpeed;

    // Work at reduced resolution
    const sw = Math.max(1, (w / ps) | 0);
    const sh = Math.max(1, (h / ps) | 0);

    // Source pixels at reduced resolution (cached per img + size)
    const srcRaw = getSourcePixels(img, sw, sh);

    // Working float buffers
    const fr = new Float32Array(sw * sh);
    const fg = new Float32Array(sw * sh);
    const fb = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) {
      fr[i] = srcRaw[i * 4];
      fg[i] = srcRaw[i * 4 + 1];
      fb[i] = srcRaw[i * 4 + 2];
    }

    type RGB = [number, number, number];
    let targets: RGB[];
    if (colorMode === 'monochrome-2') {
      targets = [[0, 0, 0], [255, 255, 255]];
    } else if (colorMode === 'monochrome-4') {
      targets = [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]];
    } else {
      targets = palette.colors.map(hexToRgb);
    }

    const quantize = (r: number, g: number, b: number): RGB => {
      let best = targets[0];
      let bestDist = Infinity;
      for (const tgt of targets) {
        const d = (r - tgt[0]) ** 2 + (g - tgt[1]) ** 2 + (b - tgt[2]) ** 2;
        if (d < bestDist) { bestDist = d; best = tgt; }
      }
      return best;
    };

    const out = new Uint8ClampedArray(sw * sh * 4);

    const addError = (idx: number, er: number, eg: number, eb: number, wt: number) => {
      if (idx < 0 || idx >= sw * sh) return;
      fr[idx] += er * wt;
      fg[idx] += eg * wt;
      fb[idx] += eb * wt;
    };

    const isBayer = algorithm === 'bayer-2' || algorithm === 'bayer-4'
                 || algorithm === 'bayer-8' || algorithm === 'ordered-dot';

    // Bayer/ordered modes: scroll the pattern diagonally over time
    const tOff = isBayer ? (Math.floor(t * 6) | 0) : 0;

    // Error-diffusion modes: oscillate strength for a shimmering effect
    const baseStrength = params.strength ?? 1;
    const s = isBayer
      ? baseStrength
      : baseStrength * (0.8 + 0.2 * Math.abs(Math.sin(t * 1.1)));

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = y * sw + x;
        let r = Math.max(0, Math.min(255, fr[i]));
        let g = Math.max(0, Math.min(255, fg[i]));
        let b = Math.max(0, Math.min(255, fb[i]));

        let qr: number, qg: number, qb: number;

        if (isBayer) {
          let threshold: number;
          const bx = (x + tOff) & 7;  // wrapping shift for animation
          const by = (y + tOff) & 7;

          if (algorithm === 'bayer-2') {
            const mat = [0, 0.5, 0.75, 0.25];
            threshold = mat[(y % 2) * 2 + (x % 2)] * s;
          } else if (algorithm === 'bayer-4') {
            const idx4 = (y % 4) * 4 + (x % 4);
            const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16);
            threshold = bayer4[idx4] * s;
          } else if (algorithm === 'ordered-dot') {
            const cx = x % 4 - 1.5, cy = y % 4 - 1.5;
            const dist = Math.sqrt(cx * cx + cy * cy) / 2.12;
            threshold = dist * s;
          } else {
            threshold = BAYER8[by * 8 + bx] * s;
          }
          qr = r / 255 + threshold - 0.5 > 0.5 ? 255 : 0;
          qg = g / 255 + threshold - 0.5 > 0.5 ? 255 : 0;
          qb = b / 255 + threshold - 0.5 > 0.5 ? 255 : 0;
          [qr, qg, qb] = quantize(qr, qg, qb);
        } else {
          [qr, qg, qb] = quantize(r, g, b);
          const er = (r - qr) * s;
          const eg = (g - qg) * s;
          const eb = (b - qb) * s;

          if (algorithm === 'floyd-steinberg') {
            addError(i + 1,          er * 7 / 16, eg * 7 / 16, eb * 7 / 16, 1);
            addError(i + sw - 1,     er * 3 / 16, eg * 3 / 16, eb * 3 / 16, 1);
            addError(i + sw,         er * 5 / 16, eg * 5 / 16, eb * 5 / 16, 1);
            addError(i + sw + 1,     er * 1 / 16, eg * 1 / 16, eb * 1 / 16, 1);
          } else if (algorithm === 'atkinson') {
            const f = 1 / 8;
            addError(i + 1,      er * f, eg * f, eb * f, 1);
            addError(i + 2,      er * f, eg * f, eb * f, 1);
            addError(i + sw - 1, er * f, eg * f, eb * f, 1);
            addError(i + sw,     er * f, eg * f, eb * f, 1);
            addError(i + sw + 1, er * f, eg * f, eb * f, 1);
            addError(i + 2 * sw, er * f, eg * f, eb * f, 1);
          }
        }

        out[i * 4]     = qr;
        out[i * 4 + 1] = qg;
        out[i * 4 + 2] = qb;
        out[i * 4 + 3] = 255;
      }
    }

    const small = new ImageData(out, sw, sh);
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = sw; smallCanvas.height = sh;
    smallCanvas.getContext('2d')!.putImageData(small, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(smallCanvas, 0, 0, w, h);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(800 / (params.scale || 2)); },
};
