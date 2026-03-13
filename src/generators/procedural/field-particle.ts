import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

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
};

interface VortexCenter {
  x: number; y: number; strength: number;
}

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
    lineWidth: 1.0, colorMode: 'velocity', speed: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const minDim = Math.min(w, h);

    const pCount = Math.max(50, params.particleCount ?? 1500) | 0;
    const fieldType = params.fieldType || 'curl';
    const trailLen = Math.max(5, params.trailLength ?? 80) | 0;
    const fStr = params.fieldStrength ?? 1.0;
    const lw = params.lineWidth ?? 1.0;
    const colorMode = params.colorMode || 'velocity';
    const spd = params.speed ?? 1.0;
    const t = time * spd;

    const qualityMult = quality === 'draft' ? 0.5 : quality === 'ultra' ? 1.0 : 0.75;
    const actualCount = Math.round(pCount * qualityMult);

    const colors = palette.colors.map(hexToRgb);
    const nC = colors.length;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Field-specific setup
    const EPS = 0.5;
    const noiseScale = 3.0 / minDim;

    // Vortex / attractor / dipole centers
    const centers: VortexCenter[] = [];
    if (fieldType === 'vortex' || fieldType === 'attractor' || fieldType === 'dipole') {
      const nCenters = fieldType === 'dipole' ? 2 : rng.integer(2, 4);
      for (let i = 0; i < nCenters; i++) {
        centers.push({
          x: rng.range(w * 0.2, w * 0.8),
          y: rng.range(h * 0.2, h * 0.8),
          strength: rng.range(0.5, 2.0) * (fieldType === 'dipole' ? (i === 0 ? 1 : -1) : 1),
        });
      }
    }

    // Vector field evaluation
    const getVelocity = (px: number, py: number): [number, number] => {
      if (fieldType === 'curl') {
        // Numerical curl of noise
        const nx = px * noiseScale;
        const ny = py * noiseScale;
        const n0 = noise.noise2D(nx, ny + EPS * noiseScale);
        const n1 = noise.noise2D(nx, ny - EPS * noiseScale);
        const n2 = noise.noise2D(nx + EPS * noiseScale, ny);
        const n3 = noise.noise2D(nx - EPS * noiseScale, ny);
        const vx = (n0 - n1) * fStr * 2;
        const vy = -(n2 - n3) * fStr * 2;
        return [vx, vy];
      } else if (fieldType === 'attractor') {
        let vx = 0, vy = 0;
        for (const c of centers) {
          const dx = c.x - px, dy = c.y - py;
          const r2 = dx * dx + dy * dy + 1000;
          const f = c.strength * fStr * 50000 / r2;
          // Swirl: rotate pull 90 degrees for tangential component
          vx += (-dy * f * 0.7 + dx * f * 0.3);
          vy += (dx * f * 0.7 + dy * f * 0.3);
        }
        return [vx, vy];
      } else if (fieldType === 'vortex') {
        let vx = 0, vy = 0;
        for (const c of centers) {
          const dx = px - c.x, dy = py - c.y;
          const r = Math.sqrt(dx * dx + dy * dy) + 10;
          const f = c.strength * fStr * 200 / r;
          vx += -dy * f / r;
          vy += dx * f / r;
        }
        return [vx, vy];
      } else {
        // dipole
        let vx = 0, vy = 0;
        for (const c of centers) {
          const dx = px - c.x, dy = py - c.y;
          const r2 = dx * dx + dy * dy + 500;
          const f = c.strength * fStr * 30000 / (r2);
          vx += dx * f / Math.sqrt(r2);
          vy += dy * f / Math.sqrt(r2);
        }
        return [vx, vy];
      }
    };

    // Seed particles
    const startX: number[] = [];
    const startY: number[] = [];
    const pColorIdx: number[] = [];
    for (let i = 0; i < actualCount; i++) {
      startX[i] = rng.range(0, w);
      startY[i] = rng.range(0, h);
      pColorIdx[i] = rng.integer(0, nC - 1);
    }

    // Integrate and draw trails
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dt = 0.5;

    // Time-based phase offset for animation
    const phaseOffset = t * 0.5;

    for (let i = 0; i < actualCount; i++) {
      // Offset starting position by time-driven noise for animation
      let px = startX[i] + noise.noise2D(startX[i] * 0.001 + phaseOffset, startY[i] * 0.001) * minDim * 0.1;
      let py = startY[i] + noise.noise2D(startX[i] * 0.001, startY[i] * 0.001 + phaseOffset) * minDim * 0.1;

      // Integrate trail
      const trail: [number, number][] = [[px, py]];
      for (let s = 0; s < trailLen; s++) {
        const [vx, vy] = getVelocity(px, py);
        px += vx * dt;
        py += vy * dt;
        // Wrap around
        if (px < 0) px += w; else if (px > w) px -= w;
        if (py < 0) py += h; else if (py > h) py -= h;
        trail.push([px, py]);
      }

      // Draw trail segments with fading alpha
      for (let s = 0; s < trail.length - 1; s++) {
        const age = s / trailLen; // 0 = head, 1 = tail
        const alpha = (1 - age) * 0.7;
        if (alpha < 0.02) break;

        let r: number, g: number, b: number;
        if (colorMode === 'velocity') {
          const [vx, vy] = getVelocity(trail[s][0], trail[s][1]);
          const speed = Math.sqrt(vx * vx + vy * vy);
          const ci = Math.min(nC - 1, Math.floor(Math.min(1, speed * 0.3) * (nC - 1)));
          [r, g, b] = colors[ci];
        } else if (colorMode === 'direction') {
          const dx = trail[s + 1][0] - trail[s][0];
          const dy = trail[s + 1][1] - trail[s][1];
          const angle = (Math.atan2(dy, dx) + Math.PI) / TAU;
          const ci = Math.floor(angle * (nC - 1));
          [r, g, b] = colors[Math.max(0, Math.min(nC - 1, ci))];
        } else if (colorMode === 'age') {
          const ci = Math.floor(age * (nC - 1));
          [r, g, b] = colors[ci];
        } else {
          [r, g, b] = colors[pColorIdx[i]];
        }

        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(trail[s][0], trail[s][1]);
        ctx.lineTo(trail[s + 1][0], trail[s + 1][1]);
        ctx.stroke();
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
