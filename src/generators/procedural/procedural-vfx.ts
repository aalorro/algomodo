import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TAU = Math.PI * 2;

const parameterSchema: ParameterSchema = {
  warpMode: {
    name: 'Warp Mode', type: 'select',
    options: ['spiral', 'ripple', 'tunnel', 'kaleidoscope'],
    default: 'spiral',
    help: 'spiral: swirling arms | ripple: pulsing rings | tunnel: infinite zoom | kaleidoscope: mirrored folds',
    group: 'Composition',
  },
  warpStrength: {
    name: 'Warp Strength', type: 'number', min: 0.1, max: 5, step: 0.1, default: 2.0,
    help: 'Intensity of coordinate warping',
    group: 'Geometry',
  },
  layers: {
    name: 'Warp Layers', type: 'number', min: 1, max: 5, step: 1, default: 3,
    help: 'Domain-warp passes — more = richer organic flow',
    group: 'Composition',
  },
  symmetry: {
    name: 'Symmetry', type: 'number', min: 1, max: 12, step: 1, default: 1,
    help: 'Kaleidoscopic mirror folds (1 = off)',
    group: 'Geometry',
  },
  chromaticShift: {
    name: 'Chromatic Shift', type: 'number', min: 0, max: 1, step: 0.05, default: 0.15,
    help: 'RGB channel offset for prismatic color splitting',
    group: 'Color',
  },
  zoom: {
    name: 'Zoom', type: 'number', min: 0.3, max: 4, step: 0.1, default: 1.0,
    help: 'Zoom into the warp field',
    group: 'Geometry',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3, step: 0.05, default: 0.7,
    help: 'Animation drift speed',
    group: 'Flow/Motion',
  },
  reactivity: {
    name: 'Audio Reactivity', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0,
    help: 'Sensitivity to audio input (0 = none)',
    group: 'Flow/Motion',
  },
};

