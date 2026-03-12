import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  ringCount: {
    name: 'Ring Count',
    type: 'number', min: 1, max: 12, step: 1, default: 5,
    help: 'Number of concentric guilloché rings',
    group: 'Composition',
  },
  petals: {
    name: 'Petals',
    type: 'number', min: 3, max: 20, step: 1, default: 7,
    help: 'Number of lobes per ring',
    group: 'Composition',
  },
  curveType: {
    name: 'Curve Type',
    type: 'select',
    options: ['hypotrochoid', 'epitrochoid', 'rose', 'lissajous'],
    default: 'hypotrochoid',
    help: 'hypotrochoid: inner rolling circle | epitrochoid: outer rolling | rose: polar petals | lissajous: frequency ratio',
    group: 'Composition',
  },
  linesPerRing: {
    name: 'Lines Per Ring',
    type: 'number', min: 1, max: 6, step: 1, default: 1,
    help: 'Multiple phase-offset curves per ring — creates dense weave/moiré',
    group: 'Composition',
  },
  eccentricity: {
    name: 'Eccentricity',
    type: 'number', min: 0.1, max: 0.98, step: 0.02, default: 0.65,
    help: 'Petal depth — 0 = circle, approaching 1 = sharp cusps',
    group: 'Geometry',
  },
  ringSpread: {
    name: 'Ring Spread',
    type: 'number', min: 0.03, max: 0.2, step: 0.01, default: 0.09,
    help: 'Radial gap between successive rings (fraction of canvas half-size)',
    group: 'Geometry',
  },
  waveModulation: {
    name: 'Wave Modulation',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0,
    help: 'Sinusoidal radius modulation — adds undulating wave to each ring',
    group: 'Geometry',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.25, max: 3, step: 0.25, default: 0.75,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-rings', 'interference', 'gradient-sweep'],
    default: 'palette-rings',
    help: 'monochrome: single ink | palette-rings: one color per ring | interference: alternating | gradient-sweep: hue rotates along each curve',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
  spinSpeed: {
    name: 'Spin Speed',
    type: 'number', min: 0, max: 3.0, step: 0.05, default: 0.5,
    help: 'Rotation speed (rad/s). Each ring spins at a different rate with alternating direction.',
    group: 'Flow/Motion',
  },
};

