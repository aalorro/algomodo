import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  style: {
    name: 'Style',
    type: 'select',
    options: ['parallel', 'contour', 'scribble'],
    default: 'parallel',
    help: 'parallel: density-driven broken lines | contour: follows noise topography | scribble: curved short strokes',
    group: 'Composition',
  },
  layers: {
    name: 'Layers',
    type: 'number', min: 1, max: 4, step: 1, default: 2,
    help: 'Number of angle passes; each uses the next palette color',
    group: 'Composition',
  },
  baseSpacing: {
    name: 'Line Spacing',
    type: 'number', min: 3, max: 28, step: 1, default: 7,
    group: 'Geometry',
  },
  angle: {
    name: 'Base Angle',
    type: 'number', min: 0, max: 175, step: 5, default: 45,
    group: 'Geometry',
  },
  angleStep: {
    name: 'Angle Step',
    type: 'number', min: 10, max: 90, step: 5, default: 45,
    help: 'Degrees between each layer',
    group: 'Geometry',
  },
  densityScale: {
    name: 'Density Scale',
    type: 'number', min: 0.3, max: 6, step: 0.1, default: 2.2,
    help: 'Spatial scale of the noise density field',
    group: 'Composition',
  },
  densityContrast: {
    name: 'Density Contrast',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 1.8,
    help: 'Exponent sharpening light/dark areas',
    group: 'Texture',
  },
  wobble: {
    name: 'Wobble',
    type: 'number', min: 0, max: 6, step: 0.25, default: 1.5,
    help: 'Per-segment hand-drawn jitter',
    group: 'Texture',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.25, max: 3, step: 0.25, default: 0.75,
    group: 'Texture',
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
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.12,
    help: 'Speed at which the density field drifts over time (0 = static)',
    group: 'Flow/Motion',
  },
};

