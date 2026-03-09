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
    options: ['geometric', 'organic', 'crystalline', 'floral'],
    default: 'geometric',
    help: 'geometric: rings × spokes · organic: noise-driven flowing bands · crystalline: hard-edged facets · floral: petal/mandala structures',
    group: 'Composition',
  },
  layers: {
    name: 'Layers',
    type: 'number', min: 1, max: 2, step: 1, default: 1,
    help: '1 = single pattern · 2 = dual-layer with fine secondary detail for depth',
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
  definition: 'Rotating kaleidoscopic symmetry — pixel-perfect mirror folding with geometric, organic, crystalline, and floral pattern modes',
  algorithmNotes:
    'For every pixel, polar angle θ is folded into the base wedge [0, segmentAngle/2] via modulo + ' +
    'mirror, producing true N-fold dihedral (D_N) symmetry. The canonical (r, θ_folded) coordinate ' +
    'drives one of four pattern functions: geometric (harmonic rings × spokes with Moire interference), organic ' +
    '(FBM noise with domain warping), crystalline (multi-scale trig lattice with sigmoid facets), or floral ' +
    '(rose-curve polar modulation for petal structures). Optional dual-layer blending adds fine secondary detail.',
  parameterSchema,
  defaultParams: {
    segments: 8, pattern: 'geometric', layers: 1, speed: 1,
    scale: 2, complexity: 3, colorMode: 'palette', thickness: 1.2,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w  = ctx.canvas.width;
    const h  = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 2;

    const segments   = Math.max(3, Math.round(params.segments ?? 8));
    const pattern    = (params.pattern   ?? 'geometric') as string;
    const numLayers  = Math.max(1, Math.min(2, params.layers ?? 1)) | 0;
    const speed      = params.speed      ?? 1;
    const scale      = params.scale      ?? 2;
    const complexity = params.complexity ?? 3;
    const colorMode  = (params.colorMode ?? 'palette') as string;
    const contrast   = params.thickness  ?? 1.2;

    const segA     = (Math.PI * 2) / segments;
    const half     = segA / 2;
    const rotation = time * speed * 0.28;
    const t        = time * speed;

    const freq = scale * complexity * 0.45;

    // Pre-parse palette colours
    const palRGB: [number, number, number][] = palette.colors.map(hex => {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });
    const nColors = palRGB.length;

    const noise = new SimplexNoise(seed);

    // Quality-adaptive step size
    const step = quality === 'draft' ? 2 : 1;

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

    // Sharpness curve
    const sharpen = (v: number): number => {
      if (Math.abs(contrast - 1) < 0.05) return v;
      return v < 0.5
        ? 0.5 * Math.pow(2 * v, contrast)
        : 1 - 0.5 * Math.pow(2 * (1 - v), contrast);
    };

    // ── Pattern evaluation function ───────────────────────────────────────
    const evalPattern = (rn: number, θF: number, freqMul: number): number => {
      const f = freq * freqMul;

      if (pattern === 'organic') {
        const wx = Math.cos(θF) * rn * scale * 2.2;
        const wy = Math.sin(θF) * rn * scale * 2.2;
        // Domain warp
        const warpX = noise.noise2D(wx * 0.6 + 11.3, wy * 0.6 + t * 0.04) * 0.45;
        const warpY = noise.noise2D(wx * 0.6 + 33.7 + t * 0.03, wy * 0.6 + 22.1) * 0.45;
        // Multi-octave FBM
        const octaves = Math.min(Math.max(complexity, 1), 5);
        const fbmVal = noise.fbm(wx + warpX + 5, wy + warpY + 5, octaves, 2.0, 0.5);
        let v = fbmVal * 0.5 + 0.5;
        v = v * 0.75 + 0.25 * (1 - rn * rn);
        return v;

      } else if (pattern === 'crystalline') {
        const cr = rn * f;
        const cth = θF * segments * 0.5;
        const v1 = Math.sin(cr * Math.PI * 1.3 - t * 0.45);
        const v2 = Math.cos(cth + t * 0.22);
        const v3 = Math.sin(cr * Math.PI * 2.7 + cth * 1.5 + t * 0.15) * 0.5;
        const v4 = Math.cos((cr + cth * 0.7) * Math.PI * 1.8 - t * 0.35) * 0.35;
        const raw = v1 * v2 * 0.4 + v3 * 0.35 + v4 * 0.25;
        const steepness = 4 + contrast * 3;
        return 1 / (1 + Math.exp(-raw * steepness));

      } else if (pattern === 'floral') {
        const k = complexity + 0.5;
        const roseR = Math.cos(k * θF * segments * 0.5 + t * 0.12);
        const rings = Math.sin(rn * f * Math.PI * 0.8 - t * 0.3);
        const raw = roseR * 0.6 + rings * 0.3 + 0.1;
        const nx = Math.cos(θF) * rn * scale + 5;
        const ny = Math.sin(θF) * rn * scale + 5;
        const perturbation = noise.noise2D(nx + t * 0.03, ny) * 0.15;
        return Math.max(0, Math.min(1, raw + perturbation));

      } else {
        // Geometric: harmonic rings × spokes with Moire interference
        const ring1 = Math.sin(rn * f * Math.PI + t * 0.38);
        const ring2 = Math.sin(rn * f * Math.PI * 2.33 - t * 0.22) * 0.4;
        const rings = Math.abs(ring1 + ring2);
        const spoke1 = Math.sin(θF * segments * 0.5 + t * 0.22);
        const spoke2 = Math.sin(θF * segments * 1.17 - t * 0.15) * 0.35;
        const spokes = Math.abs(spoke1 + spoke2);
        return rings * spokes * 0.6 + rings * 0.2 + spokes * 0.15 + 0.05;
      }
    };

    // ── Pixel loop ────────────────────────────────────────────────────────
    const imageData = ctx.createImageData(w, h);
    const data      = imageData.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const dx = px - cx;
        const dy = py - cy;
        const r  = Math.sqrt(dx * dx + dy * dy);

        if (r > maxR) {
          // Fill black for out-of-circle pixels
          for (let fy = 0; fy < step && py + fy < h; fy++) {
            for (let fx = 0; fx < step && px + fx < w; fx++) {
              const fi = ((py + fy) * w + (px + fx)) * 4;
              data[fi + 3] = 255;
            }
          }
          continue;
        }

        // ── Fold θ into canonical wedge [0, half] ──────────────────
        let θ  = Math.atan2(dy, dx) - rotation;
        θ      = ((θ % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let θF = θ % segA;
        if (θF > half) θF = segA - θF;

        const rn = r / maxR;

        // ── Compute pattern value ───────────────────────────────────
        let value = evalPattern(rn, θF, 1.0);

        // Dual-layer blending
        if (numLayers >= 2) {
          const secondary = evalPattern(rn, θF, 2.1) * 0.3;
          // Screen composite: 1 - (1 - a) * (1 - b)
          value = 1 - (1 - value) * (1 - secondary);
        }

        // ── Apply contrast ─────────────────────────────────────────
        value = sharpen(Math.max(0, Math.min(1, value)));

        // ── Color mode ─────────────────────────────────────────────
        let r_col: number, g_col: number, b_col: number;

        if (colorMode === 'depth') {
          const [rv, gv, bv] = paletteAt(value);
          const [rr, gr, br] = paletteAt(rn);
          r_col = rv * 0.65 + rr * 0.35;
          g_col = gv * 0.65 + gr * 0.35;
          b_col = bv * 0.65 + br * 0.35;

        } else if (colorMode === 'iridescent') {
          const angleShift = (θF / half) * 0.35;
          const timeShift  = Math.sin(t * 0.55) * 0.08;
          const shiftedV   = (value + angleShift + timeShift) % 1;
          [r_col, g_col, b_col] = paletteAt(Math.max(0, shiftedV));

        } else {
          [r_col, g_col, b_col] = paletteAt(value);
        }

        // ── Improved vignette with color bleed ──────────────────────
        if (rn > 0.82) {
          const vigT = (rn - 0.82) / 0.18;
          const vigT2 = vigT * vigT;
          const [er, eg, eb] = palRGB[nColors - 1];
          r_col = r_col * (1 - vigT2 * 0.4) + er * vigT2 * 0.3;
          g_col = g_col * (1 - vigT2 * 0.4) + eg * vigT2 * 0.3;
          b_col = b_col * (1 - vigT2 * 0.4) + eb * vigT2 * 0.3;
          const dim = 1 - vigT2 * vigT * 0.85;
          r_col *= dim; g_col *= dim; b_col *= dim;
        }

        // ── Improved center glow with smoothstep ────────────────────
        if (rn < 0.08) {
          const glow = 1 - rn / 0.08;
          const glowSmooth = glow * glow * (3 - 2 * glow);
          r_col = r_col + (255 - r_col) * glowSmooth * 0.6;
          g_col = g_col + (255 - g_col) * glowSmooth * 0.6;
          b_col = b_col + (255 - b_col) * glowSmooth * 0.6;
        }

        // ── Write pixels (fill step x step block for draft mode) ────
        const rc = r_col | 0, gc = g_col | 0, bc = b_col | 0;
        for (let fy = 0; fy < step && py + fy < h; fy++) {
          for (let fx = 0; fx < step && px + fx < w; fx++) {
            const fi = ((py + fy) * w + (px + fx)) * 4;
            data[fi]     = rc;
            data[fi + 1] = gc;
            data[fi + 2] = bc;
            data[fi + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  estimateCost(params) {
    return Math.round(params.segments * params.complexity * 100);
  },
};
