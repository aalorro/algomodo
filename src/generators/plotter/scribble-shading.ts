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
  strokeStyle: {
    name: 'Stroke Style',
    type: 'select',
    options: ['straight', 'wavy', 'zigzag', 'loop'],
    default: 'straight',
    help: 'straight: wobble only | wavy: sinusoidal | zigzag: sharp angles | loop: curly scribble',
    group: 'Texture',
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
  densityStyle: {
    name: 'Density Style',
    type: 'select',
    options: ['fbm', 'ridged', 'radial', 'turbulent'],
    default: 'fbm',
    help: 'fbm: smooth | ridged: sharp creases | radial: center-focused | turbulent: chaotic',
    group: 'Texture',
  },
  densityThreshold: {
    name: 'Density Threshold',
    type: 'number', min: 0.0, max: 0.8, step: 0.05, default: 0.3,
    help: 'Minimum density to draw a stroke at a point',
    group: 'Texture',
  },
  strokeOpacity: {
    name: 'Opacity',
    type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 0.65,
    group: 'Color',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.3, max: 3, step: 0.1, default: 0.7,
    group: 'Texture',
  },
  variableWidth: {
    name: 'Variable Width',
    type: 'boolean',
    default: false,
    help: 'Line width varies with density — thicker in dense areas',
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
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0,
    help: 'Flowing density field animation — 0 = static',
    group: 'Flow/Motion',
  },
};

