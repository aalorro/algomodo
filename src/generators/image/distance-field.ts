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

// ─── JFA distance field cache ─────────────────────────────────────────────────
const _jfaCache = new WeakMap<HTMLImageElement, {
  w: number; h: number; edgeThreshold: number;
  dist: Float32Array;
}>();

function computeJFA(
  src: Uint8ClampedArray, w: number, h: number, edgeThreshold: number
): Float32Array {
  // Step 1: Sobel edge detection → binary edge mask
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const b = i * 4;
    lum[i] = (0.299 * src[b] + 0.587 * src[b + 1] + 0.114 * src[b + 2]) / 255;
  }

  const lumAt = (x: number, y: number) =>
    lum[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];

  const edgeMask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = -lumAt(x - 1, y - 1) + lumAt(x + 1, y - 1)
        - 2 * lumAt(x - 1, y) + 2 * lumAt(x + 1, y)
        - lumAt(x - 1, y + 1) + lumAt(x + 1, y + 1);
      const gy = -lumAt(x - 1, y - 1) - 2 * lumAt(x, y - 1) - lumAt(x + 1, y - 1)
        + lumAt(x - 1, y + 1) + 2 * lumAt(x, y + 1) + lumAt(x + 1, y + 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag >= edgeThreshold) edgeMask[y * w + x] = 1;
    }
  }

  // Step 2: Init seed map — edge pixels store packed coords, non-edge = -1
  const seedMap = new Int32Array(w * h);
  seedMap.fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edgeMask[y * w + x]) {
        seedMap[y * w + x] = x | (y << 16);
      }
    }
  }

  // Step 3: Jump Flooding Algorithm
  const maxDim = Math.max(w, h);
  let stepSize = 1;
  while (stepSize < maxDim) stepSize <<= 1;

  while (stepSize >= 1) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        let bestSeed = seedMap[idx];
        let bestDist = Infinity;
        if (bestSeed !== -1) {
          const sx = bestSeed & 0xFFFF;
          const sy = bestSeed >>> 16;
          bestDist = (x - sx) * (x - sx) + (y - sy) * (y - sy);
        }

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx * stepSize;
            const ny = y + dy * stepSize;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const ns = seedMap[ny * w + nx];
            if (ns === -1) continue;
            const sx = ns & 0xFFFF;
            const sy = ns >>> 16;
            const d = (x - sx) * (x - sx) + (y - sy) * (y - sy);
            if (d < bestDist) {
              bestDist = d;
              bestSeed = ns;
            }
          }
        }
        seedMap[idx] = bestSeed;
      }
    }
    stepSize >>= 1;
  }

  // Step 4: Compute sqrt distances
  const dist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const s = seedMap[idx];
      if (s === -1) {
        dist[idx] = Math.sqrt(w * w + h * h);
      } else {
        const sx = s & 0xFFFF;
        const sy = s >>> 16;
        dist[idx] = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy));
      }
    }
  }

  return dist;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  edgeThreshold: {
    name: 'Edge Threshold',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.2,
    help: 'Sobel magnitude threshold for edge detection',
    group: 'Composition',
  },
  bandWidth: {
    name: 'Band Width',
    type: 'number',
    min: 1,
    max: 30,
    step: 1,
    default: 10,
    help: 'Width of distance bands in pixels',
    group: 'Geometry',
  },
  maxDistance: {
    name: 'Max Distance',
    type: 'number',
    min: 10,
    max: 200,
    step: 5,
    default: 80,
    help: 'Maximum distance for visualization scaling',
    group: 'Geometry',
  },
  displayMode: {
    name: 'Display Mode',
    type: 'select',
    options: ['smooth-gradient', 'bands', 'contour-lines', 'glow'],
    default: 'smooth-gradient',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['grayscale', 'palette-map', 'rainbow'],
    default: 'grayscale',
    group: 'Color',
  },
  invert: {
    name: 'Invert',
    type: 'boolean',
    default: false,
    help: 'Invert the distance field visualization',
    group: 'Composition',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 1,
    help: 'Controls scroll speed of the distance field animation',
    group: 'Flow/Motion',
  },
};

