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

// ─── Kernel definitions ──────────────────────────────────────────────────────
const KERNELS: Record<string, { k: number[]; divisor: number; bias: number }> = {
  sharpen:      { k: [0,-1,0, -1,5,-1, 0,-1,0],         divisor: 1,  bias: 0 },
  emboss:       { k: [-2,-1,0, -1,1,1, 0,1,2],           divisor: 1,  bias: 128 },
  'edge-enhance': { k: [0,-1,0, -1,6,-1, 0,-1,0],       divisor: 2,  bias: 0 },
  blur:         { k: [1,2,1, 2,4,2, 1,2,1],               divisor: 16, bias: 0 },
  'unsharp-mask': { k: [1,2,1, 2,4,2, 1,2,1],             divisor: 16, bias: 0 },
};

function applyKernel(
  src: Uint8ClampedArray, dst: Uint8ClampedArray,
  w: number, h: number,
  kernel: number[], divisor: number, bias: number, strength: number
) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.max(0, Math.min(w - 1, x + kx));
          const sy = Math.max(0, Math.min(h - 1, y + ky));
          const si = (sy * w + sx) * 4;
          const kv = kernel[(ky + 1) * 3 + (kx + 1)];
          r += src[si] * kv;
          g += src[si + 1] * kv;
          b += src[si + 2] * kv;
        }
      }
      const di = (y * w + x) * 4;
      const oi = di;
      const cr = r / divisor + bias;
      const cg = g / divisor + bias;
      const cb = b / divisor + bias;
      // Blend with original based on strength
      dst[oi]     = Math.max(0, Math.min(255, src[di] + (cr - src[di]) * strength));
      dst[oi + 1] = Math.max(0, Math.min(255, src[di + 1] + (cg - src[di + 1]) * strength));
      dst[oi + 2] = Math.max(0, Math.min(255, src[di + 2] + (cb - src[di + 2]) * strength));
      dst[oi + 3] = 255;
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  kernelType: {
    name: 'Kernel Type',
    type: 'select',
    options: ['sharpen', 'emboss', 'edge-enhance', 'blur', 'unsharp-mask'],
    default: 'sharpen',
    group: 'Composition',
  },
  strength: {
    name: 'Strength',
    type: 'number',
    min: 0,
    max: 3,
    step: 0.05,
    default: 1,
    help: 'How strongly the filter effect is applied',
    group: 'Composition',
  },
  passes: {
    name: 'Passes',
    type: 'number',
    min: 1,
    max: 5,
    step: 1,
    default: 1,
    help: 'Number of times the kernel is re-applied',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['original', 'grayscale', 'palette-map'],
    default: 'original',
    group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 1,
    help: 'Controls the speed of strength oscillation during animation',
    group: 'Flow/Motion',
  },
};

export const convolution: Generator = {
  id: 'convolution',
  family: 'image',
  styleName: 'Convolution Filter',
  definition: 'Applies classic 3x3 convolution kernels (sharpen, emboss, edge-enhance, blur, unsharp-mask) to the source image',
  algorithmNotes: 'Standard 3x3 kernel convolution on RGB channels. Multi-pass uses double-buffered arrays. Unsharp mask blurs first, then adds original + strength*(original - blurred). Animation oscillates the strength sinusoidally.',
  parameterSchema,
  defaultParams: {
    kernelType: 'sharpen',
    strength: 1,
    passes: 1,
    colorMode: 'original',
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

    const kernelType: string = params.kernelType ?? 'sharpen';
    const passes = Math.max(1, Math.min(5, params.passes | 0));
    const colorMode: string = params.colorMode ?? 'original';
    const animSpeed = params.animSpeed ?? 1;
    const t = time * animSpeed;

    // Strength oscillates during animation
    const baseStrength = params.strength ?? 1;
    const strength = baseStrength * (0.6 + 0.4 * Math.abs(Math.sin(t * 1.2)));

    const src = getSourcePixels(img, w, h);
    const size = w * h * 4;

    // Double-buffer for multi-pass
    let bufA = new Uint8ClampedArray(src);
    let bufB = new Uint8ClampedArray(size);

    const kDef = KERNELS[kernelType] ?? KERNELS.sharpen;

    if (kernelType === 'unsharp-mask') {
      // Unsharp mask: blur then sharpen
      const blurK = KERNELS.blur;
      for (let p = 0; p < passes; p++) {
        // Blur pass
        applyKernel(bufA, bufB, w, h, blurK.k, blurK.divisor, blurK.bias, 1);
        // Unsharp: original + strength * (original - blurred)
        for (let i = 0; i < size; i += 4) {
          bufB[i]     = Math.max(0, Math.min(255, bufA[i] + strength * (bufA[i] - bufB[i])));
          bufB[i + 1] = Math.max(0, Math.min(255, bufA[i + 1] + strength * (bufA[i + 1] - bufB[i + 1])));
          bufB[i + 2] = Math.max(0, Math.min(255, bufA[i + 2] + strength * (bufA[i + 2] - bufB[i + 2])));
          bufB[i + 3] = 255;
        }
        const tmp = bufA; bufA = bufB; bufB = tmp;
      }
    } else {
      for (let p = 0; p < passes; p++) {
        applyKernel(bufA, bufB, w, h, kDef.k, kDef.divisor, kDef.bias, strength);
        const tmp = bufA; bufA = bufB; bufB = tmp;
      }
    }

    // Apply color mode
    const out = bufA;
    if (colorMode === 'grayscale') {
      for (let i = 0; i < size; i += 4) {
        const l = Math.round(0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]);
        out[i] = l; out[i + 1] = l; out[i + 2] = l;
      }
    } else if (colorMode === 'palette-map') {
      const colors = palette.colors.map(hexToRgb);
      if (colors.length > 0) {
        for (let i = 0; i < size; i += 4) {
          const l = (0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]) / 255;
          const ci = Math.min(colors.length - 1, Math.floor(l * colors.length));
          const c = colors[ci];
          out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
        }
      }
    }

    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    const passes = params.passes ?? 1;
    const isUnsharp = params.kernelType === 'unsharp-mask';
    return 200 * passes * (isUnsharp ? 2 : 1);
  },
};
