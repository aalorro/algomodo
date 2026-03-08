import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ─── Attractor maps ───────────────────────────────────────────────────────────

function iterateClifford(x: number, y: number, a: number, b: number, c: number, d: number): [number, number] {
  return [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y)];
}

function iterateDeJong(x: number, y: number, a: number, b: number, c: number, d: number): [number, number] {
  return [Math.sin(a * y) - Math.cos(b * x), Math.sin(c * x) - Math.cos(d * y)];
}

function iterateBedhead(x: number, y: number, a: number, b: number): [number, number] {
  // Guard: b must not be 0
  const sb = Math.abs(b) < 0.01 ? 0.01 : b;
  return [Math.sin(x * y / sb) * y + Math.cos(a * x - y), x + Math.sin(y) / sb];
}

// Svensson: visually related to De Jong but with a distinct flame-like structure
function iterateSvensson(x: number, y: number, a: number, b: number, c: number, d: number): [number, number] {
  return [d * Math.sin(a * x) - Math.sin(b * y), c * Math.cos(a * x) + Math.cos(b * y)];
}

// Tinkerbell: quadratic map — very different topology from the sine-based ones
function iterateTinkerbell(x: number, y: number, a: number, b: number, c: number, d: number): [number, number] {
  return [x * x - y * y + a * x + b * y, 2 * x * y + c * x + d * y];
}

function iteratePoint(
  type: string,
  x: number, y: number,
  a: number, b: number, c: number, d: number,
): [number, number] {
  switch (type) {
    case 'clifford':   return iterateClifford(x, y, a, b, c, d);
    case 'bedhead':    return iterateBedhead(x, y, a, b);
    case 'svensson':   return iterateSvensson(x, y, a, b, c, d);
    case 'tinkerbell': return iterateTinkerbell(x, y, a, b, c, d);
    default:           return iterateDeJong(x, y, a, b, c, d);
  }
}

// ─── Seeded parameter presets ─────────────────────────────────────────────────

function getPreset(seed: number, type: string): [number, number, number, number] {
  const rng = new SeededRNG(seed);
  switch (type) {
    case 'clifford':
      return [rng.range(-2, 2), rng.range(-2, 2), rng.range(-1.5, 1.5), rng.range(-1.5, 1.5)];
    case 'bedhead':
      // b must be away from 0; keep a in a range that produces spirals
      return [
        rng.range(-0.9, 0.9),
        (rng.random() > 0.5 ? 1 : -1) * rng.range(0.3, 0.95),
        rng.range(-1.5, 1.5),
        rng.range(-1.5, 1.5),
      ];
    case 'svensson':
      return [rng.range(-3, 3), rng.range(-3, 3), rng.range(-2, 2), rng.range(-2, 2)];
    case 'tinkerbell':
      // Stay close to the known stable attractor basin (classic: -0.3, -0.6, 2, 0.5)
      return [
        rng.range(-0.4, -0.1),
        rng.range(-0.75, -0.5),
        rng.range(1.85, 2.1),
        rng.range(0.45, 0.58),
      ];
    default: // dejong
      return [rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3)];
  }
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  attractorType: {
    name: 'Attractor Type',
    type: 'select',
    options: ['clifford', 'dejong', 'bedhead', 'svensson', 'tinkerbell'],
    default: 'clifford',
    help: 'clifford / dejong / bedhead: classic sine-based maps · svensson: flame-like variant · tinkerbell: quadratic map with different topology',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations (×1000)',
    type: 'number', min: 100, max: 2000, step: 100, default: 800,
    help: 'More iterations = denser histogram; lower values improve animation frame-rate',
    group: 'Composition',
  },
  brightness: {
    name: 'Brightness',
    type: 'number', min: 0.5, max: 4, step: 0.1, default: 1.5,
    help: 'Log tone-map exponent — higher lifts dim regions brighter but clips peaks',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['density', 'velocity', 'angle', 'multi'],
    default: 'density',
    help: 'density: brightness→palette gradient · velocity: local speed · angle: movement direction · multi: overlapping offset layers, each in a distinct palette color',
    group: 'Color',
  },
  colorShift: {
    name: 'Color Shift',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0,
    help: 'Slide the palette lookup slowly over time — animates colour bands without changing the attractor shape',
    group: 'Color',
  },
  pointSize: {
    name: 'Point Size',
    type: 'number', min: 1, max: 4, step: 1, default: 1,
    group: 'Geometry',
  },
  driftSpeed: {
    name: 'Drift Speed',
    type: 'number', min: 0, max: 1.0, step: 0.05, default: 0.2,
    help: 'How fast the attractor parameters oscillate over time — each at a distinct seeded frequency',
    group: 'Flow/Motion',
  },
  driftAmp: {
    name: 'Drift Amplitude',
    type: 'number', min: 0, max: 0.5, step: 0.02, default: 0.15,
    help: 'Maximum ±offset on each parameter during animation — larger = more extreme morphing',
    group: 'Flow/Motion',
  },
};