export const hatching: Generator = {
  id: 'hatching',
  family: 'plotter',
  styleName: 'Hatching',
  definition: 'Noise-driven engraving with parallel, contour-following or scribble line modes and per-segment hand-drawn wobble',
  algorithmNotes: 'A SimplexNoise density field controls where lines appear. In parallel mode lines break up in low-density areas. In contour mode short strokes follow noise iso-contours. In scribble mode short Bezier arcs are placed by rejection sampling.',
  parameterSchema,
  defaultParams: { style: 'parallel', layers: 2, baseSpacing: 7, angle: 45, angleStep: 45, densityScale: 2.2, densityContrast: 1.8, wobble: 1.5, lineWidth: 0.75, background: 'cream', animSpeed: 0.12 },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { style, layers, baseSpacing, angle, angleStep, densityScale, densityContrast, wobble, lineWidth, background } = params;

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    ctx.fillStyle = BG[background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const isDark = background === 'dark';
    const diagonal = Math.sqrt(w * w + h * h);
    const animSpeed = params.animSpeed ?? 0.12;
    const tOff = time * animSpeed * 0.3;

    const sampleDensity = (px: number, py: number): number => {
      // +5 offset keeps canvas center away from FBM origin (which is always 0)
      const n = noise.fbm((px / w - 0.5) * densityScale + 5 + tOff, (py / h - 0.5) * densityScale + 5 + tOff * 0.7, 4, 2.0, 0.5);
      const v = Math.max(0, n * 0.5 + 0.5); // 0-1
      return Math.pow(v, densityContrast);
    };

    const drawWobblySegment = (
      ctx: CanvasRenderingContext2D,
      x0: number, y0: number, x1: number, y1: number
    ) => {
      if (wobble < 0.1) {
        ctx.lineTo(x1, y1);
        return;
      }
      const mx = (x0 + x1) / 2 + (rng.random() - 0.5) * wobble;
      const my = (y0 + y1) / 2 + (rng.random() - 0.5) * wobble;
      ctx.quadraticCurveTo(mx, my, x1 + (rng.random() - 0.5) * wobble * 0.5, y1 + (rng.random() - 0.5) * wobble * 0.5);
    };

    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    // ── Parallel mode ────────────────────────────────────────────────────────────
    if (style === 'parallel') {
      for (let layer = 0; layer < layers; layer++) {
        const layerAngle = ((angle + layer * angleStep) * Math.PI) / 180;
        const cosA = Math.cos(layerAngle);
        const sinA = Math.sin(layerAngle);
        const cosP = Math.cos(layerAngle + Math.PI / 2);
        const sinP = Math.sin(layerAngle + Math.PI / 2);

        const col = palette.colors[layer % palette.colors.length];
        const [r, g, b] = hexToRgb(col);
        const alpha = isDark ? 0.85 : 0.75;
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;

        const numLines = Math.ceil(diagonal / baseSpacing) + 2;
        const segStep = 4; // px per segment check

        for (let li = -numLines / 2; li <= numLines / 2; li++) {
          const ox = w / 2 + cosP * li * baseSpacing;
          const oy = h / 2 + sinP * li * baseSpacing;

          const numSegs = Math.ceil(diagonal / segStep) + 2;
          let drawing = false;

          ctx.beginPath();
          for (let si = 0; si <= numSegs; si++) {
            const px = ox + cosA * (si * segStep - diagonal / 2);
            const py = oy + sinA * (si * segStep - diagonal / 2);

            if (px < -wobble - 5 || px > w + wobble + 5 || py < -wobble - 5 || py > h + wobble + 5) {
              if (drawing) { ctx.stroke(); ctx.beginPath(); drawing = false; }
              continue;
            }

            const density = sampleDensity(px, py);
            // Layer threshold: later layers need higher density
            const threshold = layer * (0.25 / Math.max(layers - 1, 1));
            const shouldDraw = density > threshold;

            if (shouldDraw) {
              if (!drawing) {
                ctx.moveTo(px + (rng.random() - 0.5) * wobble, py + (rng.random() - 0.5) * wobble);
                drawing = true;
              } else {
                drawWobblySegment(ctx, px - cosA * segStep, py - sinA * segStep, px, py);
              }
            } else {
              if (drawing) { ctx.stroke(); ctx.beginPath(); drawing = false; }
            }
          }
          if (drawing) ctx.stroke();
        }
      }

    // ── Contour mode ─────────────────────────────────────────────────────────────
    } else if (style === 'contour') {
      const strokeLen = baseSpacing * 2.5;
      const gridStep = baseSpacing * 0.85;
      const eps = w * 0.003;

      for (let layer = 0; layer < layers; layer++) {
        const col = palette.colors[layer % palette.colors.length];
        const [r, g, b] = hexToRgb(col);
        ctx.strokeStyle = `rgba(${r},${g},${b},${isDark ? 0.8 : 0.7})`;

        // Offset grid per layer to fill gaps
        const ox = (layer * gridStep * 0.5) % gridStep;
        const oy = (layer * gridStep * 0.7) % gridStep;

        for (let py = oy; py < h; py += gridStep) {
          for (let px = ox; px < w; px += gridStep) {
            const density = sampleDensity(px, py);
            const threshold = layer * (0.22 / Math.max(layers - 1, 1));
            if (density < threshold + 0.05) continue;

            // Gradient of noise field (consistent centered formula)
            const gx = noise.fbm(((px + eps) / w - 0.5) * densityScale + 5 + tOff, (py / h - 0.5) * densityScale + 5 + tOff * 0.7, 3, 2, 0.5)
                      - noise.fbm(((px - eps) / w - 0.5) * densityScale + 5 + tOff, (py / h - 0.5) * densityScale + 5 + tOff * 0.7, 3, 2, 0.5);
            const gy = noise.fbm((px / w - 0.5) * densityScale + 5 + tOff, ((py + eps) / h - 0.5) * densityScale + 5 + tOff * 0.7, 3, 2, 0.5)
                      - noise.fbm((px / w - 0.5) * densityScale + 5 + tOff, ((py - eps) / h - 0.5) * densityScale + 5 + tOff * 0.7, 3, 2, 0.5);

            const len = Math.sqrt(gx * gx + gy * gy) + 0.0001;
            // Perpendicular to gradient = contour direction
            const tx = -gy / len;
            const ty = gx / len;

            const half = strokeLen / 2 * density;
            const x0 = px - tx * half + (rng.random() - 0.5) * wobble;
            const y0 = py - ty * half + (rng.random() - 0.5) * wobble;
            const x1 = px + tx * half + (rng.random() - 0.5) * wobble;
            const y1 = py + ty * half + (rng.random() - 0.5) * wobble;

            ctx.beginPath();
            ctx.moveTo(x0, y0);
            const mx = (x0 + x1) / 2 + (rng.random() - 0.5) * wobble * 2;
            const my = (y0 + y1) / 2 + (rng.random() - 0.5) * wobble * 2;
            ctx.quadraticCurveTo(mx, my, x1, y1);
            ctx.stroke();
          }
        }
      }

    // ── Scribble mode ────────────────────────────────────────────────────────────
    } else {
      const totalStrokes = Math.round((w * h) / (baseSpacing * baseSpacing * 4));

      for (let layer = 0; layer < layers; layer++) {
        const col = palette.colors[layer % palette.colors.length];
        const [r, g, b] = hexToRgb(col);
        ctx.strokeStyle = `rgba(${r},${g},${b},${isDark ? 0.75 : 0.65})`;

        const layerStrokes = Math.round(totalStrokes / layers);
        const threshold = layer * (0.2 / Math.max(layers - 1, 1));

        let attempts = 0;
        let drawn = 0;
        while (drawn < layerStrokes && attempts < layerStrokes * 10) {
          attempts++;
          const px = rng.random() * w;
          const py = rng.random() * h;
          const density = sampleDensity(px, py);

          if (rng.random() > Math.max(0.25, density - threshold)) continue;

          const strokeLength = baseSpacing * (0.8 + density * 2.5);
          const strokeAngle = ((angle + layer * angleStep) * Math.PI / 180)
                            + (rng.random() - 0.5) * 0.6;

          const dx = Math.cos(strokeAngle) * strokeLength;
          const dy = Math.sin(strokeAngle) * strokeLength;
          const cx = px + (rng.random() - 0.5) * wobble * 3;
          const cy = py + (rng.random() - 0.5) * wobble * 3;

          ctx.beginPath();
          ctx.moveTo(px - dx / 2, py - dy / 2);
          ctx.quadraticCurveTo(cx, cy, px + dx / 2, py + dy / 2);
          ctx.stroke();
          drawn++;
        }
      }
    }
  },

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const c = gl.canvas as HTMLCanvasElement;
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    this.renderCanvas2D!(tmp.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost(params) {
    return Math.round(10000 / (params.baseSpacing * params.baseSpacing) * params.layers * 120);
  },
};
