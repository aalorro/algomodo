import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  edgeMode: {
    name: 'Edge Mode', type: 'select',
    options: ['contour', 'gradient', 'ridge', 'circuit'],
    default: 'contour',
    help: 'contour: iso-line bands | gradient: edge detection | ridge: second-derivative edges | circuit: quantized hard steps',
    group: 'Composition',
  },
  noiseScale: {
    name: 'Noise Scale', type: 'number', min: 0.5, max: 8, step: 0.1, default: 3.0,
    help: 'Size of the noise field — lower = larger features',
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 5, step: 0.1, default: 1.5,
    help: 'Sharpness of edge lines — higher = broader glow',
    group: 'Texture',
  },
  glowRadius: {
    name: 'Glow Radius', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5,
    help: 'Soft glow falloff distance around edges',
    group: 'Texture',
  },
  glowIntensity: {
    name: 'Glow Intensity', type: 'number', min: 0.1, max: 2, step: 0.05, default: 0.8,
    help: 'Brightness multiplier for glow effect',
    group: 'Texture',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 4, step: 1, default: 2,
    help: 'FBM layers — more = finer edge detail',
    group: 'Composition',
  },
  quantize: {
    name: 'Quantize', type: 'number', min: 2, max: 16, step: 1, default: 6,
    help: 'Number of contour bands (contour + circuit modes)',
    group: 'Texture',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3, step: 0.05, default: 0.4,
    help: 'Animation drift speed',
    group: 'Flow/Motion',
  },
  reactivity: {
    name: 'Audio Reactivity', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0,
    help: 'Sensitivity to audio input (0 = none)',
    group: 'Flow/Motion',
  },
};

