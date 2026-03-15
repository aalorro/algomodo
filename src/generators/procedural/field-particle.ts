import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TAU = Math.PI * 2;

const parameterSchema: ParameterSchema = {
  particleCount: {
    name: 'Particles', type: 'number', min: 200, max: 5000, step: 100, default: 1500,
    help: 'Number of flow particles',
    group: 'Composition',
  },
  fieldType: {
    name: 'Field Type', type: 'select',
    options: ['curl', 'attractor', 'vortex', 'dipole'],
    default: 'curl',
    help: 'curl: noise curl | attractor: point pulls | vortex: tangential flow | dipole: two-pole field',
    group: 'Composition',
  },
  trailLength: {
    name: 'Trail Length', type: 'number', min: 10, max: 200, step: 10, default: 80,
    help: 'Integration steps per particle trail',
    group: 'Geometry',
  },
  fieldStrength: {
    name: 'Field Strength', type: 'number', min: 0.1, max: 3, step: 0.1, default: 1.0,
    help: 'Velocity multiplier',
    group: 'Flow/Motion',
  },
  lineWidth: {
    name: 'Line Width', type: 'number', min: 0.5, max: 3, step: 0.25, default: 1.0,
    help: 'Stroke width of trails',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['velocity', 'direction', 'age', 'palette'],
    default: 'velocity',
    help: 'velocity: speed → color | direction: angle → color | age: trail position → color | palette: fixed per particle',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3, step: 0.1, default: 1.0,
    help: 'Animation speed',
    group: 'Flow/Motion',
  },
  reactivity: {
    name: 'Audio Reactivity', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0,
    help: 'Sensitivity to audio input (0 = none)',
    group: 'Flow/Motion',
  },
};

