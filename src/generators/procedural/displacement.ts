import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TAU = Math.PI * 2;

const parameterSchema: ParameterSchema = {
  mode: {
    name: 'Mode', type: 'select',
    options: ['flow', 'fracture', 'radial', 'wave'],
    default: 'flow',
    help: 'flow: smooth organic distortion | fracture: sharp blocky offsets | radial: ripples from center | wave: sinusoidal displacement bands',
    group: 'Composition',
  },
  strength: {
    name: 'Strength', type: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.15,
    help: 'How far pixels are displaced from their original position',
    group: 'Geometry',
  },
  scale: {
    name: 'Scale', type: 'number', min: 0.5, max: 8, step: 0.1, default: 2.0,
    help: 'Size of the displacement noise field — lower = larger features',
    group: 'Geometry',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 5, step: 1, default: 3,
    help: 'FBM layers — more = finer detail in displacement',
    group: 'Composition',
  },
  distortion: {
    name: 'Distortion', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Secondary domain warp before displacement lookup',
    group: 'Texture',
  },
  chromaticShift: {
    name: 'Chromatic Shift', type: 'number', min: 0, max: 1, step: 0.05, default: 0.1,
    help: 'RGB channel offset for prismatic color splitting',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3, step: 0.05, default: 0.5,
    help: 'Animation drift speed',
    group: 'Flow/Motion',
  },
  reactivity: {
    name: 'Audio Reactivity', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0,
    help: 'Sensitivity to audio input (0 = none)',
    group: 'Flow/Motion',
  },
};

