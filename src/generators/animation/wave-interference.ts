import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  waveCount: {
    name: 'Sources',
    type: 'number', min: 2, max: 10, step: 1, default: 4,
    help: 'Number of wave emission sources',
    group: 'Composition',
  },
  waveType: {
    name: 'Wave Type',
    type: 'select',
    options: ['circular', 'spiral', 'plane', 'mixed'],
    default: 'circular',
    help: 'circular: radial rings · spiral: twisted rings · plane: directional beam · mixed: one of each per source',
    group: 'Composition',
  },
  frequency: {
    name: 'Frequency',
    type: 'number', min: 0.5, max: 6, step: 0.5, default: 2,
    help: 'Spatial frequency of the waves',
    group: 'Geometry',
  },
  spiralArms: {
    name: 'Spiral Arms',
    type: 'number', min: 1, max: 8, step: 1, default: 2,
    help: 'Twist multiplier per spiral source (spiral / mixed mode)',
    group: 'Geometry',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.1, max: 3, step: 0.1, default: 1,
    help: 'Wave propagation speed',
    group: 'Flow/Motion',
  },
  sourceMotion: {
    name: 'Source Drift',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Sources orbit their seeded positions — 0 = fully static',
    group: 'Flow/Motion',
  },
  damping: {
    name: 'Damping',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Amplitude decay with distance from source',
    group: 'Texture',
  },
  contrast: {
    name: 'Contrast',
    type: 'number', min: 0.3, max: 3, step: 0.1, default: 1.2,
    help: 'Fringe sharpness — higher pushes toward hard-edged bands',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'bichrome', 'phase'],
    default: 'palette',
    help: 'palette: smooth gradient · bichrome: two-tone fringes · phase: wavefront edges highlighted',
    group: 'Color',
  },
};

// ─── Generator ────────────────────────────────────────────────────────────────

type WaveKind = 'circular' | 'spiral' | 'plane';

interface Source {
  cx: number; cy: number;
  orbitR: number; orbitSpeed: number; orbitPhase: number;
  phase: number;
  planeAngle: number;
  kind: WaveKind;
}