export const fieldParticle: Generator = {
  id: 'procedural-field-particle',
  family: 'procedural',
  styleName: 'Field + Particle Motion',
  definition: 'Vector field visualization with particles tracing flow lines through curl noise, attractors, vortices, or dipole fields',
  algorithmNotes:
    'Defines a vector field (curl of noise, point attractors, tangential vortices, or two-pole dipole). Particles are seeded from deterministic positions and integrated forward through the field. Each frame recomputes all trails statelessly from a time-offset starting point. Curl and dipole modes show a background grid of field direction lines. Trails are drawn as polylines with fading alpha. Color maps to speed, direction, age, or fixed palette assignment.',
  parameterSchema,
  defaultParams: {
    particleCount: 1500, fieldType: 'curl', trailLength: 80, fieldStrength: 1.0,
    lineWidth: 1.0, colorMode: 'velocity', speed: 1.0, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const minDim = Math.min(w, h);

    const pCount = Math.max(50, params.particleCount ?? 1500) | 0;
    const fieldType = params.fieldType || 'curl';
    const trailLen = Math.max(5, params.trailLength ?? 80) | 0;
    const baseFStr = params.fieldStrength ?? 1.0;
    const lw = params.lineWidth ?? 1.0;
    const colorMode = params.colorMode || 'velocity';
    const spd = params.speed ?? 1.0;

    const rx = params.reactivity ?? 1.0;
    const audioBass = (params._audioBass ?? 0) * rx;
    const audioHigh = (params._audioHigh ?? 0) * rx;
    const fStr = baseFStr * (1 + audioBass * 2.5);
    const t = time * spd;

    const qualityMult = quality === 'draft' ? 0.5 : quality === 'ultra' ? 1.0 : 0.75;
    const actualCount = Math.round(pCount * qualityMult);

    const colors = palette.colors.map(hexToRgb);
    const nC = colors.length;

    // ── Fast hash-based value noise (~3× faster than SimplexNoise) ──
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

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Velocity clamping
    const maxVel = minDim * 0.025;
    const maxVelSq = maxVel * maxVel;

    // ── Field setup ──────────────────────────────────────────────
    const noiseScale = 3.0 / minDim;

    // Curl: angle-based flow field — 1 noise call vs 4 finite-difference calls
    const curlMag = fStr * 6;
    const curlTimeX = t * 0.01;
    const curlTimeY = t * 0.007;

    // Centers for vortex/attractor/dipole
    const centersX: number[] = [];
    const centersY: number[] = [];
    const centersStr: number[] = [];
    let nCenters = 0;

    if (fieldType === 'dipole') {
      // Place dipole poles near center with clear separation
      nCenters = 2;
      const sep = rng.range(minDim * 0.12, minDim * 0.22);
      const cx = w * 0.5, cy = h * 0.5;
      const angle = rng.range(0, TAU);
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      centersX.push(cx + cosA * sep, cx - cosA * sep);
      centersY.push(cy + sinA * sep, cy - sinA * sep);
      centersStr.push(1.5, -1.5);
    } else if (fieldType === 'vortex' || fieldType === 'attractor') {
      nCenters = rng.integer(2, 4);
      for (let i = 0; i < nCenters; i++) {
        centersX.push(rng.range(w * 0.2, w * 0.8));
        centersY.push(rng.range(h * 0.2, h * 0.8));
        centersStr.push(rng.range(0.5, 2.0));
      }
    }

    // Force constants
    const attractFStr = fStr * 50000;
    const vortexFStr = fStr * 200;
    const dipoleFStr = fStr * 1.2e8;

    // ── Sin/cos LUT — eliminates trig from curl inner loop ─────
    const LUT_BITS = 10;
    const LUT_SIZE = 1 << LUT_BITS; // 1024
    const LUT_MASK = LUT_SIZE - 1;
    const COS_LUT = new Float32Array(LUT_SIZE);
    const SIN_LUT = new Float32Array(LUT_SIZE);
    for (let i = 0; i < LUT_SIZE; i++) {
      const a = (i / LUT_SIZE) * TAU;
      COS_LUT[i] = Math.cos(a);
      SIN_LUT[i] = Math.sin(a);
    }

    // ── Inline velocity ──────────────────────────────────────────
    let outVx = 0, outVy = 0;
    const computeVelocity = (px: number, py: number) => {
      if (fieldType === 'curl') {
        // Angle-based flow with LUT: 1 noise call + 2 LUT lookups (no trig)
        const noiseVal = vN(px * noiseScale + curlTimeX, py * noiseScale + curlTimeY);
        const idx = ((noiseVal * 0.5 + 0.5) * LUT_SIZE | 0) & LUT_MASK;
        outVx = COS_LUT[idx] * curlMag;
        outVy = SIN_LUT[idx] * curlMag;
      } else if (fieldType === 'attractor') {
        outVx = 0; outVy = 0;
        for (let c = 0; c < nCenters; c++) {
          const dx = centersX[c] - px, dy = centersY[c] - py;
          const f = centersStr[c] * attractFStr / (dx * dx + dy * dy + 1000);
          outVx += -dy * f * 0.7 + dx * f * 0.3;
          outVy += dx * f * 0.7 + dy * f * 0.3;
        }
      } else if (fieldType === 'vortex') {
        // Tangential flow — pure arithmetic, no sqrt
        // (sqrt(d2)+10)^2 ≈ d2+100 at both extremes: near-center and far-field
        outVx = 0; outVy = 0;
        for (let c = 0; c < nCenters; c++) {
          const dx = px - centersX[c], dy = py - centersY[c];
          const f = centersStr[c] * vortexFStr / (dx * dx + dy * dy + 100);
          outVx += -dy * f;
          outVy += dx * f;
        }
      } else {
        // dipole — pure arithmetic, no sqrt
        // Uses 1/r^4 falloff instead of 1/r^3 — steeper near poles, similar flow topology
        outVx = 0; outVy = 0;
        for (let c = 0; c < nCenters; c++) {
          const dx = px - centersX[c], dy = py - centersY[c];
          const r2 = dx * dx + dy * dy + 200;
          const f = centersStr[c] * dipoleFStr / (r2 * r2);
          outVx += (-dy * 0.5 + dx * 0.5) * f;
          outVy += (dx * 0.5 + dy * 0.5) * f;
        }
      }
    };

    // ── Field line grid (curl and dipole only) ───────────────────
    if (fieldType === 'curl' || fieldType === 'dipole') {
      const spacing = quality === 'draft' ? 50 : quality === 'ultra' ? 25 : 35;
      const lineLen = spacing * 0.35;
      ctx.lineWidth = 0.5;
      const gc = colors[0];
      ctx.strokeStyle = `rgba(${gc[0]},${gc[1]},${gc[2]},0.1)`;
      ctx.beginPath();

      for (let gy = spacing * 0.5; gy < h; gy += spacing) {
        for (let gx = spacing * 0.5; gx < w; gx += spacing) {
          computeVelocity(gx, gy);
          const mag = Math.sqrt(outVx * outVx + outVy * outVy);
          if (mag < 0.001) continue;
          const sc = lineLen / mag * 0.5;
          const dx = outVx * sc;
          const dy = outVy * sc;
          ctx.moveTo(gx - dx, gy - dy);
          ctx.lineTo(gx + dx, gy + dy);
        }
      }
      ctx.stroke();
    }

    // ── Seed particles ───────────────────────────────────────────
    const startX = new Float32Array(actualCount);
    const startY = new Float32Array(actualCount);
    const pColorIdx = new Uint8Array(actualCount);
    for (let i = 0; i < actualCount; i++) {
      startX[i] = rng.range(0, w);
      startY[i] = rng.range(0, h);
      pColorIdx[i] = rng.integer(0, nC - 1);
    }

    // ── Trail integration + drawing ──────────────────────────────
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dt = 0.5;
    const phaseOffset = t * 0.5;
    const baseAlpha = 0.7 + audioHigh * 0.3;

    const trailX = new Float32Array(trailLen + 1);
    const trailY = new Float32Array(trailLen + 1);
    const trailWrap = new Uint8Array(trailLen);
    const needSpeedCache = colorMode === 'velocity';
    const trailSpeed = needSpeedCache ? new Float32Array(trailLen) : null;

    const maxVisibleSeg = Math.min(trailLen, Math.ceil(baseAlpha / 0.02 * trailLen)) | 0;

    for (let i = 0; i < actualCount; i++) {
      // Initial position with noise-based drift (1 cheap noise call instead of 2 SimplexNoise)
      const driftAngle = vN(startX[i] * 0.001 + phaseOffset, startY[i] * 0.001) * TAU;
      const driftMag = minDim * 0.1;
      let px = startX[i] + Math.cos(driftAngle) * driftMag;
      let py = startY[i] + Math.sin(driftAngle) * driftMag;

      trailX[0] = px;
      trailY[0] = py;

      // Integrate trail with velocity clamping + wrap tracking
      for (let s = 0; s < trailLen; s++) {
        computeVelocity(px, py);

        // Cache unclamped speed for velocity color mode
        if (trailSpeed) {
          trailSpeed[s] = Math.sqrt(outVx * outVx + outVy * outVy);
        }

        // Clamp velocity magnitude
        const magSq = outVx * outVx + outVy * outVy;
        if (magSq > maxVelSq) {
          const scale = maxVel / Math.sqrt(magSq);
          outVx *= scale;
          outVy *= scale;
        }

        const newPx = px + outVx * dt;
        const newPy = py + outVy * dt;

        let wrapped = 0;
        if (newPx < 0) { px = newPx + w; wrapped = 1; }
        else if (newPx > w) { px = newPx - w; wrapped = 1; }
        else { px = newPx; }

        if (newPy < 0) { py = newPy + h; wrapped = 1; }
        else if (newPy > h) { py = newPy - h; wrapped = 1; }
        else { py = newPy; }

        trailWrap[s] = wrapped;
        trailX[s + 1] = px;
        trailY[s + 1] = py;
      }

      // ── Draw trail ─────────────────────────────────────────────
      if (colorMode === 'palette') {
        const [r, g, b] = colors[pColorIdx[i]];
        const bands = 4;
        const segsPerBand = Math.ceil(maxVisibleSeg / bands);
        for (let band = 0; band < bands; band++) {
          const sStart = band * segsPerBand;
          const sEnd = Math.min((band + 1) * segsPerBand, maxVisibleSeg);
          if (sStart >= trailLen) break;
          const midAge = ((sStart + sEnd) / 2) / trailLen;
          const alpha = (1 - midAge) * baseAlpha;
          if (alpha < 0.02) break;
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(trailX[sStart], trailY[sStart]);
          for (let s = sStart; s < sEnd && s < trailLen; s++) {
            if (trailWrap[s]) {
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(trailX[s + 1], trailY[s + 1]);
            } else {
              ctx.lineTo(trailX[s + 1], trailY[s + 1]);
            }
          }
          ctx.stroke();
        }
      } else {
        // Variable color per segment — batch consecutive same-color segments
        let prevR = -1, prevG = -1, prevB = -1, prevAlphaQ = -1;
        let pathOpen = false;

        for (let s = 0; s < maxVisibleSeg && s < trailLen; s++) {
          const age = s / trailLen;
          const alpha = (1 - age) * baseAlpha;
          if (alpha < 0.02) break;

          if (trailWrap[s]) {
            if (pathOpen) { ctx.stroke(); pathOpen = false; }
            prevR = -1;
            continue;
          }

          const alphaQ = (alpha * 10 + 0.5) | 0;

          let r: number, g: number, b: number;
          if (colorMode === 'velocity') {
            const speed = trailSpeed![s];
            const ci = Math.min(nC - 1, (Math.min(1, speed * 0.3) * (nC - 1)) | 0);
            r = colors[ci][0]; g = colors[ci][1]; b = colors[ci][2];
          } else if (colorMode === 'direction') {
            const ddx = trailX[s + 1] - trailX[s];
            const ddy = trailY[s + 1] - trailY[s];
            const ang = (Math.atan2(ddy, ddx) + Math.PI) / TAU;
            const ci = Math.max(0, Math.min(nC - 1, (ang * (nC - 1)) | 0));
            r = colors[ci][0]; g = colors[ci][1]; b = colors[ci][2];
          } else {
            // age
            const ci = (age * (nC - 1)) | 0;
            r = colors[ci][0]; g = colors[ci][1]; b = colors[ci][2];
          }

          if (r !== prevR || g !== prevG || b !== prevB || alphaQ !== prevAlphaQ) {
            if (pathOpen) ctx.stroke();
            ctx.strokeStyle = `rgba(${r},${g},${b},${(alphaQ / 10).toFixed(1)})`;
            ctx.beginPath();
            ctx.moveTo(trailX[s], trailY[s]);
            prevR = r; prevG = g; prevB = b; prevAlphaQ = alphaQ;
            pathOpen = true;
          }
          ctx.lineTo(trailX[s + 1], trailY[s + 1]);
        }
        if (pathOpen) ctx.stroke();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round((params.particleCount ?? 1500) * (params.trailLength ?? 80) * 0.01);
  },
};
