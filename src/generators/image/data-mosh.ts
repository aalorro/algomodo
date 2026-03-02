import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

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
    help: 'Number of horizontal bands with large displacement, spread across the full image',
    group: 'Composition',
  },
};

export const dataMosh: Generator = {
  id: 'data-mosh',
  family: 'image',
  styleName: 'Data Mosh',
  definition: 'Simulates video codec corruption via macro-block scrambling, RGB channel separation, and scan-line displacement',
  algorithmNotes: 'Every block is independently tested against the corruption probability for uniform full-image coverage. Channel shift is expressed as % of canvas width. Glitch bands are evenly seeded across the full image height.',
  parameterSchema,
  defaultParams: {
    blockSize: 32,
    corruption: 0.3,
    channelShift: 3,
    rowJitter: 2,
    jitterDensity: 0.08,
    glitchBands: 6,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderCanvas2D(ctx, params, seed, _palette, _quality) {
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

    const rng = new SeededRNG(seed);
    const { blockSize, corruption, channelShift, rowJitter, jitterDensity, glitchBands } = params;
    const bs = Math.max(4, blockSize | 0);

    // Draw source image to offscreen
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const offCtx = off.getContext('2d')!;
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    offCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const src = offCtx.getImageData(0, 0, w, h).data;

    const sampleChannel = (x: number, y: number, ch: number) => {
      const sx = Math.max(0, Math.min(w - 1, x | 0));
      const sy = Math.max(0, Math.min(h - 1, y | 0));
      return src[(sy * w + sx) * 4 + ch];
    };

    // Block map — iterate EVERY block and apply corruption probability independently
    // This guarantees uniform coverage across the whole image (no birthday-paradox gaps)
    const blockCols = Math.ceil(w / bs);
    const blockRows = Math.ceil(h / bs);
    const totalBlocks = blockCols * blockRows;
    const blockSrcMap = new Int32Array(totalBlocks);
    for (let i = 0; i < totalBlocks; i++) {
      blockSrcMap[i] = rng.random() < corruption
        ? rng.integer(0, totalBlocks - 1)
        : i;
    }

    // Channel shift as % of canvas width → scales with any canvas resolution
    const shiftR = Math.round(rng.range(channelShift * 0.5, channelShift) * 0.01 * w);
    const shiftB = -Math.round(rng.range(channelShift * 0.5, channelShift) * 0.01 * w);

    // Row jitter — scan-line horizontal offsets (also % of width)
    const maxJitterPx = rowJitter * 0.01 * w;
    const rowJitterArr = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      if (rng.random() < jitterDensity) {
        rowJitterArr[y] = rng.range(-maxJitterPx, maxJitterPx);
      }
    }

    // Glitch bands — large horizontal sweeps evenly spread across the full height
    // Each band occupies a contiguous strip and shifts every row in it by the same large amount
    const numBands = Math.max(0, glitchBands | 0);
    if (numBands > 0) {
      const bandHeight = Math.max(bs, Math.round(h * rng.range(0.02, 0.06)));
      // Spread band start positions uniformly across full image height
      for (let b = 0; b < numBands; b++) {
        // Evenly distribute + small jitter so bands cover top AND bottom
        const baseY = Math.round((b / numBands) * (h - bandHeight));
        const startY = Math.max(0, Math.min(h - 1, baseY + Math.round(rng.range(-bandHeight * 0.5, bandHeight * 0.5))));
        const endY = Math.min(h, startY + bandHeight);
        const bandShift = rng.range(-w * 0.15, w * 0.15);
        for (let y = startY; y < endY; y++) {
          rowJitterArr[y] = bandShift;
        }
      }
    }

    // Build output
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
