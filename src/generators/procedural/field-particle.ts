import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

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
    'Defines a vector field (curl of simplex noise, point attractors, tangential vortices, or two-pole dipole). Particles are seeded from deterministic positions and integrated forward through the field. Each frame recomputes all trails statelessly from a time-offset starting point. Trails are drawn as polylines with fading alpha. Color maps to speed, direction, age, or fixed palette assignment.',
  parameterSchema,
  defaultParams: {
    particleCount: 1500, fieldType: 'curl', trailLength: 80, fieldStrength: 1.0,
    lineWidth: 1.0, colorMode: 'velocity', speed: 1.0, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const minDim = Math.min(w, h);

    const pCount = Math.max(50, params.particleCount ?? 1500) | 0;
    const fieldType = params.fieldType || 'curl';
    const trailLen = Math.max(5, params.trailLength ?? 80) | 0;
    const baseFStr = params.fieldStrength ?? 1.0;
    const lw = params.lineWidth ?? 1.0;
    const colorMode = params.colorMode || 'velocity';
    const spd = params.speed ?? 1.0;

    // Audio reactivity
    const rx = params.reactivity ?? 1.0;
    const audioBass = (params._audioBass ?? 0) * rx;
    const audioHigh = (params._audioHigh ?? 0) * rx;
    const fStr = baseFStr * (1 + audioBass * 2.5);
    const t = time * spd;

    const qualityMult = quality === 'draft' ? 0.5 : quality === 'ultra' ? 1.0 : 0.75;
    const actualCount = Math.round(pCount * qualityMult);

    const colors = palette.colors.map(hexToRgb);
    const nC = colors.length;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Velocity clamping — prevents attractor/dipole from sending particles
    // across the canvas dozens of times, which freezes the rasterizer
    const maxVel = minDim * 0.025;
    const maxVelSq = maxVel * maxVel;

    // Field-specific setup
    const noiseScale = 3.0 / minDim;
    const epsNS = 0.5 * noiseScale;

    // Vortex / attractor / dipole centers — flat arrays
    const centersX: number[] = [];
    const centersY: number[] = [];
    const centersStr: number[] = [];
    let nCenters = 0;
    if (fieldType === 'vortex' || fieldType === 'attractor' || fieldType === 'dipole') {
      nCenters = fieldType === 'dipole' ? 2 : rng.integer(2, 4);
      for (let i = 0; i < nCenters; i++) {
        centersX.push(rng.range(w * 0.2, w * 0.8));
        centersY.push(rng.range(h * 0.2, h * 0.8));
        centersStr.push(rng.range(0.5, 2.0) * (fieldType === 'dipole' ? (i === 0 ? 1 : -1) : 1));
      }
    }

    // Precompute field constants
    const curlFStr2 = fStr * 2;
    const attractFStr = fStr * 50000;
    const vortexFStr = fStr * 200;
    const dipoleFStr = fStr * 30000;

    // Inline velocity — avoids tuple allocation and function call overhead
    let outVx = 0, outVy = 0;
    const computeVelocity = (px: number, py: number) => {
      if (fieldType === 'curl') {
        const nx = px * noiseScale;
        const ny = py * noiseScale;
        outVx = (noise.noise2D(nx, ny + epsNS) - noise.noise2D(nx, ny - epsNS)) * curlFStr2;
        outVy = -(noise.noise2D(nx + epsNS, ny) - noise.noise2D(nx - epsNS, ny)) * curlFStr2;
      } else if (fieldType === 'attractor') {
        outVx = 0; outVy = 0;
        for (let c = 0; c < nCenters; c++) {
          const dx = centersX[c] - px, dy = centersY[c] - py;
          const f = centersStr[c] * attractFStr / (dx * dx + dy * dy + 1000);
          outVx += -dy * f * 0.7 + dx * f * 0.3;
          outVy += dx * f * 0.7 + dy * f * 0.3;
        }
      } else if (fieldType === 'vortex') {
        outVx = 0; outVy = 0;
        for (let c = 0; c < nCenters; c++) {
          const dx = px - centersX[c], dy = py - centersY[c];
          const r = Math.sqrt(dx * dx + dy * dy) + 10;
          const f = centersStr[c] * vortexFStr / (r * r);
          outVx += -dy * f;
          outVy += dx * f;
        }
      } else {
        outVx = 0; outVy = 0;
        for (let c = 0; c < nCenters; c++) {
          const dx = px - centersX[c], dy = py - centersY[c];
          const r2 = dx * dx + dy * dy + 500;
          const invR = 1 / Math.sqrt(r2);
          const f = centersStr[c] * dipoleFStr * invR * invR;
          outVx += dx * f * invR;
          outVy += dy * f * invR;
        }
      }
    };

    // Seed particles
    const startX = new Float32Array(actualCount);
    const startY = new Float32Array(actualCount);
    const pColorIdx = new Uint8Array(actualCount);
    for (let i = 0; i < actualCount; i++) {
      startX[i] = rng.range(0, w);
      startY[i] = rng.range(0, h);
      pColorIdx[i] = rng.integer(0, nC - 1);
    }

    // Trail buffers — reused per particle
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dt = 0.5;
    const phaseOffset = t * 0.5;
    const baseAlpha = 0.7 + audioHigh * 0.3;

    const trailX = new Float32Array(trailLen + 1);
    const trailY = new Float32Array(trailLen + 1);
    const trailWrap = new Uint8Array(trailLen); // 1 if segment crosses canvas boundary
    // Cache velocity magnitude during integration for velocity color mode
    const needSpeedCache = colorMode === 'velocity';
    const trailSpeed = needSpeedCache ? new Float32Array(trailLen) : null;

    const maxVisibleSeg = Math.min(trailLen, Math.ceil(baseAlpha / 0.02 * trailLen)) | 0;
    const isFixedColor = colorMode === 'palette' || colorMode === 'age';

    for (let i = 0; i < actualCount; i++) {
      let px = startX[i] + noise.noise2D(startX[i] * 0.001 + phaseOffset, startY[i] * 0.001) * minDim * 0.1;
      let py = startY[i] + noise.noise2D(startX[i] * 0.001, startY[i] * 0.001 + phaseOffset) * minDim * 0.1;

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

        // Wrap with flag
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

      // Draw trail with wrap-aware path breaks
      if (isFixedColor && colorMode === 'palette') {
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
              // Wrapped segment — break path, don't draw cross-canvas line
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

          // Wrapped segment — flush and skip
          if (trailWrap[s]) {
            if (pathOpen) { ctx.stroke(); pathOpen = false; }
            prevR = -1; // force new batch after wrap
            continue;
          }

          const alphaQ = (alpha * 10 + 0.5) | 0;

          let r: number, g: number, b: number;
          if (colorMode === 'velocity') {
            // Use cached speed — no recomputation needed
            const speed = trailSpeed![s];
            const ci = Math.min(nC - 1, (Math.min(1, speed * 0.3) * (nC - 1)) | 0);
            r = colors[ci][0]; g = colors[ci][1]; b = colors[ci][2];
          } else if (colorMode === 'direction') {
            const dx = trailX[s + 1] - trailX[s];
            const dy = trailY[s + 1] - trailY[s];
            const angle = (Math.atan2(dy, dx) + Math.PI) / TAU;
            const ci = Math.max(0, Math.min(nC - 1, (angle * (nC - 1)) | 0));
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
