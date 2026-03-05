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

// ─── Wang hash for fast per-pixel deterministic randomness ────────────────────
function wangHash(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return n;
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  mode: {
    name: 'Mode',
    type: 'select',
    options: ['wave-warp', 'pixel-scatter', 'slice-shift', 'mirror-glitch'],
    default: 'wave-warp',
    group: 'Composition',
  },
  intensity: {
    name: 'Intensity',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
    help: 'Overall distortion intensity',
    group: 'Composition',
  },
  waveFreq: {
    name: 'Wave Freq',
    type: 'number',
    min: 1,
    max: 20,
    step: 0.5,
    default: 6,
    help: 'Frequency of wave distortion (wave-warp mode)',
    group: 'Geometry',
  },
  sliceCount: {
    name: 'Slice Count',
    type: 'number',
    min: 2,
    max: 60,
    step: 1,
    default: 20,
    help: 'Number of horizontal slices (slice-shift / mirror-glitch mode)',
    group: 'Geometry',
  },
  chromaticAberration: {
    name: 'Chromatic Aberration',
    type: 'number',
    min: 0,
    max: 30,
    step: 1,
    default: 5,
    help: 'RGB channel separation in pixels',
    group: 'Texture',
  },
  mirror: {
    name: 'Mirror',
    type: 'boolean',
    default: false,
    help: 'Mirror the distorted image horizontally',
    group: 'Composition',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 1,
    help: 'Controls distortion animation speed',
    group: 'Flow/Motion',
  },
};

export const glitchTransform: Generator = {
  id: 'glitch-transform',
  family: 'image',
  styleName: 'Glitch Transform',
  definition: 'Applies geometric distortions (wave warp, pixel scatter, slice shift, mirror glitch) with chromatic aberration for a digital glitch aesthetic',
  algorithmNotes: 'Distinct from data-mosh: focuses on geometric distortion rather than codec corruption. Wave-warp uses sinusoidal per-pixel displacement. Pixel-scatter uses Wang hash for fast deterministic random displacement. Slice-shift offsets horizontal bands (VHS tracking error). Mirror-glitch randomly flips horizontal bands. All modes layer chromatic aberration (R shifted left, B shifted right).',
  parameterSchema,
  defaultParams: {
    mode: 'wave-warp',
    intensity: 0.5,
    waveFreq: 6,
    sliceCount: 20,
    chromaticAberration: 5,
    mirror: false,
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

    const mode: string = params.mode ?? 'wave-warp';
    const intensity = params.intensity ?? 0.5;
    const waveFreq = params.waveFreq ?? 6;
    const sliceCount = Math.max(2, params.sliceCount | 0);
    const chromatic = params.chromaticAberration ?? 5;
    const doMirror = params.mirror ?? false;
    const animSpeed = params.animSpeed ?? 1;
    const t = time * animSpeed;

    const src = getSourcePixels(img, w, h);
    const out = new Uint8ClampedArray(w * h * 4);

    const amp = intensity * w * 0.1;

    const clampX = (v: number) => Math.max(0, Math.min(w - 1, v | 0));
    const clampY = (v: number) => Math.max(0, Math.min(h - 1, v | 0));

    const sampleCh = (sx: number, sy: number, ch: number) =>
      src[(clampY(sy) * w + clampX(sx)) * 4 + ch];

    if (mode === 'wave-warp') {
      const freq = waveFreq * 0.02;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = Math.sin(y * freq + t * 3) * amp;
          const dy = Math.cos(x * freq + t * 2.3) * amp * 0.5;
          const sx = x + dx;
          const sy = y + dy;
          const idx = (y * w + x) * 4;
          out[idx]     = sampleCh(sx - chromatic, sy, 0);
          out[idx + 1] = sampleCh(sx, sy, 1);
          out[idx + 2] = sampleCh(sx + chromatic, sy, 2);
          out[idx + 3] = 255;
        }
      }
    } else if (mode === 'pixel-scatter') {
      const frameSeed = seed + (Math.floor(t * 10) | 0);
      const scatterAmp = amp * 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const hash = wangHash(x + y * w + frameSeed);
          const dx = ((hash & 0xFFFF) / 0xFFFF - 0.5) * scatterAmp;
          const dy = (((hash >>> 16) & 0xFFFF) / 0xFFFF - 0.5) * scatterAmp;
          const sx = x + dx;
          const sy = y + dy;
          const idx = (y * w + x) * 4;
          out[idx]     = sampleCh(sx - chromatic, sy, 0);
          out[idx + 1] = sampleCh(sx, sy, 1);
          out[idx + 2] = sampleCh(sx + chromatic, sy, 2);
          out[idx + 3] = 255;
        }
      }
    } else if (mode === 'slice-shift') {
      const sliceH = Math.max(1, Math.floor(h / sliceCount));
      const rng = new SeededRNG(seed + (Math.floor(t * 8) | 0));
      const offsets = new Float32Array(sliceCount);
      for (let i = 0; i < sliceCount; i++) {
        offsets[i] = rng.range(-amp * 2, amp * 2) + Math.sin(t * 2 + i * 0.7) * amp * 0.5;
      }
      for (let y = 0; y < h; y++) {
        const sliceIdx = Math.min(sliceCount - 1, (y / sliceH) | 0);
        const dx = offsets[sliceIdx];
        for (let x = 0; x < w; x++) {
          const sx = x + dx;
          const idx = (y * w + x) * 4;
          out[idx]     = sampleCh(sx - chromatic, y, 0);
          out[idx + 1] = sampleCh(sx, y, 1);
          out[idx + 2] = sampleCh(sx + chromatic, y, 2);
          out[idx + 3] = 255;
        }
      }
    } else if (mode === 'mirror-glitch') {
      const sliceH = Math.max(1, Math.floor(h / sliceCount));
      const rng = new SeededRNG(seed + (Math.floor(t * 6) | 0));
      const flipFlags = new Uint8Array(sliceCount);
      for (let i = 0; i < sliceCount; i++) {
        flipFlags[i] = rng.random() < intensity ? 1 : 0;
      }
      for (let y = 0; y < h; y++) {
        const sliceIdx = Math.min(sliceCount - 1, (y / sliceH) | 0);
        const flip = flipFlags[sliceIdx];
        for (let x = 0; x < w; x++) {
          const sx = flip ? w - 1 - x : x;
          const idx = (y * w + x) * 4;
          out[idx]     = sampleCh(sx - chromatic, y, 0);
          out[idx + 1] = sampleCh(sx, y, 1);
          out[idx + 2] = sampleCh(sx + chromatic, y, 2);
          out[idx + 3] = 255;
        }
      }
    }

    // Global mirror
    if (doMirror) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w / 2; x++) {
          const li = (y * w + x) * 4;
          const ri = (y * w + (w - 1 - x)) * 4;
          out[ri]     = out[li];
          out[ri + 1] = out[li + 1];
          out[ri + 2] = out[li + 2];
        }
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
