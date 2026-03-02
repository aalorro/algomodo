import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  m: {
    name: 'M Frequency',
    type: 'number', min: 1, max: 12, step: 1, default: 3,
    help: 'Horizontal mode number',
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
    type: 'number', min: 0.005, max: 0.1, step: 0.005, default: 0.025,
    help: 'Threshold around zero — wider = thicker nodal lines',
    group: 'Geometry',
  },
  formula: {
    name: 'Formula',
    type: 'select',
    options: ['square', 'circular', 'sum'],
    default: 'square',
    help: 'Membrane shape / equation variant',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color',
    type: 'select',
    options: ['palette-lines', 'heatmap', 'monochrome'],
    default: 'palette-lines',
    group: 'Color',
  },
  showAmplitude: {
    name: 'Show Amplitude',
    type: 'boolean', default: false,
    help: 'Fill regions with amplitude gradient instead of just nodal lines',
    group: 'Color',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.05, max: 3, step: 0.05, default: 0.5,
    help: 'Phase evolution speed — animates the nodal line morphing',
    group: 'Flow/Motion',
  },
};

export const chladni: Generator = {
  id: 'chladni',
  family: 'geometry',
  styleName: 'Chladni Figures',
  definition: 'Visualises the nodal lines of a vibrating plate — the patterns that appear when sand settles on a resonating surface',
  algorithmNotes: 'Evaluates the 2D standing wave equation f(x,y) = cos(m·π·x)·cos(n·π·y) − cos(n·π·x)·cos(m·π·y) at each pixel. Points near zero (nodal lines) are lit.',
  parameterSchema,
  defaultParams: { m: 3, n: 5, tolerance: 0.025, formula: 'square', colorMode: 'palette-lines', showAmplitude: false, speed: 0.5 },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { m, n, tolerance, formula, colorMode, showAmplitude } = params;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Use larger step during animation for performance
    const step = quality === 'draft' || time > 0 ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Background fill
    for (let i = 3; i < data.length; i += 4) data[i] = 255;

    // Phase evolves with time — makes nodal lines morph through phase space
    const phase = time * (params.speed ?? 0.5);

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const x = (px / w) * 2 - 1; // [-1, 1]
        const y = (py / h) * 2 - 1;

        let val: number;
        if (formula === 'circular') {
          const r = Math.sqrt(x * x + y * y);
          const theta = Math.atan2(y, x);
          val = Math.cos(m * Math.PI * r + phase) * Math.cos(n * theta + phase * 0.7);
        } else if (formula === 'sum') {
          val = Math.cos(m * Math.PI * x + phase) * Math.cos(n * Math.PI * y)
              + Math.cos(n * Math.PI * x + phase) * Math.cos(m * Math.PI * y);
        } else {
          // Classic square-plate Chladni with phase rotation
          val = Math.cos(n * Math.PI * x + phase) * Math.cos(m * Math.PI * y)
              - Math.cos(m * Math.PI * x + phase) * Math.cos(n * Math.PI * y);
        }

        const absVal = Math.abs(val);
        const onLine = absVal < tolerance;
        const t = 1 - Math.min(absVal / tolerance, 1); // 1 at nodal line, 0 away

        let r = 0, g = 0, b = 0;

        if (showAmplitude) {
          // Fill whole field with amplitude color
          const amp = (val * 0.5 + 0.5); // 0-1
          const ci = amp * (palette.colors.length - 1);
          const c0 = Math.floor(ci), c1 = Math.min(c0 + 1, palette.colors.length - 1);
          const frac = ci - c0;
          const [r0, g0, b0] = hexToRgb(palette.colors[c0]);
          const [r1, g1, b1] = hexToRgb(palette.colors[c1]);
          r = (r0 + (r1 - r0) * frac) | 0;
          g = (g0 + (g1 - g0) * frac) | 0;
          b = (b0 + (b1 - b0) * frac) | 0;
          // Darken near nodal lines
          const fade = onLine ? (1 - t * 0.8) : 1;
          r = (r * fade) | 0; g = (g * fade) | 0; b = (b * fade) | 0;
        } else if (onLine) {
          if (colorMode === 'monochrome') {
            const v = (t * 255) | 0;
            r = g = b = v;
          } else if (colorMode === 'heatmap') {
            // Heatmap: blue → red
            r = (t * 255) | 0;
            g = (t * 80) | 0;
            b = ((1 - t) * 200) | 0;
          } else {
            // Map position in the nodal line set to palette
            const norm = (val / tolerance * 0.5 + 0.5);
            const ci = norm * (palette.colors.length - 1);
            const c0 = Math.floor(ci), c1 = Math.min(c0 + 1, palette.colors.length - 1);
            const frac = ci - c0;
            const [r0, g0, b0] = hexToRgb(palette.colors[c0]);
            const [r1, g1, b1] = hexToRgb(palette.colors[c1]);
            r = (r0 + (r1 - r0) * frac) | 0;
            g = (g0 + (g1 - g0) * frac) | 0;
            b = (b0 + (b1 - b0) * frac) | 0;
            // Antialiased brightness
            r = (r * t) | 0; g = (g * t) | 0; b = (b * t) | 0;
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
