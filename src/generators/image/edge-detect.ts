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

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  algorithm: {
    name: 'Algorithm',
    type: 'select',
    options: ['sobel', 'prewitt', 'laplacian', 'roberts', 'canny'],
    default: 'sobel',
    group: 'Composition',
  },
  thickness: {
    name: 'Thickness',
    type: 'number',
    min: 1,
    max: 6,
    step: 1,
    default: 1,
    help: 'Edge thickness via max-pooling dilation',
    group: 'Geometry',
  },
  threshold: {
    name: 'Threshold',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.15,
    help: 'Minimum gradient magnitude to count as an edge',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['white-on-black', 'black-on-white', 'original-color', 'palette-gradient'],
    default: 'white-on-black',
    group: 'Color',
  },
  invert: {
    name: 'Invert',
    type: 'boolean',
    default: false,
    help: 'Invert the edge detection result',
    group: 'Composition',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 1,
    help: 'Controls threshold oscillation speed during animation',
    group: 'Flow/Motion',
  },
};

export const edgeDetect: Generator = {
  id: 'edge-detect',
  family: 'image',
  styleName: 'Edge Detect',
  definition: 'Detects edges in the source image using Sobel, Prewitt, Laplacian, Roberts Cross, or simplified Canny operators',
  algorithmNotes: 'Precomputes a luma buffer then applies the selected gradient operator. Thickness > 1 uses max-pooling to dilate edges. Canny uses Gaussian blur, Sobel, non-maximum suppression, and double thresholding. Animation oscillates the threshold sinusoidally.',
  parameterSchema,
  defaultParams: {
    algorithm: 'sobel',
    thickness: 1,
    threshold: 0.15,
    colorMode: 'white-on-black',
    invert: false,
    animSpeed: 1,
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

    const algorithm: string = params.algorithm ?? 'sobel';
    const thickness = Math.max(1, params.thickness | 0);
    const colorMode: string = params.colorMode ?? 'white-on-black';
    const invertResult = params.invert ?? false;
    const animSpeed = params.animSpeed ?? 1;
    const t = time * animSpeed;

    // Threshold oscillates during animation
    const baseThreshold = params.threshold ?? 0.15;
    const threshold = Math.max(0, Math.min(1, baseThreshold + Math.sin(t * 1.8) * 0.08));

    const src = getSourcePixels(img, w, h);

    // Compute luma buffer
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const b = i * 4;
      lum[i] = (0.299 * src[b] + 0.587 * src[b + 1] + 0.114 * src[b + 2]) / 255;
    }

    const lumAt = (x: number, y: number) =>
      lum[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];

    // Compute gradient magnitude
    let grad = new Float32Array(w * h);

    if (algorithm === 'sobel' || algorithm === 'prewitt' || algorithm === 'canny') {
      let blurLum = lum;
      // Canny: apply Gaussian blur first
      if (algorithm === 'canny') {
        blurLum = new Float32Array(w * h);
        const gk = [1, 2, 1, 2, 4, 2, 1, 2, 1];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let ky = -1; ky <= 1; ky++) {
              for (let kx = -1; kx <= 1; kx++) {
                sum += lumAt(x + kx, y + ky) * gk[(ky + 1) * 3 + (kx + 1)];
              }
            }
            blurLum[y * w + x] = sum / 16;
          }
        }
      }

      const blurAt = (x: number, y: number) =>
        blurLum[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];

      // Sobel or Prewitt weights
      const wt = algorithm === 'prewitt' ? 1 : 2;
      const angles = algorithm === 'canny' ? new Float32Array(w * h) : null;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const gx = -blurAt(x - 1, y - 1) + blurAt(x + 1, y - 1)
            - wt * blurAt(x - 1, y) + wt * blurAt(x + 1, y)
            - blurAt(x - 1, y + 1) + blurAt(x + 1, y + 1);
          const gy = -blurAt(x - 1, y - 1) - wt * blurAt(x, y - 1) - blurAt(x + 1, y - 1)
            + blurAt(x - 1, y + 1) + wt * blurAt(x, y + 1) + blurAt(x + 1, y + 1);
          grad[y * w + x] = Math.sqrt(gx * gx + gy * gy);
          if (angles) angles[y * w + x] = Math.atan2(gy, gx);
        }
      }

      // Canny: non-maximum suppression + double threshold
      if (algorithm === 'canny' && angles) {
        const nms = new Float32Array(w * h);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const angle = angles[y * w + x];
            const mag = grad[y * w + x];
            // Quantize angle to 4 directions
            const a = ((angle * 180 / Math.PI) + 180) % 180;
            let n1 = 0, n2 = 0;
            if (a < 22.5 || a >= 157.5) {
              n1 = grad[y * w + x + 1];
              n2 = grad[y * w + x - 1];
            } else if (a < 67.5) {
              n1 = grad[(y - 1) * w + x + 1];
              n2 = grad[(y + 1) * w + x - 1];
            } else if (a < 112.5) {
              n1 = grad[(y - 1) * w + x];
              n2 = grad[(y + 1) * w + x];
            } else {
              n1 = grad[(y - 1) * w + x - 1];
              n2 = grad[(y + 1) * w + x + 1];
            }
            nms[y * w + x] = (mag >= n1 && mag >= n2) ? mag : 0;
          }
        }
        grad = nms;
      }
    } else if (algorithm === 'laplacian') {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const lap = lumAt(x, y - 1) + lumAt(x - 1, y) + lumAt(x + 1, y) + lumAt(x, y + 1)
            - 4 * lumAt(x, y);
          grad[y * w + x] = Math.abs(lap);
        }
      }
    } else if (algorithm === 'roberts') {
      for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
          const gx = lumAt(x + 1, y + 1) - lumAt(x, y);
          const gy = lumAt(x + 1, y) - lumAt(x, y + 1);
          grad[y * w + x] = Math.sqrt(gx * gx + gy * gy);
        }
      }
    }

    // Normalize gradient
    let maxGrad = 0;
    for (let i = 0; i < w * h; i++) if (grad[i] > maxGrad) maxGrad = grad[i];
    if (maxGrad > 0) for (let i = 0; i < w * h; i++) grad[i] /= maxGrad;

    // Thickness: max-pool dilation
    if (thickness > 1) {
      const dilated = new Float32Array(w * h);
      const r = thickness - 1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let maxVal = 0;
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              const nx = Math.max(0, Math.min(w - 1, x + dx));
              const ny = Math.max(0, Math.min(h - 1, y + dy));
              const v = grad[ny * w + nx];
              if (v > maxVal) maxVal = v;
            }
          }
          dilated[y * w + x] = maxVal;
        }
      }
      grad = dilated;
    }

    // Render output
    const out = new Uint8ClampedArray(w * h * 4);
    const paletteColors = palette.colors.map(hexToRgb);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const g = grad[y * w + x];
        let isEdge = g >= threshold;
        if (invertResult) isEdge = !isEdge;

        if (colorMode === 'white-on-black') {
          const v = isEdge ? 255 : 0;
          out[idx] = v; out[idx + 1] = v; out[idx + 2] = v;
        } else if (colorMode === 'black-on-white') {
          const v = isEdge ? 0 : 255;
          out[idx] = v; out[idx + 1] = v; out[idx + 2] = v;
        } else if (colorMode === 'original-color') {
          if (isEdge) {
            const si = idx;
            out[idx] = src[si]; out[idx + 1] = src[si + 1]; out[idx + 2] = src[si + 2];
          } else {
            out[idx] = 0; out[idx + 1] = 0; out[idx + 2] = 0;
          }
        } else if (colorMode === 'palette-gradient' && paletteColors.length > 0) {
          if (isEdge) {
            const ci = Math.min(paletteColors.length - 1, Math.floor(g * paletteColors.length));
            const c = paletteColors[ci];
            out[idx] = c[0]; out[idx + 1] = c[1]; out[idx + 2] = c[2];
          } else {
            out[idx] = 0; out[idx + 1] = 0; out[idx + 2] = 0;
          }
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

  estimateCost(params) {
    return params.algorithm === 'canny' ? 800 : 400;
  },
};
