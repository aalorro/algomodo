import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  scale: {
    name: 'Scale',
    type: 'number', min: 0.5, max: 6, step: 0.1, default: 2.0,
    group: 'Composition',
  },
  layers: {
    name: 'Layers',
    type: 'number', min: 1, max: 5, step: 1, default: 3,
    help: 'Number of overlapping noise octaves — each successive layer doubles the frequency and halves the amplitude',
    group: 'Composition',
  },
  warp: {
    name: 'Warp',
    type: 'number', min: 0, max: 2, step: 0.1, default: 0.8,
    help: 'Double domain-warp intensity — displaces sample coordinates twice using independent noise fields, creating deep turbulent feedback-like structure. 0 = plain FBM. 1–2 = rich folded plasma.',
    group: 'Composition',
  },
  twist: {
    name: 'Twist',
    type: 'number', min: 0, max: 1.5, step: 0.05, default: 0,
    help: 'Rotational warp — a noise-driven rotation angle is applied to each layer\'s sample coordinates, producing swirling helical and spiral structures. 0 = no rotation.',
    group: 'Composition',
  },
  contrast: {
    name: 'Contrast',
    type: 'number', min: 0.5, max: 3, step: 0.1, default: 1.4,
    group: 'Texture',
  },
  pulse: {
    name: 'Pulse',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0,
    help: 'Scale breathing — oscillates the global zoom as scale × (1 + pulse × sin(t)), making the entire field expand and contract rhythmically',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.1, max: 3, step: 0.05, default: 0.6,
    group: 'Flow/Motion',
  },
  blend: {
    name: 'Blend Mode',
    type: 'select',
    options: ['smooth', 'additive', 'bands', 'ripple'],
    default: 'smooth',
    help: 'smooth: maps [−1,1] linearly to [0,1] | additive: abs(v) for symmetric bright plasma | bands: sin(v·4π + t) animated colour rings | ripple: two-frequency sine interference — multi-scale wave patterns',
    group: 'Color',
  },
};

