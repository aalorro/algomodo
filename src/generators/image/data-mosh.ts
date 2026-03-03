import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

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

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  blockSize: {
    name: 'Block Size',
    type: 'number',
    min: 4,
    max: 128,
    step: 4,
    default: 32,
    help: 'Size of each corruption macro-block',
    group: 'Composition',
  },
  corruption: {
    name: 'Corruption',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
    help: 'Per-block probability of being scrambled',
    group: 'Composition',
  },
  channelShift: {
    name: 'Channel Shift',
    type: 'number',
    min: 0,
    max: 10,
    step: 0.25,
    default: 3,
    help: 'RGB channel separation as % of canvas width',
    group: 'Texture',
  },
  rowJitter: {
    name: 'Row Jitter',
    type: 'number',
    min: 0,
    max: 10,
    step: 0.25,
    default: 2,
    help: 'Max horizontal scan-line displacement as % of canvas width',
    group: 'Texture',
  },
  jitterDensity: {
    name: 'Jitter Density',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.08,
    help: 'Fraction of rows that get jittered',
    group: 'Texture',
  },
  glitchBands: {
    name: 'Glitch Bands',
    type: 'number',
    min: 0,
    max: 20,
    step: 1,
    default: 6,
    help: 'Number of horizontal bands with large displacement',
    group: 'Composition',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 1,
    help: 'Controls how rapidly the glitch pattern mutates and how fast jitter waves scroll',
    group: 'Flow/Motion',
  },
};

export const dataMosh: Generator = {
  id: 'data-mosh',
  family: 'image',
  styleName: 'Data Mosh',
  definition: 'Simulates video codec corruption via macro-block scrambling, RGB channel separation, and scan-line displacement',
  algorithmNotes: 'Every block is independently tested against the corruption probability for uniform full-image coverage. Channel shift is expressed as % of canvas width. During animation the frame-seed advances at ~15 ticks/s so the block-scramble map mutates continuously, channel shift oscillates sinusoidally, and row-jitter gets an additional vertically-scrolling sine wave.',
  parameterSchema,
  defaultParams: {
    blockSize: 32,
    corruption: 0.3,
    channelShift: 3,
    rowJitter: 2,
    jitterDensity: 0.08,
    glitchBands: 6,
    animSpeed: 1,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, _palette, _quality, time = 0) {
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

    const { blockSize, corruption, channelShift, rowJitter, jitterDensity, glitchBands } = params;
    const animSpeed = params.animSpeed ?? 1;
    const t = time * animSpeed;

    // Advance RNG seed per-frame so the glitch pattern mutates
    const frameSeed = seed + (Math.floor(t * 15) | 0);
    const rng = new SeededRNG(frameSeed);
    const bs = Math.max(4, blockSize | 0);

    const src = getSourcePixels(img, w, h);

    const sampleChannel = (x: number, y: number, ch: number) => {
      const sx = Math.max(0, Math.min(w - 1, x | 0));
      const sy = Math.max(0, Math.min(h - 1, y | 0));
      return src[(sy * w + sx) * 4 + ch];
    };

    const blockCols = Math.ceil(w / bs);
    const blockRows = Math.ceil(h / bs);
    const totalBlocks = blockCols * blockRows;
    const blockSrcMap = new Int32Array(totalBlocks);
    for (let i = 0; i < totalBlocks; i++) {
      blockSrcMap[i] = rng.random() < corruption
        ? rng.integer(0, totalBlocks - 1)
        : i;
    }

    // Channel shift oscillates sinusoidally during animation
    const shiftMag = channelShift * 0.01 * w;
    const shiftR = Math.round(Math.sin(t * 1.3) * shiftMag);
    const shiftB = Math.round(-Math.cos(t * 0.9) * shiftMag);

    const maxJitterPx = rowJitter * 0.01 * w;
    const rowJitterArr = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      if (rng.random() < jitterDensity) {
        rowJitterArr[y] = rng.range(-maxJitterPx, maxJitterPx);
      }
      // Add a vertically-scrolling sine wave for living motion
      rowJitterArr[y] += Math.sin(t * 2.2 + y * 0.07) * maxJitterPx * 0.4;
    }

    const numBands = Math.max(0, glitchBands | 0);
    if (numBands > 0) {
      const bandHeight = Math.max(bs, Math.round(h * rng.range(0.02, 0.06)));
      for (let b = 0; b < numBands; b++) {
        const baseY = Math.round((b / numBands) * (h - bandHeight));
        const startY = Math.max(0, Math.min(h - 1, baseY + Math.round(rng.range(-bandHeight * 0.5, bandHeight * 0.5))));
        const endY = Math.min(h, startY + bandHeight);
        const bandShift = rng.range(-w * 0.15, w * 0.15);
        for (let y = startY; y < endY; y++) {
          rowJitterArr[y] = bandShift;
        }
      }
    }

    const out = new Uint8ClampedArray(w * h * 4);

    for (let y = 0; y < h; y++) {
      const jx = rowJitterArr[y];
      for (let x = 0; x < w; x++) {
        const bx = (x / bs) | 0;
        const by = (y / bs) | 0;
        const bi = by * blockCols + bx;
        const si = blockSrcMap[bi];
        const sbx = si % blockCols;
        const sby = (si / blockCols) | 0;

        const lx = x - bx * bs;
        const ly = y - by * bs;

        const srcX = sbx * bs + lx + jx;
        const srcY = sby * bs + ly;

        const idx = (y * w + x) * 4;
        out[idx]     = sampleChannel(srcX + shiftR, srcY, 0);
        out[idx + 1] = sampleChannel(srcX,          srcY, 1);
        out[idx + 2] = sampleChannel(srcX + shiftB, srcY, 2);
        out[idx + 3] = 255;
      }
    }

    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost() { return 600; },
};
