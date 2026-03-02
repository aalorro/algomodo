import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  ringCount: {
    name: 'Ring Count',
    type: 'number', min: 1, max: 12, step: 1, default: 5,
    help: 'Number of concentric guilloché rings',
    group: 'Composition',
  },
  petals: {
    name: 'Petals',
    type: 'number', min: 3, max: 20, step: 1, default: 7,
    help: 'Number of lobes per hypotrochoid ring',
    group: 'Composition',
  },
  eccentricity: {
    name: 'Eccentricity',
    type: 'number', min: 0.1, max: 0.98, step: 0.02, default: 0.65,
    help: 'Petal depth — 0 = circle, approaching 1 = sharp cusps',
    group: 'Geometry',
  },
  ringSpread: {
    name: 'Ring Spread',
    type: 'number', min: 0.03, max: 0.2, step: 0.01, default: 0.09,
    help: 'Radial gap between successive rings (fraction of canvas half-size)',
    group: 'Geometry',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.25, max: 3, step: 0.25, default: 0.75,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-rings', 'interference'],
    default: 'palette-rings',
    help: 'monochrome: single ink | palette-rings: one color per ring | interference: alternating first/last palette color',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
  spinSpeed: {
    name: 'Spin Speed',
    type: 'number', min: 0, max: 1.0, step: 0.05, default: 0.12,
    help: 'Rotation speed (rad/s). Even/odd rings spin in opposite directions.',
    group: 'Flow/Motion',
  },
};

export const guilloche: Generator = {
  id: 'plotter-guilloche',
  family: 'plotter',
  styleName: 'Guilloché',
  definition: 'Concentric hypotrochoid rings producing the interference moiré of banknote security print',
  algorithmNotes:
    'Each ring traces x(t)=k·cos(t)+d·cos(k·t), y(t)=k·sin(t)−d·sin(k·t) where k=petals and d=k·eccentricity, scaled to fill its radial band. Successive rings have slightly increasing eccentricity, creating the oscillating interference characteristic of guilloché engravings. Even/odd rings counter-rotate in animation.',
  parameterSchema,
  defaultParams: {
    ringCount: 5, petals: 7, eccentricity: 0.65, ringSpread: 0.09,
    lineWidth: 0.75, colorMode: 'palette-rings', background: 'cream', spinSpeed: 0.12,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const cx = w / 2, cy = h / 2;
    const halfSize = Math.min(w, h) * 0.48;
    const ringCount = Math.max(1, params.ringCount ?? 5) | 0;
    const k = Math.max(3, params.petals ?? 7) | 0;
    const eccBase = params.eccentricity ?? 0.65;
    const spread = params.ringSpread ?? 0.09;
    const spinSpeed = params.spinSpeed ?? 0.12;
    const colorMode = params.colorMode || 'palette-rings';
    const colors = palette.colors.map(hexToRgb);
    const isDark = params.background === 'dark';

    ctx.lineWidth = params.lineWidth ?? 0.75;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const STEPS = 1800;

    for (let ri = 0; ri < ringCount; ri++) {
      // Each ring has a slightly different eccentricity for interference
      const ecc = eccBase * (0.78 + ri * 0.06 + rng.random() * 0.08);
      const d = k * ecc;
      // Normalize so the outermost point of the hypotrochoid sits at ringRadius
      const maxRad = k + d;
      const ringRadius = halfSize * (0.3 + ri * spread);
      const scale = ringRadius / maxRad;

      // Alternating rotation direction per ring
      const direction = ri % 2 === 0 ? 1 : -1;
      const phase = time * spinSpeed * direction;

      let cr: number, cg: number, cb: number;
      if (colorMode === 'palette-rings') {
        [cr, cg, cb] = colors[ri % colors.length];
      } else if (colorMode === 'interference') {
        [cr, cg, cb] = ri % 2 === 0 ? colors[0] : colors[colors.length - 1];
      } else if (isDark) {
        [cr, cg, cb] = [220, 220, 220];
      } else {
        [cr, cg, cb] = [30, 30, 30];
      }
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.85 : 0.80})`;

      ctx.beginPath();
      for (let step = 0; step <= STEPS; step++) {
        const t = (step / STEPS) * Math.PI * 2 + phase;
        const x = cx + scale * (k * Math.cos(t) + d * Math.cos(k * t));
        const y = cy + scale * (k * Math.sin(t) - d * Math.sin(k * t));
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return ((params.ringCount ?? 5) * 9) | 0;
  },
};