export const plasmaFeedback: Generator = {
  id: 'plasma-feedback',
  family: 'animation',
  styleName: 'Plasma Feedback',
  definition: 'Layered simplex noise with double domain warping — each pixel\'s sample coordinate is displaced twice by independent noise fields before layer accumulation, producing self-referential turbulence; optional rotational twist and scale pulse add swirling and breathing motion',
  algorithmNotes:
    'Double domain warp: pass 1 displaces (nx, ny) by two decorrelated noise fields (large constant offsets ensure independence) for X and Y warp; pass 2 re-displaces the already-warped coordinates using two more noise fields at 60% amplitude, simulating a feedback loop where the warp field warps itself. Layer accumulation samples the doubly-warped position at geometrically increasing frequencies (lacunarity 1.8) with per-layer amplitude decay 0.55. Twist applies a noise-driven 2D rotation matrix to the layer sampling position — angle = noise(bx·0.4 + l·5.3, by·0.4 + t·0.08) · twist · π — producing helical swirling at controlled intensity. Pulse modulates the global scale as sc = scale · (1 + pulse · sin(t·0.7)). Blend modes: smooth = v·0.5+0.5; additive = |v|; bands = sin(v·4π + t·0.4)·0.5+0.5; ripple = 0.6·sin(v·6π + t·0.6) + 0.4·sin(v·2π + t·0.2), combining two sine frequencies for multi-scale wave interference.',
  parameterSchema,
  defaultParams: { scale: 2.0, speed: 0.6, layers: 3, contrast: 1.4, warp: 0.8, twist: 0, pulse: 0, blend: 'smooth' },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const scale    = params.scale    ?? 2.0;
    const spd      = params.speed    ?? 0.6;
    const nLayers  = Math.max(1, (params.layers   ?? 3) | 0);
    const contrast = params.contrast ?? 1.4;
    const warp     = params.warp     ?? 0.8;
    const blend    = (params.blend   ?? 'smooth') as string;
    const twist    = params.twist    ?? 0;
    const pulse    = params.pulse    ?? 0;

    const step = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const noise = new SimplexNoise(seed);
    const t = time * spd;

    // Pre-cache palette RGB
    const rgbPalette = palette.colors.map(hexToRgb);
    const nColors = rgbPalette.length;

    // Pulse: global scale breathes with a low-frequency sine
    const sc = scale * (1 + pulse * Math.sin(t * 0.7));

    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const nx = (px / w) * sc;
        const ny = (py / h) * sc;

        // --- Double domain warp ---
        // Pass 1: two decorrelated noise fields displace X and Y independently
        const w1x = noise.noise2D(nx * 0.8 + t * 0.31,         ny * 0.8 + 19.3) * warp;
        const w1y = noise.noise2D(nx * 0.8 + 47.2,              ny * 0.8 + t * 0.27 + 33.1) * warp;

        // Pass 2: warp the warped coordinates again — feedback loop structure
        const w2x = noise.noise2D(nx + w1x + t * 0.19 + 88.7,  ny + w1y + 61.4) * warp * 0.6;
        const w2y = noise.noise2D(nx + w1x + 103.5,             ny + w1y + t * 0.23 + 77.2) * warp * 0.6;

        const bx = nx + w1x + w2x;
        const by = ny + w1y + w2y;

        // --- Layer accumulation ---
        let acc = 0, amp = 1, totalAmp = 0;

        for (let l = 0; l < nLayers; l++) {
          const freq = Math.pow(1.8, l);
          const dir  = l % 2 === 0 ? 1 : -1;

          let sx: number, sy: number;

          if (twist > 0) {
            // Noise-driven rotation of the per-layer sample position
            const angle = noise.noise2D(bx * 0.4 + l * 5.3, by * 0.4 + t * 0.08) * twist * Math.PI;
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            const rx = bx * freq, ry = by * freq;
            sx = (rx * cosA - ry * sinA) + t * 0.11 * dir;
            sy = (rx * sinA + ry * cosA) + t * 0.09 * dir;
          } else {
            sx = bx * freq + t * 0.11 * dir;
            sy = by * freq + t * 0.09 * dir;
          }

          acc += noise.noise2D(sx, sy) * amp;
          totalAmp += amp;
          amp *= 0.55;
        }

        let v = acc / totalAmp; // [-1, 1]

        // --- Blend modes ---
        if (blend === 'bands') {
          v = Math.sin(v * Math.PI * 4 + t * 0.4) * 0.5 + 0.5;
        } else if (blend === 'additive') {
          v = Math.abs(v);
        } else if (blend === 'ripple') {
          // Two-frequency sine interference for multi-scale wave patterns
          v = (Math.sin(v * Math.PI * 6 + t * 0.6) * 0.6 + Math.sin(v * Math.PI * 2 + t * 0.2) * 0.4) * 0.5 + 0.5;
        } else {
          v = v * 0.5 + 0.5;
        }

        v = Math.pow(Math.max(0, Math.min(1, v)), 1 / contrast);

        // Palette lerp
        const ci = v * (nColors - 1);
        const c0 = Math.floor(ci), c1 = Math.min(c0 + 1, nColors - 1);
        const frac = ci - c0;
        const [r0, g0, b0] = rgbPalette[c0];
        const [r1, g1, b1] = rgbPalette[c1];
        const pr = (r0 + (r1 - r0) * frac) | 0;
        const pg = (g0 + (g1 - g0) * frac) | 0;
        const pb = (b0 + (b1 - b0) * frac) | 0;

        for (let dy = 0; dy < step && py + dy < h; dy++) {
          for (let dx = 0; dx < step && px + dx < w; dx++) {
            const i = ((py + dy) * w + (px + dx)) * 4;
            data[i] = pr; data[i + 1] = pg; data[i + 2] = pb; data[i + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.05, 0.02, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return (params.layers ?? 3) * 180; },
};
