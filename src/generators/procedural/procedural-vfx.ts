import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

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
    'Converts pixel coordinates to polar space and applies mode-specific warps: spiral arms twist angle by radius, ripple pulses concentric rings outward, tunnel maps depth via inverse radius for infinite zoom, kaleidoscope mirrors angular segments. Multiple domain-warp layers displace coordinates through simplex noise for organic flow. Chromatic aberration offsets RGB channel lookups in noise space for prismatic color splitting. All warps react to audio bass and mid energy.',
  parameterSchema,
  defaultParams: {
    warpMode: 'spiral', warpStrength: 2.0, layers: 3, symmetry: 1,
    chromaticShift: 0.15, zoom: 1.0, speed: 0.7, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const step = quality === 'draft' ? 3 : quality === 'ultra' ? 1 : 2;

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

    const noise = new SimplexNoise(seed);

    // Flatten palette into typed arrays
    const rawColors = palette.colors.map(hexToRgb);
    const nC = rawColors.length;
    const palR = new Uint8Array(nC);
    const palG = new Uint8Array(nC);
    const palB = new Uint8Array(nC);
    for (let i = 0; i < nC; i++) {
      palR[i] = rawColors[i][0];
      palG[i] = rawColors[i][1];
      palB[i] = rawColors[i][2];
    }
    const nCm1 = nC - 1;

    const halfW = w * 0.5;
    const halfH = h * 0.5;
    const invScale = zoomVal / (Math.min(w, h) * 0.5);
    const segAngle = sym > 1 ? TAU / sym : 0;

    const caOff = ca * 0.12;
    const doCa = ca > 0.01;

    // Precompute layer constants
    const layerFreq = new Float64Array(nLayers);
    const layerAmp = new Float64Array(nLayers);
    const layerOff = new Float64Array(nLayers);
    for (let l = 0; l < nLayers; l++) {
      layerFreq[l] = 1.5 + l * 0.8;
      layerAmp[l] = 0.4 / (1 + l * 0.5);
      layerOff[l] = l * 13.7;
    }

    // Mode-specific precomputed constants
    const warpAudio = 1 + audioBass * 2;
    const rippleFreq = 6 + audioMid * 4;
    const rotAngle = t * 0.2;
    const cosRot = Math.cos(rotAngle);
    const sinRot = Math.sin(rotAngle);

    // Image output
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const buf32 = new Uint32Array(data.buffer);
    data[0] = 1; data[1] = 2; data[2] = 3; data[3] = 4;
    const isLE = buf32[0] === 0x04030201;

    const cols = Math.ceil(w / step);
    const rows = Math.ceil(h / step);

    for (let gy = 0; gy < rows; gy++) {
      const py = gy * step;
      const cyRaw = (py - halfH) * invScale;

      for (let gx = 0; gx < cols; gx++) {
        const px = gx * step;
        const cxRaw = (px - halfW) * invScale;

        const rad = Math.sqrt(cxRaw * cxRaw + cyRaw * cyRaw);
        let ang = Math.atan2(cyRaw, cxRaw);

        // Symmetry fold
        if (sym > 1) {
          ang = ((ang % TAU) + TAU) % TAU;
          const seg = (ang / segAngle) | 0;
          ang = ang - seg * segAngle;
          if (seg & 1) ang = segAngle - ang;
        }

        // Warp mode → (u, v)
        let u: number, v: number;

        if (mode === 'spiral') {
          u = rad * 2;
          v = ang + rad * warpStr * warpAudio + t;
        } else if (mode === 'ripple') {
          const disp = Math.sin(rad * rippleFreq - t * 3) * warpStr * 0.3 * warpAudio;
          const invR = rad > 0.001 ? disp / rad : 0;
          u = cxRaw + cxRaw * invR;
          v = cyRaw + cyRaw * invR;
        } else if (mode === 'tunnel') {
          u = ang / TAU * 3;
          v = 0.5 / (rad + 0.01) + t * 2;
        } else {
          // kaleidoscope: rotating warp with sinusoidal displacement
          u = cxRaw * cosRot - cyRaw * sinRot + Math.sin(rad * 3 - t) * warpStr * 0.5;
          v = cxRaw * sinRot + cyRaw * cosRot + Math.cos(rad * 2 + t * 0.7) * warpStr * 0.5;
        }

        // Domain-warp layers: displace (u,v) through noise
        for (let l = 0; l < nLayers; l++) {
          const f = layerFreq[l];
          const am = layerAmp[l];
          const off = layerOff[l];
          const tShift = t * (0.08 + l * 0.02);
          const du = noise.noise2D(u * f + off, v * f + tShift) * am;
          const dv = noise.noise2D(u * f + off + 31.7, v * f + tShift + off) * am;
          u += du;
          v += dv;
        }

        // Final color via noise + palette
        const u2 = u * 2, v2 = v * 2;
        let rr: number, gg: number, bb: number;

        if (doCa) {
          // Chromatic aberration: offset fbm samples per channel
          let vR = noise.fbm(u2 + caOff, v2 + caOff * 0.5, 3, 2.0, 0.5) * 0.5 + 0.5;
          let vG = noise.fbm(u2, v2, 3, 2.0, 0.5) * 0.5 + 0.5;
          let vB = noise.fbm(u2 - caOff, v2 - caOff * 0.7, 3, 2.0, 0.5) * 0.5 + 0.5;

          if (vR < 0) vR = 0; else if (vR > 1) vR = 1;
          if (vG < 0) vG = 0; else if (vG > 1) vG = 1;
          if (vB < 0) vB = 0; else if (vB > 1) vB = 1;

          const ciR = vR * nCm1, i0R = ciR | 0, i1R = i0R < nCm1 ? i0R + 1 : nCm1, fR = ciR - i0R;
          const ciG = vG * nCm1, i0G = ciG | 0, i1G = i0G < nCm1 ? i0G + 1 : nCm1, fG = ciG - i0G;
          const ciB = vB * nCm1, i0B = ciB | 0, i1B = i0B < nCm1 ? i0B + 1 : nCm1, fB = ciB - i0B;

          rr = (palR[i0R] + (palR[i1R] - palR[i0R]) * fR) | 0;
          gg = (palG[i0G] + (palG[i1G] - palG[i0G]) * fG) | 0;
          bb = (palB[i0B] + (palB[i1B] - palB[i0B]) * fB) | 0;
        } else {
          let val = noise.fbm(u2, v2, 3, 2.0, 0.5) * 0.5 + 0.5;
          if (val < 0) val = 0; else if (val > 1) val = 1;

          const ci = val * nCm1, i0 = ci | 0, i1 = i0 < nCm1 ? i0 + 1 : nCm1, f = ci - i0;
          rr = (palR[i0] + (palR[i1] - palR[i0]) * f) | 0;
          gg = (palG[i0] + (palG[i1] - palG[i0]) * f) | 0;
          bb = (palB[i0] + (palB[i1] - palB[i0]) * f) | 0;
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
    const ca = (params.chromaticShift ?? 0.15) > 0.01 ? 3 : 1;
    return Math.round(layers * 80 * ca + 150);
  },
};
