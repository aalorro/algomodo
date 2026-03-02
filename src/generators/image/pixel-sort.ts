import type { Generator, ParameterSchema } from '../../types';

function luminance(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function hue(r: number, g: number, b: number) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const d = max - min;
  if (max === rn) return ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  if (max === gn) return ((bn - rn) / d + 2) / 6;
  return ((rn - gn) / d + 4) / 6;
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

const parameterSchema: ParameterSchema = {
  direction: {
    name: 'Direction',
    type: 'select',
    options: ['vertical', 'horizontal', 'both'],
    default: 'vertical',
    group: 'Composition',
  },
  sortBy: {
    name: 'Sort By',
    type: 'select',
    options: ['brightness', 'hue', 'saturation'],
    default: 'brightness',
    group: 'Composition',
  },
  lowerThreshold: {
    name: 'Lower Threshold',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.2,
    help: 'Pixels above this value begin a sort interval',
    group: 'Geometry',
  },
  upperThreshold: {
    name: 'Upper Threshold',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.8,
    help: 'Pixels above this value end a sort interval',
    group: 'Geometry',
  },
  reverse: {
    name: 'Reverse Sort',
    type: 'boolean',
    default: false,
    group: 'Composition',
  },
};

function getValue(sortBy: string, r: number, g: number, b: number): number {
  if (sortBy === 'hue') return hue(r, g, b);
  if (sortBy === 'saturation') return saturation(r, g, b);
  return luminance(r, g, b) / 255;
}

function sortLine(
  data: Uint8ClampedArray,
  indices: number[],
  sortBy: string,
  lo: number,
  hi: number,
  reverse: boolean,
) {
  let i = 0;
  while (i < indices.length) {
    const v = getValue(sortBy, data[indices[i] * 4], data[indices[i] * 4 + 1], data[indices[i] * 4 + 2]);
    if (v < lo) { i++; continue; }

    // Find end of interval (pixels below hi threshold)
    let j = i;
    while (j < indices.length) {
      const vj = getValue(sortBy, data[indices[j] * 4], data[indices[j] * 4 + 1], data[indices[j] * 4 + 2]);
      if (vj >= hi) break;
      j++;
    }

    if (j > i + 1) {
      // Copy pixels in this interval
      const pixels: [number, number, number, number, number][] = [];
      for (let k = i; k < j; k++) {
        const b = indices[k] * 4;
        const val = getValue(sortBy, data[b], data[b + 1], data[b + 2]);
        pixels.push([data[b], data[b + 1], data[b + 2], data[b + 3], val]);
      }
      pixels.sort((a, b) => reverse ? b[4] - a[4] : a[4] - b[4]);

      for (let k = 0; k < pixels.length; k++) {
        const dst = indices[i + k] * 4;
        data[dst] = pixels[k][0];
        data[dst + 1] = pixels[k][1];
        data[dst + 2] = pixels[k][2];
        data[dst + 3] = pixels[k][3];
      }
    }
    i = j + 1;
  }
}

export const pixelSort: Generator = {
  id: 'pixel-sort',
  family: 'image',
  styleName: 'Pixel Sort',
  definition: 'Sorts pixel columns or rows by luminance, hue, or saturation creating streaked glitch aesthetics',
  algorithmNotes: 'Threshold-interval sorting: pixels are grouped into intervals based on value thresholds, then sorted within each interval',
  parameterSchema,
  defaultParams: {
    direction: 'vertical',
    sortBy: 'brightness',
    lowerThreshold: 0.2,
    upperThreshold: 0.8,
    reverse: false,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderCanvas2D(ctx, params, _seed, _palette, _quality) {
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

    // Draw image to offscreen canvas scaled to fill
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const offCtx = off.getContext('2d')!;
    offCtx.fillStyle = '#111';
    offCtx.fillRect(0, 0, w, h);

    // Cover-fit
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    offCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

    const imageData = offCtx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const { direction, sortBy, lowerThreshold, upperThreshold, reverse } = params;

    if (direction === 'vertical' || direction === 'both') {
      for (let x = 0; x < w; x++) {
        const col = Array.from({ length: h }, (_, y) => y * w + x);
        sortLine(data, col, sortBy, lowerThreshold, upperThreshold, reverse);
      }
    }
    if (direction === 'horizontal' || direction === 'both') {
      for (let y = 0; y < h; y++) {
        const row = Array.from({ length: w }, (_, x) => y * w + x);
        sortLine(data, row, sortBy, lowerThreshold, upperThreshold, reverse);
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost() { return 500; },
};