export const displacement: Generator = {
  id: 'procedural-displacement',
  family: 'procedural',
  styleName: 'Displacement',
  definition: 'Noise-driven UV displacement mapping — pixels are offset through vector fields to create organic distortion, fracture, radial ripple, and wave effects',
  algorithmNotes:
    'Computes a 2D displacement vector per pixel from multi-octave value noise (FBM). Flow mode applies smooth continuous displacement; fracture quantizes noise to create hard blocky edges; radial scales displacement by distance from center for ripple patterns; wave wraps noise through sinusoidal functions for banded distortion. Color is derived from displacement noise values with a single extra lookup, avoiding redundant evaluations. Chromatic aberration offsets RGB channels along the displacement gradient. Distortion warp is skipped when the distortion parameter is near zero. Audio bass modulates displacement strength, mid modulates field scale.',
  parameterSchema,
  defaultParams: {
    mode: 'flow', strength: 0.15, scale: 2.0, octaves: 3,
    distortion: 0.3, chromaticShift: 0.1, speed: 0.5, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : 2;

    const mode = params.mode || 'flow';
    const str = params.strength ?? 0.15;
    const scl = params.scale ?? 2.0;
    const nOct = Math.max(1, params.octaves ?? 3) | 0;
    const dist = params.distortion ?? 0.3;
    const ca = params.chromaticShift ?? 0.1;
    const spd = params.speed ?? 0.5;
    const rx = params.reactivity ?? 1.0;

    const audioBass = (params._audioBass ?? 0) * rx;
    const audioMid = (params._audioMid ?? 0) * rx;

    const t = time * spd;

    // Mode → integer
    const modeId = mode === 'flow' ? 0 : mode === 'fracture' ? 1 : mode === 'radial' ? 2 : 3;

    // Audio modulations
    const effStr = str * (1 + audioBass * 3);
    const effScl = scl * (1 + audioMid * 0.5);

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
    const caScale = ca * 0.5;
    const doCa = ca > 0.01;
    const doDist = dist > 0.01;
    const warpAmt = dist * 0.5;

    // Quality-capped octaves
    const maxOct = Math.min(nOct, quality === 'draft' ? 1 : quality === 'ultra' ? nOct : 2);

    // Precompute FBM weights — avoid per-call division
    const fbmAmp = new Float64Array(maxOct);
    const fbmFreq = new Float64Array(maxOct);
    let fbmTotal = 0;
    { let amp = 1, freq = 1;
      for (let o = 0; o < maxOct; o++) {
        fbmAmp[o] = amp;
        fbmFreq[o] = freq;
        fbmTotal += amp;
        freq *= 2; amp *= 0.5;
      }
    }
    const fbmInvTotal = 1 / fbmTotal;

    // Inline FBM with precomputed weights
    const fbm = (x: number, y: number): number => {
      let val = 0;
      for (let o = 0; o < maxOct; o++) {
        val += vN(x * fbmFreq[o], y * fbmFreq[o]) * fbmAmp[o];
      }
      return val * fbmInvTotal;
    };

    // Precompute per-mode constants
    const fractQ = 4 + dist * 8;
    const fractInvQ = 1 / fractQ;
    const radialFreq = TAU * (2 + dist * 6);
    const radialTimeOff = t * 3;
    const waveFreq = 3 + dist * 10;
    const waveT1 = t * 2;
    const waveT2 = t * 1.5;

    // Precompute color lookup scale
    const colorScl = effScl * 2;

    // Time offsets for displacement FBM
    const tOff1x = t * 0.1;
    const tOff1y = t * 0.07;
    const tOff2x = t * 0.07;
    const tOff2y = t * 0.1;

    // Distortion noise scale
    const distNScl = effScl * 2.5;

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

        // Coordinates in noise space
        const nx = u * effScl;
        const ny = v * effScl;

        // Displacement FBM — 2 * maxOct vN calls
        const n1 = fbm(nx + tOff1x, ny + tOff1y);
        const n2 = fbm(nx + 31.7 + tOff2x, ny + 17.3 + tOff2y);

        // Compute displacement vector by mode
        let dx: number, dy: number;

        if (modeId === 0) {
          dx = n1;
          dy = n2;
        } else if (modeId === 1) {
          dx = ((n1 * fractQ) | 0) * fractInvQ;
          dy = ((n2 * fractQ) | 0) * fractInvQ;
        } else if (modeId === 2) {
          const rad = Math.sqrt(u * u + v * v);
          const radMod = Math.sin(rad * radialFreq - radialTimeOff) * rad;
          dx = n1 * radMod;
          dy = n2 * radMod;
        } else {
          dx = Math.sin(n1 * waveFreq + waveT1) * 0.5;
          dy = Math.cos(n2 * waveFreq + waveT2) * 0.5;
        }

        // Displaced coordinate
        let wu = u + dx * effStr;
        let wv = v + dy * effStr;

        // Optional distortion — skip entirely when dist ≈ 0
        if (doDist) {
          const dnx = nx * distNScl;
          const dny = ny * distNScl;
          wu += vN(dnx + 50, dny) * warpAmt;
          wv += vN(dnx, dny + 50) * warpAmt;
        }

        // Color: 1 vN call at displaced coord + reuse n2 for second octave
        // Instead of 2 separate vN calls, derive color from displaced lookup + n2
        const cn1 = vN(wu * colorScl, wv * colorScl);
        let valG = (cn1 + 0.5 * n2) * 0.5 + 0.5;
        if (valG < 0) valG = 0; else if (valG > 1) valG = 1;

        let rr: number, gg: number, bb: number;

        if (doCa) {
          const shift = n2 * caScale;
          let valR = valG + shift;
          let valB = valG - shift;
          if (valR < 0) valR = 0; else if (valR > 1) valR = 1;
          if (valB < 0) valB = 0; else if (valB > 1) valB = 1;
          rr = rampR[(valR * 255) | 0];
          gg = rampG[(valG * 255) | 0];
          bb = rampB[(valB * 255) | 0];
        } else {
          const idx = (valG * 255) | 0;
          rr = rampR[idx];
          gg = rampG[idx];
          bb = rampB[idx];
        }

        const pixel = isLE
          ? (0xFF000000 | (bb << 16) | (gg << 8) | rr)
          : ((rr << 24) | (gg << 16) | (bb << 8) | 0xFF);

        if (step === 1) {
          buf32[py * w + px] = pixel;
        } else {
          const maxDy = Math.min(step, h - py);
          const maxDx = Math.min(step, w - px);
          for (let dy2 = 0; dy2 < maxDy; dy2++) {
            const rowBase = (py + dy2) * w + px;
            for (let dx2 = 0; dx2 < maxDx; dx2++) {
              buf32[rowBase + dx2] = pixel;
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
    const oct = params.octaves ?? 3;
    const ca = (params.chromaticShift ?? 0.1) > 0.01 ? 1.1 : 1;
    return Math.round(oct * 80 * ca + 80);
  },
};
