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
    name: 'Particles', type: 'number', min: 500, max: 5000, step: 100, default: 2000,
    help: 'Number of advected particles',
    group: 'Composition',
  },
  trailLength: {
    name: 'Trail Length', type: 'number', min: 10, max: 200, step: 10, default: 60,
    help: 'Integration steps per particle trail',
    group: 'Flow/Motion',
  },
  fieldScale: {
    name: 'Field Scale', type: 'number', min: 0.5, max: 6, step: 0.1, default: 2.0,
    help: 'Spatial frequency of the velocity field',
    group: 'Geometry',
  },
  fieldStrength: {
    name: 'Field Strength', type: 'number', min: 0.5, max: 5, step: 0.1, default: 2.0,
    help: 'Velocity magnitude multiplier',
    group: 'Flow/Motion',
  },
  fadeRate: {
    name: 'Fade Rate', type: 'number', min: 0.01, max: 0.5, step: 0.01, default: 0.1,
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
    'Seeds particles deterministically and integrates them through a 2D velocity field. Curl mode computes divergence-free velocity from noise derivatives for smoke-like flow. Gradient mode follows noise ascent/descent. Orbital mode adds tangential velocity around noise-defined attractor points. Turbulent mode layers high-frequency noise with random perturbation for chaotic advection. Trails are drawn statelessly each frame from time-offset start positions. Color maps to speed, direction, age, or palette. Audio bass modulates field strength, mid shifts field scale.',
  parameterSchema,
  defaultParams: {
    fieldMode: 'curl', particleCount: 2000, trailLength: 60, fieldScale: 2.0,
    fieldStrength: 2.0, fadeRate: 0.1, colorMode: 'speed', speed: 0.7, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const minDim = Math.min(w, h);

    const fieldMode = params.fieldMode || 'curl';
    const pCount = Math.max(100, params.particleCount ?? 2000) | 0;
    const trailLen = Math.max(5, params.trailLength ?? 60) | 0;
    const fScale = params.fieldScale ?? 2.0;
    const baseFStr = params.fieldStrength ?? 2.0;
    const fadeRate = params.fadeRate ?? 0.1;
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

    // ── Field setup ──────────────────────────────────────────────
    const noiseScale = effScale / minDim;
    const eps = 0.5; // finite-difference step in pixel space
    const epsN = eps * noiseScale;
    const velMag = fStr * 4;
    const maxVel = minDim * 0.02;
    const maxVelSq = maxVel * maxVel;
    const dt = 0.6;

    // Mode → integer
    const modeId = fieldMode === 'curl' ? 0 : fieldMode === 'gradient' ? 1 : fieldMode === 'orbital' ? 2 : 3;

    // Time offsets for noise animation
    const tNx = t * 0.03;
    const tNy = t * 0.02;

    // Orbital mode: generate attractor centers
    const orbCx: number[] = [];
    const orbCy: number[] = [];
    const orbStr: number[] = [];
    let nOrb = 0;
    if (modeId === 2) {
      nOrb = rng.integer(2, 5);
      for (let i = 0; i < nOrb; i++) {
        orbCx.push(rng.range(w * 0.15, w * 0.85));
        orbCy.push(rng.range(h * 0.15, h * 0.85));
        orbStr.push(rng.range(0.5, 2.0) * (rng.random() > 0.5 ? 1 : -1));
      }
    }

    // Turbulent mode: extra high-frequency noise scale
    const turbScale = noiseScale * 3;
    const turbMag = velMag * 0.4;

    // ── Velocity computation ─────────────────────────────────────
    let outVx = 0, outVy = 0;
    const computeVelocity = (px: number, py: number) => {
      const nx = px * noiseScale + tNx;
      const ny = py * noiseScale + tNy;

      if (modeId === 0) {
        // Curl noise: divergence-free
        const nPy = vN(nx, ny + epsN);
        const nMy = vN(nx, ny - epsN);
        const nPx = vN(nx + epsN, ny);
        const nMx = vN(nx - epsN, ny);
        outVx = (nPy - nMy) * velMag;
        outVy = -(nPx - nMx) * velMag;
      } else if (modeId === 1) {
        // Gradient: follow noise slope
        const nPx = vN(nx + epsN, ny);
        const nMx = vN(nx - epsN, ny);
        const nPy = vN(nx, ny + epsN);
        const nMy = vN(nx, ny - epsN);
        outVx = (nPx - nMx) * velMag;
        outVy = (nPy - nMy) * velMag;
      } else if (modeId === 2) {
        // Orbital: tangential velocity around attractor points
        outVx = 0; outVy = 0;
        for (let c = 0; c < nOrb; c++) {
          const dx = px - orbCx[c], dy = py - orbCy[c];
          const r = Math.sqrt(dx * dx + dy * dy) + 10;
          const f = orbStr[c] * fStr * 200 / (r * r);
          // Tangential + slight inward pull
          outVx += -dy * f + dx * f * 0.15;
          outVy += dx * f + dy * f * 0.15;
        }
        // Add noise perturbation
        const angle = vN(nx, ny) * TAU;
        outVx += Math.cos(angle) * velMag * 0.3;
        outVy += Math.sin(angle) * velMag * 0.3;
      } else {
        // Turbulent: layered high-frequency noise
        const angle1 = vN(nx, ny) * TAU;
        outVx = Math.cos(angle1) * velMag;
        outVy = Math.sin(angle1) * velMag;
        // High-frequency perturbation
        const tnx = px * turbScale + tNx * 2;
        const tny = py * turbScale + tNy * 2;
        const angle2 = vN(tnx, tny) * TAU;
        outVx += Math.cos(angle2) * turbMag;
        outVy += Math.sin(angle2) * turbMag;
        // Random jitter based on noise
        const jitter = vN(nx + 100, ny + 100) * turbMag * 0.5;
        outVx += jitter;
        outVy -= jitter;
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
    ctx.lineWidth = 1.0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const baseAlpha = 0.6 + audioHigh * 0.3;
    const phaseOffset = t * 0.4;

    const trailX = new Float32Array(trailLen + 1);
    const trailY = new Float32Array(trailLen + 1);
    const trailWrap = new Uint8Array(trailLen);
    const needSpeedCache = colorMode === 'speed';
    const trailSpeed = needSpeedCache ? new Float32Array(trailLen) : null;

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

        if (trailSpeed) {
          trailSpeed[s] = Math.sqrt(outVx * outVx + outVy * outVy);
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
          const midAge = ((sStart + sEnd) / 2) / trailLen;
          const alpha = (1 - midAge * (1 + fadeRate * 3)) * baseAlpha;
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
        // Variable color per segment
        let prevR = -1, prevG = -1, prevB = -1, prevAlphaQ = -1;
        let pathOpen = false;

        for (let s = 0; s < trailLen; s++) {
          const age = s / trailLen;
          const alpha = (1 - age * (1 + fadeRate * 3)) * baseAlpha;
          if (alpha < 0.02) break;

          if (trailWrap[s]) {
            if (pathOpen) { ctx.stroke(); pathOpen = false; }
            prevR = -1;
            continue;
          }

          const alphaQ = (alpha * 10 + 0.5) | 0;

          let r: number, g: number, b: number;
          if (colorMode === 'speed') {
            const speed = trailSpeed![s];
            const ci = Math.min(nC - 1, (Math.min(1, speed / (maxVel * 0.8)) * (nC - 1)) | 0);
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
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round((params.particleCount ?? 2000) * (params.trailLength ?? 60) * 0.012);
  },
};