export const guilloche: Generator = {
  id: 'plotter-guilloche',
  family: 'plotter',
  styleName: 'Guilloché',
  definition: 'Concentric parametric curve rings producing the interference moiré of banknote security print',
  algorithmNotes:
    'Multiple curve families (hypotrochoid, epitrochoid, rose, lissajous) are available. Each ring can contain multiple phase-offset lines that weave together, creating authentic guilloché density. Wave modulation adds sinusoidal radius breathing. Successive rings have slightly different eccentricity for natural interference.',
  parameterSchema,
  defaultParams: {
    ringCount: 5, petals: 7, curveType: 'hypotrochoid', linesPerRing: 1,
    eccentricity: 0.65, ringSpread: 0.09, waveModulation: 0,
    lineWidth: 0.75, colorMode: 'palette-rings', background: 'cream', spinSpeed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const cxc = w / 2, cyc = h / 2;
    const halfSize = Math.min(w, h) * 0.48;
    const ringCount = Math.max(1, params.ringCount ?? 5) | 0;
    const k = Math.max(3, params.petals ?? 7) | 0;
    const eccBase = params.eccentricity ?? 0.65;
    const spread = params.ringSpread ?? 0.09;
    const spinSpeed = params.spinSpeed ?? 0.12;
    const colorMode = params.colorMode || 'palette-rings';
    const curveType = params.curveType || 'hypotrochoid';
    const linesPerRing = Math.max(1, Math.min(6, params.linesPerRing ?? 1)) | 0;
    const waveMod = params.waveModulation ?? 0;
    const colors = palette.colors.map(hexToRgb);
    const isDark = params.background === 'dark';

    ctx.lineWidth = params.lineWidth ?? 0.75;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const STEPS = 1800;

    for (let ri = 0; ri < ringCount; ri++) {
      const eccStatic = eccBase * (0.78 + ri * 0.06 + rng.random() * 0.08);
      const ringRadiusBase = halfSize * (0.3 + ri * spread);

      // Alternating rotation direction; each ring spins at a different rate
      const direction = ri % 2 === 0 ? 1 : -1;
      const ringSpeedMult = 1 + ri * 0.18;
      const phase = time * spinSpeed * direction * ringSpeedMult;

      // Breathing: radius oscillates per ring at offset frequencies
      const breathe = spinSpeed > 0
        ? 1 + 0.04 * Math.sin(time * (0.5 + ri * 0.12) * Math.PI * 2)
        : 1;
      const ringRadius = ringRadiusBase * breathe;

      // Eccentricity oscillation: petals gently grow/shrink over time
      const eccOsc = spinSpeed > 0
        ? 0.06 * Math.sin(time * 0.4 * Math.PI * 2 + ri * 0.8)
        : 0;
      const ecc = Math.max(0.1, Math.min(0.98, eccStatic + eccOsc));

      for (let li = 0; li < linesPerRing; li++) {
        // Phase offset per sub-line — creates weave
        const linePhase = phase + (li / linesPerRing) * Math.PI * 2 / k;

        // Color
        let cr: number, cg: number, cb: number;
        if (colorMode === 'palette-rings') {
          [cr, cg, cb] = colors[ri % colors.length];
        } else if (colorMode === 'interference') {
          [cr, cg, cb] = ri % 2 === 0 ? colors[0] : colors[colors.length - 1];
        } else if (colorMode === 'gradient-sweep') {
          // Will set per-segment below
          [cr, cg, cb] = colors[0];
        } else if (isDark) {
          [cr, cg, cb] = [220, 220, 220];
        } else {
          [cr, cg, cb] = [30, 30, 30];
        }

        const alpha = isDark ? 0.85 : 0.80;
        // Reduce opacity per extra sub-line to prevent over-saturation
        const lineAlpha = linesPerRing > 1 ? alpha * (0.5 + 0.5 / linesPerRing) : alpha;

        if (colorMode === 'gradient-sweep') {
          // Draw as multiple short segments with color sweeping along the curve
          const segLen = Math.ceil(STEPS / 60);
          for (let segStart = 0; segStart < STEPS; segStart += segLen) {
            const segEnd = Math.min(segStart + segLen + 1, STEPS);
            const t0 = segStart / STEPS;
            const ci = t0 * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
            cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
            cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${lineAlpha})`;
            ctx.beginPath();
            for (let step = segStart; step <= segEnd; step++) {
              const pt = curvePoint(step / STEPS, linePhase, k, ecc, ringRadius, waveMod, curveType);
              if (step === segStart) ctx.moveTo(cxc + pt[0], cyc + pt[1]);
              else ctx.lineTo(cxc + pt[0], cyc + pt[1]);
            }
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${lineAlpha})`;
          ctx.beginPath();
          for (let step = 0; step <= STEPS; step++) {
            const pt = curvePoint(step / STEPS, linePhase, k, ecc, ringRadius, waveMod, curveType);
            if (step === 0) ctx.moveTo(cxc + pt[0], cyc + pt[1]);
            else ctx.lineTo(cxc + pt[0], cyc + pt[1]);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return ((params.ringCount ?? 5) * (params.linesPerRing ?? 1) * 9) | 0;
  },
};

/** Compute a point on the selected curve type at parameter t (0-1) */
function curvePoint(
  t01: number, phase: number, k: number, ecc: number,
  ringRadius: number, waveMod: number, curveType: string,
): [number, number] {
  const t = t01 * Math.PI * 2 + phase;
  const d = k * ecc;
  let x: number, y: number, maxRad: number;

  if (curveType === 'epitrochoid') {
    // Outer rolling circle: x=(k+1)cos(t)-d·cos((k+1)t), y=(k+1)sin(t)-d·sin((k+1)t)
    const kp1 = k + 1;
    maxRad = kp1 + d;
    const s = ringRadius / maxRad;
    x = s * (kp1 * Math.cos(t) - d * Math.cos(kp1 * t));
    y = s * (kp1 * Math.sin(t) - d * Math.sin(kp1 * t));
  } else if (curveType === 'rose') {
    // Rose/rhodonea: r = cos(k·θ)
    const r = Math.cos(k * t);
    x = ringRadius * r * Math.cos(t);
    y = ringRadius * r * Math.sin(t);
  } else if (curveType === 'lissajous') {
    // Lissajous: x=sin(k·t+phase), y=sin((k+1)·t)
    const lissPhase = ecc * Math.PI;
    x = ringRadius * Math.sin(k * t + lissPhase);
    y = ringRadius * Math.sin((k + 1) * t);
  } else {
    // hypotrochoid (default)
    maxRad = k + d;
    const s = ringRadius / maxRad;
    x = s * (k * Math.cos(t) + d * Math.cos(k * t));
    y = s * (k * Math.sin(t) - d * Math.sin(k * t));
  }

  // Wave modulation: sinusoidal breathing on the radius
  if (waveMod > 0) {
    const waveFreq = k * 3;
    const wave = 1 + waveMod * 0.3 * Math.sin(waveFreq * t);
    x *= wave;
    y *= wave;
  }

  return [x, y];
}