export const distanceField: Generator = {
  id: 'distance-field',
  family: 'image',
  styleName: 'Distance Field',
  definition: 'Computes a distance field from detected edges using the Jump Flooding Algorithm and visualizes it as gradients, bands, contour lines, or glow effects',
  algorithmNotes: 'Uses Sobel edge detection to create a binary edge mask, then computes the distance transform via Jump Flooding Algorithm (JFA) in O(n log n) instead of naive O(n²). JFA results are cached per image/dimensions/threshold. Visualization modes: smooth-gradient, alternating bands, thin contour lines, and exponential glow. Animation scrolls the distance offset over time.',
  parameterSchema,
  defaultParams: {
    edgeThreshold: 0.2,
    bandWidth: 10,
    maxDistance: 80,
    displayMode: 'smooth-gradient',
    colorMode: 'grayscale',
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

    const edgeThreshold = params.edgeThreshold ?? 0.2;
    const bandWidth = Math.max(1, params.bandWidth | 0);
    const maxDistance = Math.max(10, params.maxDistance ?? 80);
    const displayMode: string = params.displayMode ?? 'smooth-gradient';
    const colorMode: string = params.colorMode ?? 'grayscale';
    const invertResult = params.invert ?? false;
    const animSpeed = params.animSpeed ?? 1;
    const t = time * animSpeed;

    const src = getSourcePixels(img, w, h);

    // Check JFA cache
    let dist: Float32Array;
    const cached = _jfaCache.get(img);
    if (cached && cached.w === w && cached.h === h && cached.edgeThreshold === edgeThreshold) {
      dist = cached.dist;
    } else {
      dist = computeJFA(src, w, h, edgeThreshold);
      _jfaCache.set(img, { w, h, edgeThreshold, dist });
    }

    // Animation offset for scrolling effect
    const scrollOffset = t * 10;

    const out = new Uint8ClampedArray(w * h * 4);
    const paletteColors = palette.colors.map(hexToRgb);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const d = dist[y * w + x] + scrollOffset;

        let v = 0; // 0–1 brightness

        if (displayMode === 'smooth-gradient') {
          v = 1 - Math.min(1, d / maxDistance);
        } else if (displayMode === 'bands') {
          const band = Math.floor(d / bandWidth);
          v = (band & 1) ? 0.3 : 0.9;
          // Fade with distance
          v *= 1 - Math.min(1, dist[y * w + x] / maxDistance) * 0.5;
        } else if (displayMode === 'contour-lines') {
          const modD = d % bandWidth;
          v = (modD < 1.5 || modD > bandWidth - 1.5) ? 1 : 0.05;
          v *= 1 - Math.min(1, dist[y * w + x] / maxDistance) * 0.7;
        } else if (displayMode === 'glow') {
          v = Math.exp(-dist[y * w + x] / (maxDistance * 0.15));
        }

        if (invertResult) v = 1 - v;

        let r: number, g: number, b: number;

        if (colorMode === 'grayscale') {
          r = g = b = Math.round(v * 255);
        } else if (colorMode === 'palette-map' && paletteColors.length > 0) {
          const ci = Math.min(paletteColors.length - 1, Math.floor(v * paletteColors.length));
          const c = paletteColors[ci];
          r = c[0]; g = c[1]; b = c[2];
        } else {
          // rainbow — HSL hue sweep
          const hue = (d / maxDistance + t * 0.1) % 1;
          [r, g, b] = hslToRgb(hue, 0.8, v * 0.5);
        }

        out[idx] = r; out[idx + 1] = g; out[idx + 2] = b;
        out[idx + 3] = 255;
      }
    }

    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost() { return 1200; },
};
