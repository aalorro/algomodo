import type { Generator, Palette, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearestPaletteColor(r: number, g: number, b: number, palette: Palette): [number, number, number] {
  let best = hexToRgb(palette.colors[0]);
  let bestDist = Infinity;
  for (const c of palette.colors) {
    const [pr, pg, pb] = hexToRgb(c);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) { bestDist = d; best = [pr, pg, pb]; }
  }
  return best;
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
};

export const ditherImage: Generator = {
  id: 'dither-image',
  family: 'image',
  styleName: 'Dither',
  definition: 'Applies classic dithering algorithms to the source image, snapping colours to the active palette',
  algorithmNotes: 'Floyd-Steinberg and Atkinson use error diffusion; Bayer and ordered-dot use threshold matrices. All algorithms work at reduced resolution (Pixel Scale) then upscale.',
  parameterSchema,
  defaultParams: {
    algorithm: 'floyd-steinberg',
    colorMode: 'palette',
    scale: 2,
    strength: 1.0,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderCanvas2D(ctx, params, _seed, palette, _quality) {
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

    const { algorithm, colorMode, scale, strength } = params;
    const ps = Math.max(1, scale | 0);

    // Work at reduced resolution
    const sw = Math.max(1, (w / ps) | 0);
    const sh = Math.max(1, (h / ps) | 0);

    const off = document.createElement('canvas');
    off.width = sw; off.height = sh;
    const offCtx = off.getContext('2d')!;
    const imgScale = Math.max(sw / img.naturalWidth, sh / img.naturalHeight);
    const dw = img.naturalWidth * imgScale;
    const dh = img.naturalHeight * imgScale;
    offCtx.drawImage(img, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
    const src = offCtx.getImageData(0, 0, sw, sh).data;

    // Working float buffers (R, G, B)
    const fr = new Float32Array(sw * sh);
    const fg = new Float32Array(sw * sh);
    const fb = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) {
      fr[i] = src[i * 4];
      fg[i] = src[i * 4 + 1];
      fb[i] = src[i * 4 + 2];
    }

    // Build quantisation target list
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
      for (const t of targets) {
        const d = (r - t[0]) ** 2 + (g - t[1]) ** 2 + (b - t[2]) ** 2;
        if (d < bestDist) { bestDist = d; best = t; }
      }
      return best;
    };

    const out = new Uint8ClampedArray(sw * sh * 4);

    const addError = (idx: number, er: number, eg: number, eb: number, w_: number) => {
      if (idx < 0 || idx >= sw * sh) return;
      fr[idx] += er * w_;
      fg[idx] += eg * w_;
      fb[idx] += eb * w_;
    };

    const s = strength ?? 1;

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = y * sw + x;
        let r = Math.max(0, Math.min(255, fr[i]));
        let g = Math.max(0, Math.min(255, fg[i]));
        let b = Math.max(0, Math.min(255, fb[i]));

        let qr: number, qg: number, qb: number;

        if (algorithm === 'bayer-2' || algorithm === 'bayer-4' || algorithm === 'bayer-8' || algorithm === 'ordered-dot') {
          let threshold: number;
          if (algorithm === 'bayer-2') {
            const mat = [0, 0.5, 0.75, 0.25];
            threshold = mat[(y % 2) * 2 + (x % 2)] * s;
          } else if (algorithm === 'bayer-4') {
            const idx4 = (y % 4) * 4 + (x % 4);
            const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16);
            threshold = bayer4[idx4] * s;
          } else if (algorithm === 'ordered-dot') {
            // Radial ordered dither — brighter center
            const cx = x % 4 - 1.5, cy = y % 4 - 1.5;
            const dist = Math.sqrt(cx * cx + cy * cy) / 2.12;
            threshold = dist * s;
          } else {
            threshold = BAYER8[(y % 8) * 8 + (x % 8)] * s;
          }
          // Apply threshold per channel
          qr = r / 255 + threshold - 0.5 > 0.5 ? 255 : 0;
          qg = g / 255 + threshold - 0.5 > 0.5 ? 255 : 0;
          qb = b / 255 + threshold - 0.5 > 0.5 ? 255 : 0;
          // Snap to nearest palette/target
          [qr, qg, qb] = quantize(qr, qg, qb);
        } else {
          // Error diffusion
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
            // Atkinson: distributes only 6/8 of error (creates stronger contrast)
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

    // Upscale back to full canvas
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
