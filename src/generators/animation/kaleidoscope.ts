import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  segments: {
    name: 'Segments',
    type: 'number', min: 3, max: 24, step: 1, default: 8,
    help: 'Number of mirror segments — must be ≥ 3',
    group: 'Composition',
  },
  pattern: {
    name: 'Pattern',
    type: 'select',
    options: ['geometric', 'organic', 'crystalline'],
    default: 'geometric',
    help: 'geometric: concentric rings × spokes · organic: noise-driven flowing bands · crystalline: hard-edged facets',
    group: 'Composition',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.1, max: 3, step: 0.1, default: 1,
    help: 'Rotation and evolution speed',
    group: 'Flow/Motion',
  },
  scale: {
    name: 'Scale',
    type: 'number', min: 0.5, max: 5, step: 0.5, default: 2,
    help: 'Spatial zoom of the pattern',
    group: 'Geometry',
  },
  complexity: {
    name: 'Complexity',
    type: 'number', min: 1, max: 8, step: 1, default: 3,
    help: 'Number of concentric bands / detail rings',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'depth', 'iridescent'],
    default: 'palette',
    help: 'palette: value → gradient · depth: radius shifts hue · iridescent: angle + time chromatic shimmer',
    group: 'Color',
  },
  thickness: {
    name: 'Contrast',
    type: 'number', min: 0.3, max: 3, step: 0.1, default: 1.2,
    help: 'Edge sharpness — higher pushes patterns toward hard transitions',
    group: 'Texture',
  },
};

// ─── Generator ────────────────────────────────────────────────────────────────