export const edgeGlow: Generator = {
  id: 'procedural-edge-glow',
  family: 'procedural',
  styleName: 'Edge + Glow',
  definition: 'Neon edge detection on noise fields — glowing contour lines, gradient edges, ridges, and circuit-board step patterns against dark backgrounds',
  algorithmNotes:
    'Evaluates multi-octave value noise (FBM) per pixel and detects edges via four methods: contour mode finds iso-lines at regular noise intervals using fractional banding; gradient mode computes edge strength from single-octave finite differences (FBM only for center value); ridge mode uses single-octave Laplacian for curvature peaks; circuit mode detects quantized step boundaries with single-octave neighbors. Edge strength is converted to glow brightness via a precomputed 256-entry power LUT, eliminating per-pixel Math.pow. Color is mapped from the palette ramp indexed by noise value, then multiplied by brightness. Audio bass modulates glow intensity, high modulates edge sharpness.',
  parameterSchema,
  defaultParams: {
    edgeMode: 'contour', noiseScale: 3.0, edgeWidth: 1.5, glowRadius: 0.5,
    glowIntensity: 0.8, octaves: 2, quantize: 6, speed: 0.4, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : 2;

    const mode = params.edgeMode || 'contour';
    const scl = params.noiseScale ?? 3.0;
    const edgeW = params.edgeWidth ?? 1.5;
    const glowR = params.glowRadius ?? 0.5;
    const glowI = params.glowIntensity ?? 0.8;
    const nOct = Math.max(1, params.octaves ?? 2) | 0;
    const Q = Math.max(2, params.quantize ?? 6) | 0;
    const spd = params.speed ?? 0.4;
    const rx = params.reactivity ?? 1.0;

    const audioBass = (params._audioBass ?? 0) * rx;
    const audioHigh = (params._audioHigh ?? 0) * rx;

    const t = time * spd;

    // Mode → integer
    const modeId = mode === 'contour' ? 0 : mode === 'gradient' ? 1 : mode === 'ridge' ? 2 : 3;

    // Audio modulations
    const effGlow = glowI * (1 + audioBass * 1.5);
    const effEdgeW = edgeW * (1 + audioHigh * 0.5);

    // ── Fast hash-based value noise ──────────────────────────────
    const rng = new SeededRNG(seed);
    const PERM = new Uint8Array(512);
    const VALS = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      PERM[i] = i;
      VALS[i] = rng.random() * 2 - 1;
    }
    for (let i = 255; i > 0; i--) {
      const j = (rng.random() * (i + 1)) | 0;
      const tmp = PERM[i]; PERM[i] = PERM[j]; PERM[j] = tmp;
    }
    for (let i = 0; i < 256; i++) PERM[i + 256] = PERM[i];

    const vN = (x: number, y: number): number => {
      const xb = x + 65536, yb = y + 65536;
      const xi = xb | 0, yi = yb | 0;
      const fx = xb - xi, fy = yb - yi;
      const X = xi & 255, Y = yi & 255;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const py0 = PERM[Y], py1 = PERM[Y + 1];
      const a = VALS[PERM[X + py0]];
      const b = VALS[PERM[X + 1 + py0]];
      const c = VALS[PERM[X + py1]];
      const d = VALS[PERM[X + 1 + py1]];
      const p = a + sx * (b - a);
      const q = c + sx * (d - c);
      return p + sy * (q - p);
    };

    // Quality-capped octaves
    const maxOct = Math.min(nOct, quality === 'draft' ? 1 : quality === 'ultra' ? nOct : 2);

    // Precompute FBM weights
    const fbmAmp = new Float64Array(maxOct);
    const fbmFreq = new Float64Array(maxOct);
    let fbmTotalW = 0;
    { let amp = 1, freq = 1;
      for (let o = 0; o < maxOct; o++) {
        fbmAmp[o] = amp;
        fbmFreq[o] = freq;
        fbmTotalW += amp;
        freq *= 2; amp *= 0.5;
      }
    }
    const fbmInvTotal = 1 / fbmTotalW;

    // FBM with precomputed weights — used only for center noise value
    const fbm = (x: number, y: number): number => {
      let val = 0;
      for (let o = 0; o < maxOct; o++) {
        val += vN(x * fbmFreq[o], y * fbmFreq[o]) * fbmAmp[o];
      }
      return val * fbmInvTotal;
    };

    // ── Precomputed palette ramp (256 entries) ───────────────────
    const rawColors = palette.colors.map(hexToRgb);
    const nC = rawColors.length;
    const nCm1 = nC - 1;
    const rampR = new Uint8Array(256);
    const rampG = new Uint8Array(256);
    const rampB = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const tv = i / 255;
      const ci = tv * nCm1;
      const i0 = ci | 0;
      const i1 = i0 < nCm1 ? i0 + 1 : nCm1;
      const f = ci - i0;
      rampR[i] = (rawColors[i0][0] + (rawColors[i1][0] - rawColors[i0][0]) * f) | 0;
      rampG[i] = (rawColors[i0][1] + (rawColors[i1][1] - rawColors[i0][1]) * f) | 0;
      rampB[i] = (rawColors[i0][2] + (rawColors[i1][2] - rawColors[i0][2]) * f) | 0;
    }

    // ── Precompute geometry ──────────────────────────────────────
    const halfW = w * 0.5, halfH = h * 0.5;
    const invDim = 1 / Math.min(w, h);
    const invDim2 = invDim * 2;

    // Finite-difference epsilon (in noise space)
    const eps = 0.02;
    const circuitEps = eps * 3;

    // ── Precomputed brightness LUT — eliminates per-pixel Math.pow ──
    const glowPow = 1 / Math.max(0.1, effEdgeW);
    const hasGlowR = glowR > 0.01;
    const glowFalloff = hasGlowR ? 4 / glowR : 100;
    const ambientGlow = hasGlowR ? Math.exp(-glowFalloff) * effGlow * 0.1 : 0;

    const brightnessLUT = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const edge = i / 255;
      if (edge > 0.004) { // ~= 1/255
        const sharp = Math.pow(edge, glowPow);
        const soft = hasGlowR ? Math.exp(-((1 - edge) * glowFalloff)) * 0.3 : 0;
        let b = (sharp + soft) * effGlow;
        if (b > 1) b = 1;
        brightnessLUT[i] = b;
      } else {
        brightnessLUT[i] = ambientGlow > 1 ? 1 : ambientGlow;
      }
    }

    // Time offset
    const tOff = t * 0.15;

    // ── Image output buffer ──────────────────────────────────────
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const buf32 = new Uint32Array(data.buffer);
    data[0] = 1; data[1] = 2; data[2] = 3; data[3] = 4;
    const isLE = buf32[0] === 0x04030201;

    const cols = Math.ceil(w / step);
    const rows = Math.ceil(h / step);

    // ── Main pixel loop ──────────────────────────────────────────
    for (let gy = 0; gy < rows; gy++) {
      const py = gy * step;
      const v = (py - halfH) * invDim2;

      for (let gx = 0; gx < cols; gx++) {
        const px = gx * step;
        const u = (px - halfW) * invDim2;

        // Noise coordinates
        const nx = u * scl;
        const ny = v * scl + tOff;

        // Center noise — uses FBM (maxOct vN calls)
        const n = fbm(nx, ny);

        // Compute edge strength by mode
        // Gradient/ridge/circuit: use single vN for neighbors (not FBM)
        // This saves (maxOct-1)*N vN calls per pixel
        let edge: number;

        if (modeId === 0) {
          // contour — iso-line banding (0 extra vN calls)
          const band = n * Q;
          const frac = band - Math.floor(band);
          edge = 1 - Math.abs(frac * 2 - 1);
          edge = edge * edge * edge;
        } else if (modeId === 1) {
          // gradient — single-octave finite differences (+4 vN calls)
          const gx2 = vN(nx + eps, ny) - vN(nx - eps, ny);
          const gy2 = vN(nx, ny + eps) - vN(nx, ny - eps);
          edge = Math.sqrt(gx2 * gx2 + gy2 * gy2) / (eps * 2);
          if (edge > 1) edge = 1; else edge *= 1.5;
          if (edge > 1) edge = 1;
        } else if (modeId === 2) {
          // ridge — single-octave Laplacian (+4 vN calls)
          const nPx = vN(nx + eps, ny);
          const nMx = vN(nx - eps, ny);
          const nPy = vN(nx, ny + eps);
          const nMy = vN(nx, ny - eps);
          const laplacian = nPx + nMx + nPy + nMy - 4 * n;
          edge = Math.abs(laplacian) / (eps * eps) * 0.15;
          if (edge > 1) edge = 1;
        } else {
          // circuit — single-octave neighbors (+2 vN calls)
          const nRight = vN(nx + circuitEps, ny);
          const nDown = vN(nx, ny + circuitEps);
          const q1 = (n * 0.5 + 0.5) * Q | 0;
          const q2 = (nRight * 0.5 + 0.5) * Q | 0;
          const q3 = (nDown * 0.5 + 0.5) * Q | 0;
          edge = (q1 !== q2 || q1 !== q3) ? 1 : 0;
        }

        // Brightness from LUT — no per-pixel pow/exp
        const edgeIdx = (edge * 255) | 0;
        const brightness = brightnessLUT[edgeIdx < 256 ? edgeIdx : 255];

        // Color from palette indexed by noise value
        let colorVal = n * 0.5 + 0.5;
        if (colorVal < 0) colorVal = 0; else if (colorVal > 1) colorVal = 1;
        const idx = (colorVal * 255) | 0;

        const rr = (rampR[idx] * brightness) | 0;
        const gg = (rampG[idx] * brightness) | 0;
        const bb = (rampB[idx] * brightness) | 0;

        const pixel = isLE
          ? (0xFF000000 | (bb << 16) | (gg << 8) | rr)
          : ((rr << 24) | (gg << 16) | (bb << 8) | 0xFF);

        if (step === 1) {
          buf32[py * w + px] = pixel;
        } else {
          const maxDy = Math.min(step, h - py);
          const maxDx = Math.min(step, w - px);
          for (let dy = 0; dy < maxDy; dy++) {
            const rowBase = (py + dy) * w + px;
            for (let dx = 0; dx < maxDx; dx++) {
              buf32[rowBase + dx] = pixel;
            }
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    const oct = params.octaves ?? 2;
    const mode = params.edgeMode || 'contour';
    const modeMult = mode === 'contour' ? 1 : mode === 'gradient' ? 1.5 : mode === 'ridge' ? 1.5 : 1.3;
    return Math.round(oct * 60 * modeMult + 80);
  },
};
