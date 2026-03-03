import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(colors: [number, number, number][], t: number): [number, number, number] {
  const ci = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
  const f = ci - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

// ---------------------------------------------------------------------------
// Chladni formula evaluation — returns value in roughly [-1, 1]
// ---------------------------------------------------------------------------
function evalChladni(
  formula: string, m: number, n: number,
  x: number, y: number, phase: number,
): number {
  if (formula === 'circular') {
    const r     = Math.sqrt(x * x + y * y);
    const theta = Math.atan2(y, x);
    return Math.cos(m * Math.PI * r + phase) * Math.cos(n * theta + phase * 0.7);
  }
  if (formula === 'sum') {
    return Math.cos(m * Math.PI * x + phase) * Math.cos(n * Math.PI * y)
         + Math.cos(n * Math.PI * x + phase) * Math.cos(m * Math.PI * y);
  }
  if (formula === 'product') {
    // Multiplicative superposition — richer nodal density
    return Math.cos(m * Math.PI * x + phase) * Math.cos(n * Math.PI * y)
         * Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y + phase * 0.6);
  }
  // Classic square-plate Chladni (default)
  return Math.cos(n * Math.PI * x + phase) * Math.cos(m * Math.PI * y)
       - Math.cos(m * Math.PI * x + phase) * Math.cos(n * Math.PI * y);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  m: {
    name: 'M Frequency',
    type: 'number', min: 1, max: 12, step: 1, default: 3,
    help: 'Horizontal mode number — together with N determines the resonant mode shape',
    group: 'Geometry',
  },
  n: {
    name: 'N Frequency',
    type: 'number', min: 1, max: 12, step: 1, default: 5,
    help: 'Vertical mode number',
    group: 'Geometry',
  },
  tolerance: {
    name: 'Line Width',
    type: 'number', min: 0.005, max: 0.12, step: 0.005, default: 0.025,
    help: 'Threshold around zero — wider = thicker nodal lines',
    group: 'Geometry',
  },
  formula: {
    name: 'Formula',
    type: 'select',
    options: ['square', 'circular', 'sum', 'product'],
    default: 'square',
    help: 'square: cos(n·π·x)·cos(m·π·y) − cos(m·π·x)·cos(n·π·y) — classic rectangular plate | circular: cos(m·π·r)·cos(n·θ) — circular membrane, Bessel-like rings | sum: additive superposition — denser symmetric patterns | product: multiplicative coupling — fractal-like nodal web',
    group: 'Composition',
  },
  beatMix: {
    name: 'Beat Mix',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0,
    help: 'Blend between mode (m, n) and mode (n, m) with a time-oscillating weight — the two modes beat against each other, morphing the nodal pattern through a continuous family of shapes. 0 = pure (m,n) mode. 1 = full beat oscillation.',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['nodal', 'amplitude', 'phase', 'signed'],
    default: 'nodal',
    help: 'nodal: dark background, only nodal lines lit — closest to real Chladni sand patterns | amplitude: full field filled by wave amplitude → palette | phase: positive and negative vibration regions filled with palette extremes, nodal lines dark — shows which regions move up vs down | signed: smooth tanh S-curve across the whole field, nodal line at palette midpoint',
    group: 'Color',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.05, max: 3, step: 0.05, default: 0.5,
    help: 'Phase evolution speed — animates nodal line morphing',
    group: 'Flow/Motion',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const chladni: Generator = {
  id: 'chladni',
  family: 'geometry',
  styleName: 'Chladni Figures',
  definition: 'Resonance nodal lines of a vibrating plate — the patterns that appear when sand settles on a resonating surface; four formula variants and a beat-mixing mode that morphs between related mode shapes',
  algorithmNotes:
    'Evaluates the 2D standing wave f(x,y) at each pixel; points near zero (|f| < tolerance) are the nodal lines where sand accumulates on a physical plate. Formula variants: square = cos(n·π·x+φ)·cos(m·π·y) − cos(m·π·x+φ)·cos(n·π·y) (rectangular plate modes); circular = cos(m·π·r+φ)·cos(n·θ+0.7φ) (circular membrane, concentric rings crossed with radial spokes); sum = additive superposition of two modes; product = multiplicative coupling producing denser fractal-like web. Beat mix: val = (1−w)·f(m,n) + w·f(n,m) where w = beatMix·(0.5+0.5·sin(phase·0.8)) oscillates the blend weight in time — the two modes interference-beat, continuously morphing the nodal geometry. Color modes: nodal = nodal-line-only with antialiased brightness; amplitude = full wave amplitude → palette; phase = sign(val) mapped to palette extremes, nodal band dark; signed = tanh(val/tolerance)·0.5+0.5 → smooth S-curve palette.',
  parameterSchema,
  defaultParams: { m: 3, n: 5, tolerance: 0.025, formula: 'square', beatMix: 0, colorMode: 'nodal', speed: 0.5 },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const m         = Math.max(1, (params.m ?? 3) | 0);
    const n         = Math.max(1, (params.n ?? 5) | 0);
    const tolerance = Math.max(0.001, params.tolerance ?? 0.025);
    const formula   = (params.formula   ?? 'square') as string;
    const beatMix   = Math.max(0, Math.min(1, params.beatMix ?? 0));
    const colorMode = (params.colorMode ?? 'nodal') as string;
    const phase     = time * (params.speed ?? 0.5);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const step = quality === 'draft' || time > 0 ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) data[i] = 255;

    // Pre-cache palette
    const rgbPalette = palette.colors.map(hexToRgb);

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const x = (px / w) * 2 - 1;
        const y = (py / h) * 2 - 1;

        // Evaluate mode — optionally blend (m,n) and (n,m) with beat oscillation
        let val = evalChladni(formula, m, n, x, y, phase);
        if (beatMix > 0 && m !== n) {
          const valB = evalChladni(formula, n, m, x, y, phase);
          const w_blend = beatMix * (0.5 + 0.5 * Math.sin(phase * 0.8));
          val = (1 - w_blend) * val + w_blend * valB;
        }

        let r = 0, g = 0, b = 0;
        const absVal = Math.abs(val);

        if (colorMode === 'amplitude') {
          // Entire field filled with amplitude color; nodal lines slightly darkened
          const [pr, pg, pb] = lerpColor(rgbPalette, val * 0.5 + 0.5);
          const dim = absVal < tolerance ? (0.25 + 0.75 * absVal / tolerance) : 1;
          r = (pr * dim) | 0; g = (pg * dim) | 0; b = (pb * dim) | 0;

        } else if (colorMode === 'phase') {
          // + / - regions get palette extremes; nodal band fades to near-black
          if (absVal < tolerance) {
            const fade = absVal / tolerance; // 0 at nodal line, 1 at edge
            const [pr, pg, pb] = lerpColor(rgbPalette, val > 0 ? 1 : 0);
            r = (pr * fade * 0.5) | 0; g = (pg * fade * 0.5) | 0; b = (pb * fade * 0.5) | 0;
          } else {
            const [pr, pg, pb] = lerpColor(rgbPalette, val > 0 ? 1 : 0);
            r = pr; g = pg; b = pb;
          }

        } else if (colorMode === 'signed') {
          // Smooth tanh S-curve across the whole field — nodal line = palette midpoint
          const t = Math.tanh(val / (tolerance * 1.5)) * 0.5 + 0.5;
          [r, g, b] = lerpColor(rgbPalette, t);

        } else {
          // nodal: only draw where |val| < tolerance
          if (absVal < tolerance) {
            const bright = 1 - absVal / tolerance; // 1 at exact zero, 0 at edge
            // Color by position within the nodal band
            const [pr, pg, pb] = lerpColor(rgbPalette, val / tolerance * 0.5 + 0.5);
            r = (pr * bright) | 0; g = (pg * bright) | 0; b = (pb * bright) | 0;
          }
        }

        for (let dy = 0; dy < step && py + dy < h; dy++) {
          for (let dx = 0; dx < step && px + dx < w; dx++) {
            const i = ((py + dy) * w + (px + dx)) * 4;
            data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.04, 0.04, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost() { return 300; },
};