export const kaleidoscope: Generator = {
  id: 'kaleidoscope',
  family: 'animation',
  styleName: 'Kaleidoscope',
  definition: 'Rotating kaleidoscopic symmetry — pixel-perfect mirror folding with geometric, organic and crystalline pattern modes',
  algorithmNotes:
    'For every pixel, polar angle θ is folded into the base wedge [0, segmentAngle/2] via modulo + ' +
    'mirror, producing true N-fold dihedral (D_N) symmetry. The canonical (r, θ_folded) coordinate ' +
    'drives one of three pattern functions: geometric (concentric rings × radial spokes), organic ' +
    '(Simplex noise at folded Cartesian coordinates), or crystalline (trig lattice pushed through a ' +
    'sigmoid for hard facets). Color Shift and iridescent mode add angular and time-varying hue drift.',
  parameterSchema,
  defaultParams: {
    segments: 8, pattern: 'geometric', speed: 1,
    scale: 2, complexity: 3, colorMode: 'palette', thickness: 1.2,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w  = ctx.canvas.width;
    const h  = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 2;

    const segments   = Math.max(3, Math.round(params.segments ?? 8));
    const pattern    = (params.pattern   ?? 'geometric') as string;
    const speed      = params.speed      ?? 1;
    const scale      = params.scale      ?? 2;
    const complexity = params.complexity ?? 3;
    const colorMode  = (params.colorMode ?? 'palette') as string;
    const contrast   = params.thickness  ?? 1.2;

    const segA     = (Math.PI * 2) / segments;
    const half     = segA / 2;
    const rotation = time * speed * 0.28;
    const t        = time * speed;

    // Effective spatial frequency — scale and complexity both contribute
    const freq = scale * complexity * 0.45;

    // Pre-parse palette colours for fast access
    const palRGB: [number, number, number][] = palette.colors.map(hex => {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });
    const nColors = palRGB.length;

    const noise = new SimplexNoise(seed);

    // ── Color mapping helper ──────────────────────────────────────────────
    const paletteAt = (v: number): [number, number, number] => {
      v = Math.max(0, Math.min(1, v));
      const ci   = v * (nColors - 1);
      const c0   = Math.floor(ci);
      const c1   = Math.min(c0 + 1, nColors - 1);
      const frac = ci - c0;
      const [r0, g0, b0] = palRGB[c0];
      const [r1, g1, b1] = palRGB[c1];
      return [r0 + (r1 - r0) * frac, g0 + (g1 - g0) * frac, b0 + (b1 - b0) * frac];
    };

    // Sharpness curve: pushes values toward 0 / 1 (contrast > 1) or softens (< 1)
    const sharpen = (v: number): number => {
      if (Math.abs(contrast - 1) < 0.05) return v;
      return v < 0.5
        ? 0.5 * Math.pow(2 * v, contrast)
        : 1 - 0.5 * Math.pow(2 * (1 - v), contrast);
    };

    // ── Pixel loop ────────────────────────────────────────────────────────
    const imageData = ctx.createImageData(w, h);
    const data      = imageData.data;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const r  = Math.sqrt(dx * dx + dy * dy);
        const idx = (py * w + px) * 4;
        data[idx + 3] = 255; // alpha always opaque

        if (r > maxR) continue; // leave as black

        // ── Fold θ into the canonical wedge [0, half] ──────────────────
        let θ  = Math.atan2(dy, dx) - rotation;
        θ      = ((θ % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let θF = θ % segA;
        if (θF > half) θF = segA - θF; // mirror

        const rn = r / maxR; // [0, 1]

        // ── Pattern function ───────────────────────────────────────────
        let value: number;

        if (pattern === 'organic') {
          // Evaluate noise in Cartesian folded-wedge space
          const nx = Math.cos(θF) * rn * scale * 2.2 + 5;
          const ny = Math.sin(θF) * rn * scale * 2.2 + 5;
          value = noise.noise2D(nx + t * 0.065, ny + t * 0.05) * 0.5 + 0.5;
          // Blend toward brightness at centre
          value = value * 0.8 + 0.2 * (1 - rn * 0.75);

        } else if (pattern === 'crystalline') {
          // Trig lattice → pushed through sigmoid for gem-like facets
          const v1 = Math.sin(rn * freq * Math.PI * 1.1 - t * 0.55);
          const v2 = Math.cos(θF * segments * 0.5 + t * 0.28);
          const v3 = Math.sin((rn * 0.65 + θF / Math.PI) * freq * Math.PI + t * 0.38);
          const raw = (v1 * v2 * 0.55 + v3 * 0.45);
          // Sigmoid sharpening for hard crystalline edges
          value = 1 / (1 + Math.exp(-raw * 5));

        } else {
          // Geometric: concentric rings × angular spokes + shimmering overtone
          const rings   = Math.abs(Math.sin(rn * freq * Math.PI + t * 0.38));
          const spokes  = Math.abs(Math.sin(θF * segments * 0.5 + t * 0.22));
          const shimmer = Math.sin(rn * freq * 0.55 * Math.PI - t * 0.55) * 0.18;
          value = rings * spokes + shimmer * 0.32 + 0.1;
        }

        // ── Apply contrast ─────────────────────────────────────────────
        value = sharpen(Math.max(0, Math.min(1, value)));

        // ── Color mode adjustments ─────────────────────────────────────
        let r_col: number, g_col: number, b_col: number;

        if (colorMode === 'depth') {
          // Blend value-driven color with a radius-derived palette shift
          const [rv, gv, bv] = paletteAt(value);
          const radiusT = rn;
          const [rr, gr, br] = paletteAt(radiusT);
          r_col = rv * 0.65 + rr * 0.35;
          g_col = gv * 0.65 + gr * 0.35;
          b_col = bv * 0.65 + br * 0.35;

        } else if (colorMode === 'iridescent') {
          // Angle and time shift the palette lookup for chromatic shimmer
          const angleShift = (θF / half) * 0.35;
          const timeShift  = Math.sin(t * 0.55) * 0.08;
          const shiftedV   = (value + angleShift + timeShift) % 1;
          [r_col, g_col, b_col] = paletteAt(Math.max(0, shiftedV));

        } else {
          // Plain palette mapping
          [r_col, g_col, b_col] = paletteAt(value);
        }

        // ── Radial vignette: darken within the outermost 10% of the circle
        const vigStart = 0.90;
        if (rn > vigStart) {
          const vf = (rn - vigStart) / (1 - vigStart);
          const dim = 1 - vf * vf * 0.8;
          r_col *= dim; g_col *= dim; b_col *= dim;
        }

        // ── Glowing centre highlight ───────────────────────────────────
        if (rn < 0.045) {
          const glow = 1 - rn / 0.045;
          r_col = r_col + (255 - r_col) * glow * 0.75;
          g_col = g_col + (255 - g_col) * glow * 0.75;
          b_col = b_col + (255 - b_col) * glow * 0.75;
        }

        data[idx]     = r_col | 0;
        data[idx + 1] = g_col | 0;
        data[idx + 2] = b_col | 0;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  estimateCost(params) {
    return Math.round(params.segments * params.complexity * 100);
  },
};