export const waveInterference: Generator = {
  id: 'wave-interference',
  family: 'animation',
  styleName: 'Wave Interference',
  definition: 'Animated wave interference from multiple sources — circular, spiral, and planar waves with moving sources',
  algorithmNotes:
    'Each source emits one of three wave types: circular (radial sinusoid), spiral (radial + angular twist ' +
    'proportional to atan2), or planar (directional beam). Amplitude decays exponentially with distance. ' +
    'Sources optionally orbit their seeded positions for time-varying interference geometry. ' +
    'Phase mode renders gradient magnitude |∇V| to highlight wavefronts; bichrome snaps fringes to two colours. ' +
    'A sigmoid-style sharpness curve controls fringe width.',
  parameterSchema,
  defaultParams: {
    waveCount: 4, waveType: 'circular', frequency: 2, spiralArms: 2,
    speed: 1, sourceMotion: 0.3, damping: 0.3, contrast: 1.2, colorMode: 'palette',
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const waveCount   = Math.max(2, Math.round(params.waveCount   ?? 4));
    const waveType    = (params.waveType    ?? 'circular') as string;
    const freq        = (params.frequency   ?? 2) * 0.05;   // pixel-space frequency
    const arms        = Math.max(1, Math.round(params.spiralArms  ?? 2));
    const speed       = params.speed        ?? 1;
    const srcMotion   = params.sourceMotion ?? 0.3;
    const damping     = params.damping      ?? 0.3;
    const contrast    = params.contrast     ?? 1.2;
    const colorMode   = (params.colorMode   ?? 'palette') as string;

    const t       = time * speed;
    const minDim  = Math.min(w, h);

    // ── Build sources (deterministic from seed) ────────────────────────────
    const rng = new SeededRNG(seed);
    const kindCycle: WaveKind[] = ['circular', 'spiral', 'plane'];

    const sources: Source[] = [];
    for (let i = 0; i < waveCount; i++) {
      const kind: WaveKind = waveType === 'mixed'
        ? kindCycle[i % kindCycle.length]
        : (waveType as WaveKind);
      sources.push({
        cx:         rng.range(w * 0.15, w * 0.85),
        cy:         rng.range(h * 0.15, h * 0.85),
        orbitR:     minDim * srcMotion * rng.range(0.04, 0.12),
        orbitSpeed: rng.range(0.3, 1.0) * (rng.random() > 0.5 ? 1 : -1),
        orbitPhase: rng.range(0, Math.PI * 2),
        phase:      (i / waveCount) * Math.PI * 2,
        planeAngle: rng.range(0, Math.PI * 2),
        kind,
      });
    }

    // ── Animated source positions ──────────────────────────────────────────
    const sx = new Float32Array(waveCount);
    const sy = new Float32Array(waveCount);
    for (let i = 0; i < waveCount; i++) {
      const s = sources[i];
      sx[i] = s.cx + Math.cos(t * s.orbitSpeed * 0.12 + s.orbitPhase) * s.orbitR;
      sy[i] = s.cy + Math.sin(t * s.orbitSpeed * 0.12 + s.orbitPhase) * s.orbitR;
    }

    // ── Pre-parse palette ──────────────────────────────────────────────────
    const palRGB: [number, number, number][] = palette.colors.map(hex => {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });
    const nC = palRGB.length;

    const paletteAt = (v: number): [number, number, number] => {
      v = Math.max(0, Math.min(1, v));
      const ci = v * (nC - 1);
      const c0 = Math.floor(ci);
      const c1 = Math.min(c0 + 1, nC - 1);
      const f  = ci - c0;
      const [r0, g0, b0] = palRGB[c0];
      const [r1, g1, b1] = palRGB[c1];
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    };

    // Sharpness curve — identical to kaleidoscope implementation
    const sharpen = (v: number): number => {
      if (Math.abs(contrast - 1) < 0.05) return v;
      return v < 0.5
        ? 0.5 * Math.pow(2 * v, contrast)
        : 1 - 0.5 * Math.pow(2 * (1 - v), contrast);
    };

    // ── Per-pixel interference sum ─────────────────────────────────────────
    const computeVal = (px: number, py: number): number => {
      let sum = 0;
      for (let i = 0; i < waveCount; i++) {
        const dx   = px - sx[i];
        const dy   = py - sy[i];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const A    = Math.exp(-dist * damping * 0.008);
        const phi  = sources[i].phase;
        let wave: number;

        if (sources[i].kind === 'spiral') {
          wave = Math.sin(dist * freq - t + phi + Math.atan2(dy, dx) * arms);
        } else if (sources[i].kind === 'plane') {
          // Plane angle drifts slowly, independent of source-motion orbit
          const pa = sources[i].planeAngle + t * 0.04;
          wave = Math.sin((dx * Math.cos(pa) + dy * Math.sin(pa)) * freq - t + phi);
        } else {
          wave = Math.sin(dist * freq - t + phi);
        }
        sum += wave * A;
      }
      return (sum / waveCount) * 0.5 + 0.5; // → [0, 1]
    };

    const imageData = ctx.createImageData(w, h);
    const d = imageData.data;

    if (colorMode === 'phase') {
      // ── Phase mode: precompute value buffer, derive gradient magnitude ───
      const buf = new Float32Array(w * h);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          buf[py * w + px] = computeVal(px, py);
        }
      }
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const x0 = Math.max(0, px - 1), x1 = Math.min(w - 1, px + 1);
          const y0 = Math.max(0, py - 1), y1 = Math.min(h - 1, py + 1);
          const gx = buf[py * w + x1] - buf[py * w + x0];
          const gy = buf[y1 * w + px] - buf[y0 * w + px];
          const gMag = Math.sqrt(gx * gx + gy * gy) * 3.5;
          const v = sharpen(Math.max(0, Math.min(1, gMag)));
          const [r, g, b] = paletteAt(v);
          const idx = (py * w + px) * 4;
          d[idx]     = r | 0;
          d[idx + 1] = g | 0;
          d[idx + 2] = b | 0;
          d[idx + 3] = 255;
        }
      }
    } else {
      // ── Direct value → color pass ──────────────────────────────────────
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const v = sharpen(Math.max(0, Math.min(1, computeVal(px, py))));
          let r: number, g: number, b: number;
          if (colorMode === 'bichrome') {
            // Snap to first or last palette colour — contrast controls fringe width
            [r, g, b] = paletteAt(v < 0.5 ? 0 : 1);
          } else {
            [r, g, b] = paletteAt(v);
          }
          const idx = (py * w + px) * 4;
          d[idx]     = r | 0;
          d[idx + 1] = g | 0;
          d[idx + 2] = b | 0;
          d[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  estimateCost(params) {
    return Math.round(params.waveCount * 1000);
  },
};
