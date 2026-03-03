import type { Generator, ParameterSchema } from '../../types';
import { SVGPathBuilder } from '../../renderers/svg/builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(colors: [number, number, number][], t: number, alpha = 1): string {
  const ci = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
  const f  = ci - i0;
  const r  = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
  const g  = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
  const b  = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(2)})` : `rgb(${r},${g},${b})`;
}

// GCD for computing the natural period of integer-frequency Lissajous curves
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
  while (b) { const t = b; b = a % b; a = t; }
  return Math.max(1, a);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  ax: {
    name: 'X Frequency',
    type: 'number', min: 1, max: 20, step: 1, default: 5,
    help: 'Frequency of the X oscillation — the ratio ax:ay determines the Lissajous figure shape',
    group: 'Geometry',
  },
  ay: {
    name: 'Y Frequency',
    type: 'number', min: 1, max: 20, step: 1, default: 4,
    help: 'Frequency of the Y oscillation',
    group: 'Geometry',
  },
  phase: {
    name: 'Phase',
    type: 'number', min: 0, max: 6.28, step: 0.1, default: 1.57,
    help: 'Phase offset between X and Y — sweeps through the full family of related curves; π/2 gives the classic ellipse/Lissajous form',
    group: 'Geometry',
  },
  decay: {
    name: 'Decay',
    type: 'number', min: 0, max: 0.5, step: 0.01, default: 0,
    help: 'Harmonograph damping — exponential amplitude decay over time. 0 = closed Lissajous figure. >0 = inward-spiraling harmonograph that converges to the centre, like a real pendulum. Colour gradient highlights the spiral structure.',
    group: 'Geometry',
  },
  layers: {
    name: 'Layers',
    type: 'number', min: 1, max: 6, step: 1, default: 1,
    help: 'Overlapping curves; each successive layer is offset by π/layers in phase, building up a stacked depth and interference structure',
    group: 'Composition',
  },
  samples: {
    name: 'Samples',
    type: 'number', min: 100, max: 10000, step: 100, default: 5000,
    help: 'Number of curve samples — increase for high-frequency ratios or slow decay',
    group: 'Composition',
  },
  thickness: {
    name: 'Line Thickness',
    type: 'number', min: 0.5, max: 5, step: 0.5, default: 2,
    group: 'Texture',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.5,
    help: 'Phase sweep speed — animates the Lissajous shape morphing',
    group: 'Flow/Motion',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const lissajous: Generator = {
  id: 'lissajous',
  family: 'geometry',
  styleName: 'Lissajous & Harmonographs',
  definition: 'Lissajous figures and harmonograph spirals — two sinusoidal oscillations at different frequencies, with optional exponential decay that transforms the closed figure into an inward-spiraling harmonograph',
  algorithmNotes:
    'x(t) = sin(fx·t + φ)·e^(−δt), y(t) = sin(fy·t)·e^(−δt). With δ=0 this is the classic closed Lissajous figure — one full period is 2π/gcd(fx,fy). With δ>0 the amplitude decays exponentially, tracing the inward spiral of a real harmonograph pendulum; the curve is sampled over a long enough time window for the amplitude to reach ~1% of its start. Colour sweeps through the full palette from curve start (outer, bright) to end (centre, dim), making the spiral structure visible. Layers add phase-offset copies of the same curve; with decay they produce nested spirals.',
  parameterSchema,
  defaultParams: {
    ax: 5, ay: 4, phase: 1.57, decay: 0,
    layers: 1, samples: 5000, thickness: 2, speed: 0.5,
  },
  supportsVector: true,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const cx = W / 2, cy = H / 2;
    const scale = Math.min(W, H) * 0.44;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const fx      = Math.max(1, (params.ax      ?? 5) | 0);
    const fy      = Math.max(1, (params.ay      ?? 4) | 0);
    const basePhase = params.phase    ?? 1.57;
    const decay   = Math.max(0, params.decay   ?? 0);
    const layers  = Math.max(1, (params.layers  ?? 1) | 0);
    const samples = Math.max(100, (params.samples ?? 5000) | 0);
    const sw      = params.thickness ?? 2;
    const animPhase = basePhase + time * (params.speed ?? 0.5);

    // One full Lissajous period = 2π / gcd(fx, fy)
    // For harmonograph, sample until amplitude < 1% of start
    const period = (2 * Math.PI) / gcd(fx, fy);
    const tMax   = decay > 0
      ? Math.min(period * 8, Math.log(100) / Math.max(decay, 1e-6))
      : period;

    const rgbColors = palette.colors.map(hexToRgb);
    const nSeg = 80;

    ctx.lineWidth = sw;
    ctx.lineCap = 'round';

    for (let layer = 0; layer < layers; layer++) {
      // Each layer offset by π/layers in phase
      const ph = animPhase + (layer / layers) * Math.PI;

      for (let seg = 0; seg < nSeg; seg++) {
        const t0 = (seg       / nSeg) * tMax;
        const t1 = ((seg + 1) / nSeg) * tMax;

        // Amplitude at start of this segment (for decay dimming)
        const amp = Math.exp(-decay * t0);

        // Colour position along curve — offset slightly per layer
        const ct = ((seg / nSeg) + (layer / Math.max(layers, 1)) * 0.35) % 1;
        ctx.strokeStyle = lerpColor(rgbColors, ct, decay > 0 ? Math.max(0.08, amp) : 1);

        ctx.beginPath();
        const iStart = Math.floor((seg       / nSeg) * samples);
        const iEnd   = Math.ceil(((seg + 1) / nSeg) * samples);
        for (let i = iStart; i <= iEnd; i++) {
          const t   = (i / samples) * tMax;
          const env = Math.exp(-decay * t);
          const x   = cx + Math.sin(fx * t + ph) * scale * env;
          const y   = cy + Math.sin(fy * t)      * scale * env;
          if (i === iStart) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  },

  renderVector(params, seed, palette) {
    const W = 1080, H = 1080;
    const cx = W / 2, cy = H / 2;
    const scale = Math.min(W, H) * 0.44;
    const builder = new SVGPathBuilder();

    const fx      = Math.max(1, (params.ax      ?? 5) | 0);
    const fy      = Math.max(1, (params.ay      ?? 4) | 0);
    const phase   = params.phase   ?? 1.57;
    const decay   = Math.max(0, params.decay ?? 0);
    const samples = Math.max(100, (params.samples ?? 5000) | 0);
    const period  = (2 * Math.PI) / gcd(fx, fy);
    const tMax    = decay > 0
      ? Math.min(period * 8, Math.log(100) / Math.max(decay, 1e-6))
      : period;

    const pts: [number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const t   = (i / samples) * tMax;
      const env = Math.exp(-decay * t);
      pts.push([
        cx + Math.sin(fx * t + phase) * scale * env,
        cy + Math.sin(fy * t)         * scale * env,
      ]);
    }
    builder.addPolyline(pts, palette.colors[0], undefined, params.thickness ?? 2);
    return builder.getPaths();
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return (params.samples ?? 5000) * 0.5; },
};