// ─── Generator ────────────────────────────────────────────────────────────────

export const attractorTrails: Generator = {
  id: 'attractor-trails',
  family: 'animation',
  styleName: 'Attractor Trails',
  definition: 'Strange attractors — Clifford, De Jong, Bedhead, Svensson, Tinkerbell — rendered via density histograms with sub-pixel anti-aliasing',
  algorithmNotes:
    'Points are iterated through a seeded chaotic map. A 2D density histogram is built using ' +
    'bilinear splatting (sub-pixel AA) — points are distributed across their four nearest pixels ' +
    'by fractional weight, eliminating pixel-grid jaggies. The histogram is log-tone-mapped and ' +
    'coloured by mode: density (brightness→palette), velocity (speed per bin), angle (movement ' +
    'direction cycles the palette), or multi (up to four offset-parameter layers each assigned a ' +
    'different palette colour). Color Shift slides the palette lookup over time for animated colour ' +
    'bands with a static shape. Tinkerbell uses a divergence guard to keep the orbit bounded.',
  parameterSchema,
  defaultParams: {
    attractorType: 'clifford', iterations: 800, brightness: 1.5,
    colorMode: 'density', colorShift: 0, pointSize: 1,
    driftSpeed: 0.2, driftAmp: 0.15,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { attractorType, iterations, brightness, colorMode, pointSize } = params;
    const colorShift  = params.colorShift ?? 0;
    const driftSpeed  = params.driftSpeed ?? 0.2;
    const driftAmp    = params.driftAmp   ?? 0.15;

    const isAnimating  = time !== 0;
    const animScale    = isAnimating ? 0.2 : 1;
    const qualityScale = quality === 'ultra' ? 2 : quality === 'draft' ? 0.3 : 1;
    const iters        = (iterations * 1000 * animScale * qualityScale) | 0;

    // ── Compute (possibly drifted) parameters ──────────────────────────────
    let [a, b, c, d] = getPreset(seed, attractorType);

    if (isAnimating && driftAmp > 0) {
      const driftRng = new SeededRNG(seed ^ 0xabcd1234);
      const phases   = [driftRng.random() * Math.PI * 2, driftRng.random() * Math.PI * 2,
                        driftRng.random() * Math.PI * 2, driftRng.random() * Math.PI * 2];
      const freqs    = [0.37, 0.53, 0.29, 0.61];
      a += driftAmp * Math.sin(time * driftSpeed * freqs[0] + phases[0]);
      b += driftAmp * Math.cos(time * driftSpeed * freqs[1] + phases[1]);
      c += driftAmp * Math.sin(time * driftSpeed * freqs[2] + phases[2]);
      d += driftAmp * Math.cos(time * driftSpeed * freqs[3] + phases[3]);
    }

    // ── Colour-shift: slide palette lookup phase with time ─────────────────
    const shiftPhase = (time * colorShift * 0.12) % 1; // cycles slowly

    // ── Bounds discovery: 50k warmup, skip first 500 ──────────────────────
    let x = 0.1, y = 0.1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 50_000; i++) {
      [x, y] = iteratePoint(attractorType, x, y, a, b, c, d);
      // Tinkerbell divergence guard
      if (attractorType === 'tinkerbell' && (Math.abs(x) > 20 || Math.abs(y) > 20)) {
        x = 0.1 + (i & 7) * 0.03; y = 0.1 - (i & 3) * 0.02;
      }
      if (i > 500) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }

    const pad    = 0.05;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const margin = Math.min(w, h) * pad;

    const toPixelX = (v: number) => margin + ((v - minX) / rangeX) * (w - 2 * margin);
    const toPixelY = (v: number) => margin + ((v - minY) / rangeY) * (h - 2 * margin);

    // ── Allocate histogram arrays ─────────────────────────────────────────
    const size  = w * h;
    const hist  = new Float32Array(size); // density (bilinear-weighted hit count)

    // Secondary per-mode accumulators
    const isAngle    = colorMode === 'angle';
    const isVelocity = colorMode === 'velocity';
    const isMulti    = colorMode === 'multi';

    const velSum    = (isVelocity)           ? new Float32Array(size) : null;
    const angSinSum = (isAngle)              ? new Float32Array(size) : null;
    const angCosSum = (isAngle)              ? new Float32Array(size) : null;
    const rSum      = (isMulti)              ? new Float32Array(size) : null;
    const gSum      = (isMulti)              ? new Float32Array(size) : null;
    const bSum      = (isMulti)              ? new Float32Array(size) : null;

    // ── Helper: bilinear splat one point into the histograms ─────────────
    const splat = (
      fpx: number, fpy: number,
      vx: number, vy: number,         // velocity vector (for vel / angle modes)
      cr: number, cg: number, cb: number, // layer colour (for multi mode)
    ) => {
      const px0 = Math.floor(fpx);
      const py0 = Math.floor(fpy);
      // Skip points that would require neighbours outside the buffer
      if (px0 < 0 || px0 + 1 >= w || py0 < 0 || py0 + 1 >= h) return;

      const fx = fpx - px0, fy = fpy - py0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx        * (1 - fy);
      const w01 = (1 - fx)  * fy;
      const w11 = fx        * fy;

      const i00 = py0       * w + px0;
      const i10 = py0       * w + px0 + 1;
      const i01 = (py0 + 1) * w + px0;
      const i11 = (py0 + 1) * w + px0 + 1;

      hist[i00] += w00; hist[i10] += w10;
      hist[i01] += w01; hist[i11] += w11;

      if (isVelocity && velSum) {
        const vel = Math.sqrt(vx * vx + vy * vy);
        velSum[i00] += vel * w00; velSum[i10] += vel * w10;
        velSum[i01] += vel * w01; velSum[i11] += vel * w11;
      }

      if (isAngle && angSinSum && angCosSum) {
        const ang = Math.atan2(vy, vx);
        const sa = Math.sin(ang), ca = Math.cos(ang);
        angSinSum[i00] += sa * w00; angSinSum[i10] += sa * w10;
        angSinSum[i01] += sa * w01; angSinSum[i11] += sa * w11;
        angCosSum[i00] += ca * w00; angCosSum[i10] += ca * w10;
        angCosSum[i01] += ca * w01; angCosSum[i11] += ca * w11;
      }

      if (isMulti && rSum && gSum && bSum) {
        rSum[i00] += cr * w00; rSum[i10] += cr * w10;
        rSum[i01] += cr * w01; rSum[i11] += cr * w11;
        gSum[i00] += cg * w00; gSum[i10] += cg * w10;
        gSum[i01] += cg * w01; gSum[i11] += cg * w11;
        bSum[i00] += cb * w00; bSum[i10] += cb * w10;
        bSum[i01] += cb * w01; bSum[i11] += cb * w11;
      }
    };

    // ── Main iteration ────────────────────────────────────────────────────
    if (isMulti) {
      // Run up to 4 chains, each with slightly offset parameters and its own
      // palette colour. The parameter offsets are small (scaled by driftAmp or
      // a fixed fraction) so each layer traces a morphed version of the base
      // attractor — overlapping structures in different colours.
      const nLayers = Math.min(4, palette.colors.length);
      const layerIters = (iters / nLayers) | 0;
      const offsetScale = Math.max(driftAmp, 0.08); // ensure visible separation

      for (let layer = 0; layer < nLayers; layer++) {
        const f = (layer / Math.max(nLayers - 1, 1)) * Math.PI * 2; // spread layers evenly
        const al = a + offsetScale * 0.9  * Math.sin(f + 0.0);
        const bl = b + offsetScale * 0.7  * Math.cos(f + 1.1);
        const cl = c + offsetScale * 0.55 * Math.sin(f + 2.3);
        const dl = d + offsetScale * 0.45 * Math.cos(f + 3.7);

        const [cr, cg, cb] = hexToRgb(palette.colors[layer % palette.colors.length]);

        // Warm up this layer's orbit to get past the transient
        let lx = 0.1 + layer * 0.07, ly = 0.05 - layer * 0.04;
        for (let i = 0; i < 300; i++) {
          [lx, ly] = iteratePoint(attractorType, lx, ly, al, bl, cl, dl);
          if (attractorType === 'tinkerbell' && (Math.abs(lx) > 20 || Math.abs(ly) > 20)) {
            lx = 0.1; ly = 0.2;
          }
        }

        for (let i = 0; i < layerIters; i++) {
          const ox = lx, oy = ly;
          [lx, ly] = iteratePoint(attractorType, lx, ly, al, bl, cl, dl);
          if (attractorType === 'tinkerbell' && (Math.abs(lx) > 20 || Math.abs(ly) > 20)) {
            lx = 0.1; ly = 0.2;
          }
          splat(toPixelX(lx), toPixelY(ly), lx - ox, ly - oy, cr, cg, cb);
        }
      }
    } else {
      // Single-chain iteration — discard the first 200 points (transient warmup)
      // before accumulating, so the orbit has settled onto the attractor.
      x = 0.1; y = 0.1;
      for (let i = 0; i < 200; i++) {
        [x, y] = iteratePoint(attractorType, x, y, a, b, c, d);
        if (attractorType === 'tinkerbell' && (Math.abs(x) > 20 || Math.abs(y) > 20)) {
          x = 0.1; y = 0.2;
        }
      }

      for (let i = 0; i < iters; i++) {
        const ox = x, oy = y;
        [x, y] = iteratePoint(attractorType, x, y, a, b, c, d);
        if (attractorType === 'tinkerbell' && (Math.abs(x) > 20 || Math.abs(y) > 20)) {
          x = 0.1; y = 0.2;
        }
        splat(toPixelX(x), toPixelY(y), x - ox, y - oy, 0, 0, 0);
      }
    }

    // ── Find max density for normalisation ────────────────────────────────
    let maxDens = 0;
    for (let i = 0; i < size; i++) if (hist[i] > maxDens) maxDens = hist[i];
    if (maxDens === 0) {
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const logMax = Math.log(maxDens + 1);

    // ── Render ────────────────────────────────────────────────────────────
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data      = imageData.data;
    const nColors   = palette.colors.length;

    for (let i = 0; i < size; i++) {
      if (hist[i] === 0) continue;

      // Log tone-map + brightness
      const t = Math.pow(Math.log(hist[i] + 1) / logMax, 1 / brightness);

      // Palette index, offset by colorShift phase
      const rawT  = (t + shiftPhase) % 1;
      const ci    = rawT * (nColors - 1);
      const c0    = Math.floor(ci);
      const c1    = Math.min(c0 + 1, nColors - 1);
      const frac  = ci - c0;

      let r: number, g: number, b2: number;

      if (colorMode === 'multi' && rSum && hist[i] > 0) {
        // Weighted average of layer colours at this pixel
        r  = rSum[i] / hist[i];
        g  = gSum![i] / hist[i];
        b2 = bSum![i] / hist[i];
      } else if (isVelocity && velSum) {
        // Map average velocity to palette
        const avgVel = velSum[i] / hist[i];
        const vt     = Math.min(1, avgVel / 2);
        const vc0    = Math.floor(((vt + shiftPhase) % 1) * (nColors - 1));
        const vc1    = Math.min(vc0 + 1, nColors - 1);
        const vfrac  = ((vt + shiftPhase) % 1) * (nColors - 1) - vc0;
        const [r0, g0, bb0] = hexToRgb(palette.colors[vc0]);
        const [r1, g1, bb1] = hexToRgb(palette.colors[vc1]);
        r = r0 + (r1 - r0) * vfrac; g = g0 + (g1 - g0) * vfrac; b2 = bb0 + (bb1 - bb0) * vfrac;
      } else if (isAngle && angSinSum && angCosSum) {
        // Circular mean of velocity angle → palette cycle
        const avgAngle  = Math.atan2(angSinSum[i] / hist[i], angCosSum[i] / hist[i]);
        const normAngle = ((avgAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const at        = ((normAngle / (Math.PI * 2)) + shiftPhase) % 1;
        const ac0       = Math.floor(at * (nColors - 1));
        const ac1       = Math.min(ac0 + 1, nColors - 1);
        const afrac     = at * (nColors - 1) - ac0;
        const [r0, g0, bb0] = hexToRgb(palette.colors[ac0]);
        const [r1, g1, bb1] = hexToRgb(palette.colors[ac1]);
        r = r0 + (r1 - r0) * afrac; g = g0 + (g1 - g0) * afrac; b2 = bb0 + (bb1 - bb0) * afrac;
      } else {
        // Density mode: interpolate between the two surrounding palette stops
        const [r0, g0, bb0] = hexToRgb(palette.colors[c0]);
        const [r1, g1, bb1] = hexToRgb(palette.colors[c1]);
        r = r0 + (r1 - r0) * frac; g = g0 + (g1 - g0) * frac; b2 = bb0 + (bb1 - bb0) * frac;
      }

      const px = i % w, py = (i / w) | 0;
      for (let dy = 0; dy < pointSize && py + dy < h; dy++) {
        for (let dx = 0; dx < pointSize && px + dx < w; dx++) {
          const idx     = ((py + dy) * w + (px + dx)) * 4;
          data[idx]     = Math.min(255, (data[idx]     + r  * t) | 0);
          data[idx + 1] = Math.min(255, (data[idx + 1] + g  * t) | 0);
          data[idx + 2] = Math.min(255, (data[idx + 2] + b2 * t) | 0);
          data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(params.iterations * 8); },
};