export const scribbleShading: Generator = {
  id: 'plotter-scribble-shading',
  family: 'plotter',
  styleName: 'Scribble Shading',
  definition: 'Multi-pass directional hatching with FBM noise wobble — emulates organic scribble-fill pen-plotter sketch art',
  algorithmNotes:
    'Each of N passes sweeps parallel lines at a distinct angle. Stroke styles (straight, wavy, zigzag, loop) add character beyond simple wobble. Density styles (fbm, ridged, radial, turbulent) shape where strokes appear. Variable width makes strokes thicken in dense regions.',
  parameterSchema,
  defaultParams: {
    passCount: 3, lineSpacing: 8, strokeStyle: 'straight',
    wobble: 6, densityScale: 2.5, densityStyle: 'fbm',
    densityThreshold: 0.3, strokeOpacity: 0.65,
    lineWidth: 0.7, variableWidth: false,
    colorMode: 'palette-pass', background: 'cream', animSpeed: 0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const noise = new SimplexNoise(seed);
    const isDark = params.background === 'dark';
    const colors = palette.colors.map(hexToRgb);

    const passCount = Math.max(1, (params.passCount ?? 3) | 0);
    const spacing = Math.max(2, params.lineSpacing ?? 8);
    const wobbleAmt = params.wobble ?? 6;
    const dScale = params.densityScale ?? 2.5;
    const densityStyle = params.densityStyle || 'fbm';
    const threshold = params.densityThreshold ?? 0.3;
    const opacity = params.strokeOpacity ?? 0.65;
    const colorMode = params.colorMode || 'palette-pass';
    const strokeStyle = params.strokeStyle || 'straight';
    const variableWidth = params.variableWidth ?? false;
    const baseLineWidth = params.lineWidth ?? 0.7;
    const animSpeed = params.animSpeed ?? 0;
    const timeOff = time * animSpeed * 0.3;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const diagonal = Math.sqrt(w * w + h * h);
    const ccx = w / 2, ccy = h / 2;
    const sweepSteps = Math.ceil(diagonal / 4) + 1;

    // Density function with style options
    function densityFn(bx: number, by: number, pass: number): number {
      const nx = (bx / w - 0.5) * dScale + 7 + pass * 3.7 + timeOff;
      const ny = (by / h - 0.5) * dScale + 7 + pass * 2.3 + timeOff * 0.7;
      let n: number;
      if (densityStyle === 'ridged') {
        const raw = noise.fbm(nx, ny, 4, 2, 0.5);
        const ridge = 1 - Math.abs(raw);
        n = ridge * ridge;
      } else if (densityStyle === 'turbulent') {
        n = Math.abs(noise.fbm(nx, ny, 4, 2, 0.5));
      } else if (densityStyle === 'radial') {
        const dx = bx / w - 0.5, dy = by / h - 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy) * 2;
        const nv = noise.fbm(nx, ny, 3, 2, 0.5) * 0.3;
        n = Math.max(0, 1 - dist + nv);
      } else {
        n = noise.fbm(nx, ny, 4, 2, 0.5) * 0.5 + 0.5;
      }
      return Math.max(0, n);
    }

    for (let pass = 0; pass < passCount; pass++) {
      const angle = (pass / passCount) * Math.PI;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const cosPx = -sinA, sinPx = cosA;

      let pr: number, pg: number, pb: number;
      if (colorMode === 'palette-pass') {
        [pr, pg, pb] = colors[pass % colors.length];
      } else if (isDark) {
        [pr, pg, pb] = [220, 220, 220];
      } else {
        [pr, pg, pb] = [30, 30, 30];
      }

      for (let d = -diagonal / 2; d <= diagonal / 2; d += spacing) {
        const lx0 = ccx + cosPx * d - cosA * diagonal / 2;
        const ly0 = ccy + sinPx * d - sinA * diagonal / 2;

        const segments: [number, number][][] = [];
        let currentSeg: [number, number][] = [];

        for (let s = 0; s <= sweepSteps; s++) {
          const t = s / sweepSteps;
          const bx = lx0 + cosA * diagonal * t;
          const by = ly0 + sinA * diagonal * t;

          if (bx < -wobbleAmt - 5 || bx > w + wobbleAmt + 5 ||
              by < -wobbleAmt - 5 || by > h + wobbleAmt + 5) {
            if (currentSeg.length > 1) segments.push(currentSeg);
            currentSeg = [];
            continue;
          }

          const density = densityFn(bx, by, pass);
          if (density > threshold) {
            // Base wobble
            const wn = noise.noise2D(
              (bx / w) * dScale * 2.5 + pass * 13.1,
              (by / h) * dScale * 2.5 + pass * 9.7,
            );
            let offX = cosPx * wn * wobbleAmt;
            let offY = sinPx * wn * wobbleAmt;

            // Stroke style modifications
            if (strokeStyle === 'wavy') {
              const wave = Math.sin(t * diagonal * 0.08 + pass * 2) * spacing * 0.4;
              offX += cosPx * wave;
              offY += sinPx * wave;
            } else if (strokeStyle === 'zigzag') {
              const zig = ((s % 6) < 3 ? 1 : -1) * spacing * 0.35;
              offX += cosPx * zig;
              offY += sinPx * zig;
            } else if (strokeStyle === 'loop') {
              const loopT = t * diagonal * 0.05 + pass * 1.7;
              const loopR = spacing * 0.5 * (0.3 + density * 0.7);
              offX += Math.cos(loopT * 6) * loopR;
              offY += Math.sin(loopT * 6) * loopR;
            }

            currentSeg.push([bx + offX, by + offY]);
          } else {
            if (currentSeg.length > 1) segments.push(currentSeg);
            currentSeg = [];
          }
        }
        if (currentSeg.length > 1) segments.push(currentSeg);

        for (const seg of segments) {
          let cr = pr, cg = pg, cb = pb;

          if (colorMode === 'palette-density' || colorMode === 'palette-noise') {
            const mid = seg[(seg.length / 2) | 0];
            let tc: number;
            if (colorMode === 'palette-density') {
              tc = densityFn(mid[0], mid[1], pass);
            } else {
              const nv = noise.noise2D(mid[0] / w * 4 + 20, mid[1] / h * 4 + 20);
              tc = Math.max(0, nv * 0.5 + 0.5);
            }
            const ci = Math.min(1, tc) * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
            cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
            cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
          }

          // Variable width: thicker in denser areas
          if (variableWidth) {
            const mid = seg[(seg.length / 2) | 0];
            const den = densityFn(mid[0], mid[1], pass);
            ctx.lineWidth = baseLineWidth * (0.5 + den * 2);
          } else {
            ctx.lineWidth = baseLineWidth;
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
    return (Math.ceil(1530 / spacing) * passes * 2) | 0;
  },
};