export const proceduralVfx: Generator = {
  id: 'procedural-vfx',
  family: 'procedural',
  styleName: 'Procedural VFX',
  definition: 'Coordinate-warp visual effects — spiral, tunnel, ripple, and kaleidoscope modes with chromatic aberration and multi-layer domain warping',
  algorithmNotes:
    'Converts pixel coordinates to polar space and applies mode-specific warps: spiral arms twist angle by radius, ripple pulses concentric rings outward, tunnel maps depth via inverse radius for infinite zoom, kaleidoscope mirrors angular segments. Multiple domain-warp layers displace coordinates through value noise for organic flow. Chromatic aberration offsets RGB channel lookups using already-computed noise values. All warps react to audio bass and mid energy.',
  parameterSchema,
  defaultParams: {
    warpMode: 'spiral', warpStrength: 2.0, layers: 3, symmetry: 1,
    chromaticShift: 0.15, zoom: 1.0, speed: 0.7, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : 2;

    const mode = params.warpMode || 'spiral';
    const warpStr = params.warpStrength ?? 2.0;
    const nLayers = Math.max(1, params.layers ?? 3) | 0;
    const sym = Math.max(1, params.symmetry ?? 1) | 0;
    const ca = params.chromaticShift ?? 0.15;
    const zoomVal = params.zoom ?? 1.0;
    const spd = params.speed ?? 0.7;
    const rx = params.reactivity ?? 1.0;

    const audioBass = (params._audioBass ?? 0) * rx;
    const audioMid = (params._audioMid ?? 0) * rx;

    const t = time * spd;

    // ── Fast hash-based value noise ──────────────────────────────
    // ~3× faster than SimplexNoise: no gradient conditionals,
    // simple smoothstep interpolation of hashed values.
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

    // Inline value noise: input any float coords, output [-1, 1]
    const vN = (x: number, y: number): number => {
      // Bias to ensure positive before integer truncation
      const xb = x + 65536, yb = y + 65536;
      const xi = xb | 0, yi = yb | 0;
      const fx = xb - xi, fy = yb - yi;
      const X = xi & 255, Y = yi & 255;
      // Smoothstep (Hermite)
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
    // Eliminates per-pixel palette interpolation: just index by value.
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

    // ── Precompute constants ─────────────────────────────────────
    const halfW = w * 0.5, halfH = h * 0.5;
    const invScale = zoomVal / (Math.min(w, h) * 0.5);
    const segAngle = sym > 1 ? TAU / sym : 0;

    const caScale = ca * 0.6;
    const doCa = ca > 0.01;

    // Mode → integer for fast dispatch (no per-pixel string comparison)
    const modeId = mode === 'spiral' ? 0 : mode === 'ripple' ? 1 : mode === 'tunnel' ? 2 : 3;

    // Mode-specific constants
    const warpAudio = 1 + audioBass * 2;
    const rippleFreq = 6 + audioMid * 4;
    const cosRot = Math.cos(t * 0.2);
    const sinRot = Math.sin(t * 0.2);

    // Cap warp layers by quality to reduce noise calls
    const maxLayers = Math.min(nLayers, quality === 'draft' ? 1 : quality === 'ultra' ? nLayers : 2);
    const layerFreq = new Float64Array(maxLayers);
    const layerAmp = new Float64Array(maxLayers);
    const layerOff = new Float64Array(maxLayers);
    const layerT = new Float64Array(maxLayers);
    for (let l = 0; l < maxLayers; l++) {
      layerFreq[l] = 1.5 + l * 0.8;
      layerAmp[l] = 0.4 / (1 + l * 0.5);
      layerOff[l] = l * 13.7;
      layerT[l] = t * (0.08 + l * 0.02);
    }

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
      const cyRaw = (py - halfH) * invScale;
      const cyRaw2 = cyRaw * cyRaw;

      for (let gx = 0; gx < cols; gx++) {
        const px = gx * step;
        const cxRaw = (px - halfW) * invScale;

        const radSq = cxRaw * cxRaw + cyRaw2;
        const rad = Math.sqrt(radSq);

        // Symmetry fold (only compute atan2 when needed)
        let ang = 0;
        if (sym > 1 || modeId === 0 || modeId === 2) {
          ang = Math.atan2(cyRaw, cxRaw);
          if (sym > 1) {
            ang = ((ang % TAU) + TAU) % TAU;
            const seg = (ang / segAngle) | 0;
            ang = ang - seg * segAngle;
            if (seg & 1) ang = segAngle - ang;
          }
        }

        // Warp mode → (u, v)
        let u: number, v: number;

        if (modeId === 0) {
          // spiral
          u = rad * 2;
          v = ang + rad * warpStr * warpAudio + t;
        } else if (modeId === 1) {
          // ripple
          const disp = Math.sin(rad * rippleFreq - t * 3) * warpStr * 0.3 * warpAudio;
          const invR = rad > 0.001 ? disp / rad : 0;
          if (sym > 1) {
            const cx2 = rad * Math.cos(ang);
            const cy2 = rad * Math.sin(ang);
            u = cx2 + cx2 * invR;
            v = cy2 + cy2 * invR;
          } else {
            u = cxRaw + cxRaw * invR;
            v = cyRaw + cyRaw * invR;
          }
        } else if (modeId === 2) {
          // tunnel
          u = ang / TAU * 3;
          v = 0.5 / (rad + 0.01) + t * 2;
        } else {
          // kaleidoscope
          let cx2 = cxRaw, cy2 = cyRaw;
          if (sym > 1) {
            cx2 = rad * Math.cos(ang);
            cy2 = rad * Math.sin(ang);
          }
          u = cx2 * cosRot - cy2 * sinRot + Math.sin(rad * 3 - t) * warpStr * 0.5;
          v = cx2 * sinRot + cy2 * cosRot + Math.cos(rad * 2 + t * 0.7) * warpStr * 0.5;
        }

        // Domain-warp layers (main noise cost — capped by quality)
        for (let l = 0; l < maxLayers; l++) {
          const f = layerFreq[l];
          const am = layerAmp[l];
          const off = layerOff[l];
          const lt = layerT[l];
          const du = vN(u * f + off, v * f + lt) * am;
          const dv = vN(u * f + off + 31.7, v * f + lt + off) * am;
          u += du;
          v += dv;
        }

        // Color: fbm(2 octaves) via value noise
        const u2 = u * 2, v2 = v * 2;
        const n1 = vN(u2, v2);
        const n2 = vN(u2 * 2, v2 * 2);
        // Normalize: fbm range is approx [-1.5, 1.5], map to [0, 1]
        let valG = (n1 + 0.5 * n2) * 0.5 + 0.5;
        if (valG < 0) valG = 0; else if (valG > 1) valG = 1;

        let rr: number, gg: number, bb: number;

        if (doCa) {
          // Chromatic aberration using already-computed noise values.
          // n2 (second octave) varies spatially → organic color fringing.
          // Zero additional noise calls.
          const shift = n2 * caScale;
          let valR = valG + shift;
          let valB = valG - shift;
          if (valR < 0) valR = 0; else if (valR > 1) valR = 1;
          if (valB < 0) valB = 0; else if (valB > 1) valB = 1;

          const idxR = (valR * 255) | 0;
          const idxG = (valG * 255) | 0;
          const idxB = (valB * 255) | 0;
          rr = rampR[idxR];
          gg = rampG[idxG];
          bb = rampB[idxB];
        } else {
          const idx = (valG * 255) | 0;
          rr = rampR[idx];
          gg = rampG[idx];
          bb = rampB[idx];
        }

        const pixel = isLE
          ? (0xFF000000 | (bb << 16) | (gg << 8) | rr)
          : ((rr << 24) | (gg << 16) | (bb << 8) | 0xFF);

        // Fill step×step block
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
    const layers = params.layers ?? 3;
    const ca = (params.chromaticShift ?? 0.15) > 0.01 ? 1.1 : 1;
    return Math.round(layers * 60 * ca + 100);
  },
};
