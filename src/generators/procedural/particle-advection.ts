import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TAU = Math.PI * 2;

const parameterSchema: ParameterSchema = {
  fieldMode: {
    name: 'Field Mode', type: 'select',
    options: ['curl', 'gradient', 'orbital', 'turbulent'],
    default: 'curl',
    help: 'curl: divergence-free smoke | gradient: ascent/descent flow | orbital: circling attractors | turbulent: chaotic high-frequency',
    group: 'Composition',
  },
  particleCount: {
    name: 'Particles', type: 'number', min: 800, max: 5000, step: 100, default: 2500,
    help: 'Number of advected particles',
    group: 'Composition',
  },
  trailLength: {
    name: 'Trail Length', type: 'number', min: 20, max: 200, step: 10, default: 80,
    help: 'Integration steps per particle trail',
    group: 'Flow/Motion',
  },
  fieldScale: {
    name: 'Field Scale', type: 'number', min: 0.5, max: 6, step: 0.1, default: 2.0,
    help: 'Spatial frequency of the velocity field',
    group: 'Geometry',
  },
  fieldStrength: {
    name: 'Field Strength', type: 'number', min: 1.0, max: 5, step: 0.1, default: 2.5,
    help: 'Velocity magnitude multiplier',
    group: 'Flow/Motion',
  },
  lineWidth: {
    name: 'Line Width', type: 'number', min: 0.5, max: 4, step: 0.25, default: 1.5,
    help: 'Stroke width of particle trails',
    group: 'Texture',
  },
  fadeRate: {
    name: 'Fade Rate', type: 'number', min: 0.01, max: 0.3, step: 0.01, default: 0.05,
    help: 'How quickly trail segments fade with age',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['speed', 'direction', 'age', 'palette'],
    default: 'speed',
    help: 'speed: velocity → color | direction: angle → color | age: trail position → color | palette: fixed per particle',
    group: 'Color',
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

export const particleAdvection: Generator = {
  id: 'procedural-particle-advection',
  family: 'procedural',
  styleName: 'Particle Advection',
  definition: 'Particles advected through time-varying velocity fields — curl noise, gradient flow, orbital motion, and turbulent chaos reveal flow structure as luminous trails',
  algorithmNotes:
    'Seeds particles deterministically and integrates them through a 2D velocity field. Curl and gradient modes use angle-based flow (1 noise call + sin/cos) instead of finite-difference derivatives (4 noise calls) for ~4× fewer noise evaluations per step. Orbital mode adds tangential velocity around seeded attractor points with noise perturbation. Turbulent mode layers two noise frequencies for chaotic advection. Speed color mode uses squared velocity to avoid per-step sqrt. Trails are drawn with butt line caps and miter joins for reduced canvas overhead. Audio bass modulates field strength, mid shifts field scale.',
  parameterSchema,
  defaultParams: {
    fieldMode: 'curl', particleCount: 2500, trailLength: 80, fieldScale: 2.0,
    fieldStrength: 2.5, lineWidth: 1.5, fadeRate: 0.05, colorMode: 'speed', speed: 0.7, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const minDim = Math.min(w, h);

    const fieldMode = params.fieldMode || 'curl';
    const pCount = Math.max(800, params.particleCount ?? 2500) | 0;
    const trailLen = Math.max(20, params.trailLength ?? 80) | 0;
    const fScale = params.fieldScale ?? 2.0;
    const baseFStr = Math.max(1.0, params.fieldStrength ?? 2.5);
    const lw = Math.max(0.5, params.lineWidth ?? 1.5);
    const fadeRate = params.fadeRate ?? 0.05;
    const colorMode = params.colorMode || 'speed';
    const spd = params.speed ?? 0.7;

    const rx = params.reactivity ?? 1.0;
    const audioBass = (params._audioBass ?? 0) * rx;
    const audioMid = (params._audioMid ?? 0) * rx;
    const audioHigh = (params._audioHigh ?? 0) * rx;

    const t = time * spd;
    const fStr = baseFStr * (1 + audioBass * 2);
    const effScale = fScale * (1 + audioMid * 0.3);

    const qualityMult = quality === 'draft' ? 0.5 : quality === 'ultra' ? 1.0 : 0.75;
    const actualCount = Math.round(pCount * qualityMult);

    const colors = palette.colors.map(hexToRgb);
    const nC = colors.length;

    // ── Fast hash-based value noise ──────────────────────────────
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
    ctx.fillStyle = '#080810';
    ctx.fillRect(0, 0, w, h);

    // Additive blending — overlapping trails accumulate brightness
    ctx.globalCompositeOperation = 'lighter';

    // ── Field setup ──────────────────────────────────────────────
    const noiseScale = effScale / minDim;
    const velMag = fStr * 6;
    const maxVel = minDim * 0.03;
    const maxVelSq = maxVel * maxVel;
    const dt = 0.6;

    // Mode → integer
    const modeId = fieldMode === 'curl' ? 0 : fieldMode === 'gradient' ? 1 : fieldMode === 'orbital' ? 2 : 3;

    // Time offsets for noise animation
    const tNx = t * 0.03;
    const tNy = t * 0.02;

    // Orbital mode: generate attractor centers using flat arrays
    let nOrb = 0;
    let orbCxArr: Float64Array | null = null;
    let orbCyArr: Float64Array | null = null;
    let orbStrArr: Float64Array | null = null;
    if (modeId === 2) {
      nOrb = rng.integer(2, 5);
      orbCxArr = new Float64Array(nOrb);
      orbCyArr = new Float64Array(nOrb);
      orbStrArr = new Float64Array(nOrb);
      for (let i = 0; i < nOrb; i++) {
        orbCxArr[i] = rng.range(w * 0.15, w * 0.85);
        orbCyArr[i] = rng.range(h * 0.15, h * 0.85);
        orbStrArr[i] = rng.range(0.5, 2.0) * (rng.random() > 0.5 ? 1 : -1);
      }
    }

    // Turbulent mode: second noise scale
    const turbScale = noiseScale * 3;
    const turbMag = velMag * 0.4;

    // Precomputed orbital constants
    const orbFStr = fStr * 200;
    const orbNoiseMag = velMag * 0.3;

    // Speed color: use squared speed → avoid sqrt per step
    const useSpeedSq = colorMode === 'speed';
    // Precompute inverse for speed color mapping
    const invMaxVelSqScaled = 1 / (maxVelSq * 0.64); // (maxVel*0.8)^2

    // ── Velocity computation (angle-based for curl/gradient: 1 vN instead of 4) ──
    let outVx = 0, outVy = 0;
    const computeVelocity = (px: number, py: number) => {
      const nx = px * noiseScale + tNx;
      const ny = py * noiseScale + tNy;

      if (modeId === 0) {
        // Curl: angle-based flow — 1 noise call instead of 4 finite differences
        const angle = vN(nx, ny) * TAU;
        outVx = Math.cos(angle) * velMag;
        outVy = Math.sin(angle) * velMag;
      } else if (modeId === 1) {
        // Gradient: angle-based with π/2 offset for different visual
        const angle = vN(nx, ny) * TAU + 1.5708; // + π/2
        outVx = Math.cos(angle) * velMag;
        outVy = Math.sin(angle) * velMag;
      } else if (modeId === 2) {
        // Orbital: tangential around attractors + noise perturbation
        outVx = 0; outVy = 0;
        for (let c = 0; c < nOrb; c++) {
          const dx = px - orbCxArr![c], dy = py - orbCyArr![c];
          const invR2 = 1 / (dx * dx + dy * dy + 100);
          const f = orbStrArr![c] * orbFStr * invR2;
          outVx += -dy * f + dx * f * 0.15;
          outVy += dx * f + dy * f * 0.15;
        }
        // Single noise perturbation
        const angle = vN(nx, ny) * TAU;
        outVx += Math.cos(angle) * orbNoiseMag;
        outVy += Math.sin(angle) * orbNoiseMag;
      } else {
        // Turbulent: 2 noise calls (was 3)
        const angle1 = vN(nx, ny) * TAU;
        const cosA = Math.cos(angle1), sinA = Math.sin(angle1);
        outVx = cosA * velMag;
        outVy = sinA * velMag;
        // High-frequency perturbation
        const angle2 = vN(px * turbScale + tNx * 2, py * turbScale + tNy * 2) * TAU;
        outVx += Math.cos(angle2) * turbMag;
        outVy += Math.sin(angle2) * turbMag;
        // Derive jitter from existing values (no extra noise call)
        outVx += sinA * turbMag * 0.3;
        outVy -= cosA * turbMag * 0.3;
      }
    };

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
    ctx.lineCap = 'butt';    // faster than 'round'
    ctx.lineJoin = 'miter';  // faster than 'round'

    const baseAlpha = 0.85 + audioHigh * 0.15;
    const phaseOffset = t * 0.4;
    const fadeMult = 1 + fadeRate * 2;
    const invTrailLen = 1 / trailLen;

    const trailX = new Float32Array(trailLen + 1);
    const trailY = new Float32Array(trailLen + 1);
    const trailWrap = new Uint8Array(trailLen);
    // Speed squared cache — avoids sqrt per step
    const trailSpeedSq = useSpeedSq ? new Float32Array(trailLen) : null;

    for (let i = 0; i < actualCount; i++) {
      // Initial position with time-based drift
      const driftAngle = vN(startX[i] * 0.001 + phaseOffset, startY[i] * 0.001) * TAU;
      const driftMag = minDim * 0.08;
      let px = startX[i] + Math.cos(driftAngle) * driftMag;
      let py = startY[i] + Math.sin(driftAngle) * driftMag;

      trailX[0] = px;
      trailY[0] = py;

      // Integrate trail
      for (let s = 0; s < trailLen; s++) {
        computeVelocity(px, py);

        // Cache squared speed for color (no sqrt)
        if (trailSpeedSq) {
          trailSpeedSq[s] = outVx * outVx + outVy * outVy;
        }

        // Clamp velocity
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
        const segsPerBand = Math.ceil(trailLen / bands);
        for (let band = 0; band < bands; band++) {
          const sStart = band * segsPerBand;
          const sEnd = Math.min((band + 1) * segsPerBand, trailLen);
          if (sStart >= trailLen) break;
          const midAge = ((sStart + sEnd) * 0.5) * invTrailLen;
          const alpha = (1 - midAge * fadeMult) * baseAlpha;
          if (alpha < 0.02) break;
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(trailX[sStart], trailY[sStart]);
          for (let s = sStart; s < sEnd; s++) {
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
        // Variable color per segment — batched by color+alpha
        let prevR = -1, prevG = -1, prevB = -1, prevAlphaQ = -1;
        let pathOpen = false;

        for (let s = 0; s < trailLen; s++) {
          const age = s * invTrailLen;
          const alpha = (1 - age * fadeMult) * baseAlpha;
          if (alpha < 0.02) break;

          if (trailWrap[s]) {
            if (pathOpen) { ctx.stroke(); pathOpen = false; }
            prevR = -1;
            continue;
          }

          const alphaQ = (alpha * 10 + 0.5) | 0;

          let r: number, g: number, b: number;
          if (colorMode === 'speed') {
            // Use squared speed — no sqrt
            const speedSq = trailSpeedSq![s];
            const ci = Math.min(nC - 1, (Math.min(1, speedSq * invMaxVelSqScaled) * (nC - 1)) | 0);
            r = colors[ci][0]; g = colors[ci][1]; b = colors[ci][2];
          } else if (colorMode === 'direction') {
            const ddx = trailX[s + 1] - trailX[s];
            const ddy = trailY[s + 1] - trailY[s];
            const ang = (Math.atan2(ddy, ddx) + Math.PI) / TAU;
            const ci = Math.max(0, Math.min(nC - 1, (ang * (nC - 1)) | 0));
            r = colors[ci][0]; g = colors[ci][1]; b = colors[ci][2];
          } else {
            // age
            const ci = Math.min(nC - 1, (age * (nC - 1)) | 0);
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

    // Restore default composite
    ctx.globalCompositeOperation = 'source-over';
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round((params.particleCount ?? 2500) * (params.trailLength ?? 80) * 0.012);
  },
};
