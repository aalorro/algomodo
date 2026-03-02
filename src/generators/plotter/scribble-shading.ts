import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  passCount: {
    name: 'Passes',
    type: 'number', min: 1, max: 6, step: 1, default: 3,
    help: 'Number of overlapping angular stroke passes',
    group: 'Composition',
  },
  lineSpacing: {
    name: 'Line Spacing',
    type: 'number', min: 3, max: 24, step: 1, default: 8,
    help: 'Gap between parallel lines within each pass (px)',
    group: 'Geometry',
  },
  wobble: {
    name: 'Wobble',
    type: 'number', min: 0, max: 20, step: 1, default: 6,
    help: 'Noise-driven lateral deviation of each stroke (px)',
    group: 'Texture',
  },
  densityScale: {
    name: 'Density Scale',
    type: 'number', min: 0.5, max: 8, step: 0.25, default: 2.5,
    help: 'Spatial frequency of the FBM density field',
    group: 'Texture',
  },
  densityThreshold: {
    name: 'Density Threshold',
    type: 'number', min: 0.0, max: 0.8, step: 0.05, default: 0.3,
    help: 'Minimum density required to draw a stroke at a sample point',
    group: 'Texture',
  },
  strokeOpacity: {
    name: 'Opacity',
    type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 0.65,
    help: 'Stroke opacity per segment',
    group: 'Color',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.3, max: 3, step: 0.1, default: 0.7,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-pass', 'palette-density', 'palette-noise'],
    default: 'palette-pass',
    help: 'palette-pass: each angular pass uses a different palette colour',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
};

export const scribbleShading: Generator = {
  id: 'plotter-scribble-shading',
  family: 'plotter',
  styleName: 'Scribble Shading',
  definition:
    'Multi-pass directional hatching with FBM noise wobble — emulates organic scribble-fill pen-plotter sketch art',
  algorithmNotes:
    'Each of N passes sweeps parallel lines across the canvas at a distinct angle (evenly spaced between 0 and π). Along each sweep line, sample points where the FBM density field exceeds a threshold are grouped into stroke segments. Every sample point is perturbed laterally by a second noise layer for hand-drawn wobble. Overlapping passes at different angles produce the characteristic cross-hatch scribble texture.',
  parameterSchema,
  defaultParams: {
    passCount: 3,
    lineSpacing: 8,
    wobble: 6,
    densityScale: 2.5,
    densityThreshold: 0.3,
    strokeOpacity: 0.65,
    lineWidth: 0.7,
    colorMode: 'palette-pass',
    background: 'cream',
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderCanvas2D(ctx, params, seed, palette) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const noise = new SimplexNoise(seed);
    const isDark = params.background === 'dark';
    const colors = palette.colors.map(hexToRgb);

    const passCount = Math.max(1, (params.passCount ?? 3) | 0);
    const spacing = Math.max(2, params.lineSpacing ?? 8);
    const wobbleAmt = params.wobble ?? 6;
    const dScale = params.densityScale ?? 2.5;
    const threshold = params.densityThreshold ?? 0.3;
    const opacity = params.strokeOpacity ?? 0.65;
    const colorMode = params.colorMode || 'palette-pass';

    ctx.lineWidth = params.lineWidth ?? 0.7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const diagonal = Math.sqrt(w * w + h * h);
    const cx = w / 2;
    const cy = h / 2;
    // Steps along each sweep line: ~4 px resolution
    const sweepSteps = Math.ceil(diagonal / 4) + 1;

    for (let pass = 0; pass < passCount; pass++) {
      // Angle of strokes for this pass
      const angle = (pass / passCount) * Math.PI;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      // Perpendicular direction (for sweep offset and wobble)
      const cosPx = -sinA;
      const sinPx = cosA;

      // Base pass colour
      let pr: number, pg: number, pb: number;
      if (colorMode === 'palette-pass') {
        [pr, pg, pb] = colors[pass % colors.length];
      } else if (isDark) {
        [pr, pg, pb] = [220, 220, 220];
      } else {
        [pr, pg, pb] = [30, 30, 30];
      }

      // Sweep perpendicular offsets across the full diagonal
      for (let d = -diagonal / 2; d <= diagonal / 2; d += spacing) {
        // Origin of this sweep line
        const lx0 = cx + cosPx * d - cosA * diagonal / 2;
        const ly0 = cy + sinPx * d - sinA * diagonal / 2;

        // Collect stroke segments along this sweep line
        const segments: [number, number][][] = [];
        let currentSeg: [number, number][] = [];

        for (let s = 0; s <= sweepSteps; s++) {
          const t = s / sweepSteps;
          const bx = lx0 + cosA * diagonal * t;
          const by = ly0 + sinA * diagonal * t;

          // Skip points well outside canvas
          if (bx < -wobbleAmt - 5 || bx > w + wobbleAmt + 5 ||
              by < -wobbleAmt - 5 || by > h + wobbleAmt + 5) {
            if (currentSeg.length > 1) segments.push(currentSeg);
            currentSeg = [];
            continue;
          }

          // FBM density field (offset by pass index to de-correlate passes)
          const dn = noise.fbm(
            (bx / w - 0.5) * dScale + 7 + pass * 3.7,
            (by / h - 0.5) * dScale + 7 + pass * 2.3,
            4, 2, 0.5,
          );
          const density = Math.max(0, dn * 0.5 + 0.5);

          if (density > threshold) {
            // Lateral wobble via a second noise sample
            const wn = noise.noise2D(
              (bx / w) * dScale * 2.5 + pass * 13.1,
              (by / h) * dScale * 2.5 + pass * 9.7,
            );
            currentSeg.push([bx + cosPx * wn * wobbleAmt, by + sinPx * wn * wobbleAmt]);
          } else {
            if (currentSeg.length > 1) segments.push(currentSeg);
            currentSeg = [];
          }
        }
        if (currentSeg.length > 1) segments.push(currentSeg);

        // Draw collected segments
        for (const seg of segments) {
          let cr = pr, cg = pg, cb = pb;

          if (colorMode === 'palette-density' || colorMode === 'palette-noise') {
            const mid = seg[(seg.length / 2) | 0];
            let t: number;
            if (colorMode === 'palette-density') {
              const dn2 = noise.fbm(
                (mid[0] / w - 0.5) * dScale + 7 + pass * 3.7,
                (mid[1] / h - 0.5) * dScale + 7 + pass * 2.3,
                4, 2, 0.5,
              );
              t = Math.max(0, dn2 * 0.5 + 0.5);
            } else {
              const nv = noise.noise2D(mid[0] / w * 4 + 20, mid[1] / h * 4 + 20);
              t = Math.max(0, nv * 0.5 + 0.5);
            }
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci);
            const i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
            cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
            cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
          }

          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${opacity})`;
          ctx.beginPath();
          ctx.moveTo(seg[0][0], seg[0][1]);
          for (let p = 1; p < seg.length; p++) ctx.lineTo(seg[p][0], seg[p][1]);
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
    const passes = params.passCount ?? 3;
    const spacing = params.lineSpacing ?? 8;
    const linesPerPass = Math.ceil(1530 / spacing);
    return (linesPerPass * passes * 2) | 0;
  },
};
