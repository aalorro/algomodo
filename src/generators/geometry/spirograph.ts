import type { Generator, ParameterSchema } from '../../types';
import { SVGPathBuilder } from '../../renderers/svg/builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(
  colors: [number, number, number][],
  t: number,
  alpha = 1,
): string {
  const ci = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
  const f  = ci - i0;
  const r  = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
  const g  = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
  const b  = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(2)})` : `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Curve point — hypotrochoid or epitrochoid
//   Hypo: rolling circle INSIDE the fixed ring  (classic Spirograph toy)
//   Epi:  rolling circle OUTSIDE the fixed ring (rose / petal curves)
// ---------------------------------------------------------------------------
function spiroPoint(
  R: number, sm: number, d: number, t: number, epi: boolean,
): [number, number] {
  if (epi) {
    return [
      (R + sm) * Math.cos(t) - d * Math.cos(((R + sm) / sm) * t),
      (R + sm) * Math.sin(t) - d * Math.sin(((R + sm) / sm) * t),
    ];
  }
  return [
    (R - sm) * Math.cos(t) + d * Math.cos(((R - sm) / sm) * t),
    (R - sm) * Math.sin(t) - d * Math.sin(((R - sm) / sm) * t),
  ];
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  radius: {
    name: 'Radius (R)',
    type: 'number', min: 10, max: 500, step: 10, default: 200,
    help: 'Fixed outer circle radius',
    group: 'Geometry',
  },
  smallRadius: {
    name: 'Small Radius (r)',
    type: 'number', min: 5, max: 250, step: 5, default: 120,
    help: 'Rolling circle radius — the ratio R/r determines petal/lobe count',
    group: 'Geometry',
  },
  distance: {
    name: 'Pen Distance (d)',
    type: 'number', min: 0, max: 500, step: 10, default: 100,
    help: 'Distance of the pen from the centre of the rolling circle. d < r = inner loop; d = r = no loop (rhodonea); d > r = outer loop',
    group: 'Geometry',
  },
  mode: {
    name: 'Mode',
    type: 'select',
    options: ['hypotrochoid', 'epitrochoid'],
    default: 'hypotrochoid',
    help: 'hypotrochoid: rolling circle inside the fixed ring (classic Spirograph) | epitrochoid: rolling circle outside — produces rose petals, limaçons, and looped curves with very different proportions',
    group: 'Geometry',
  },
  turns: {
    name: 'Turns',
    type: 'number', min: 1, max: 50, step: 1, default: 10,
    help: 'Complete rotations — increase until the curve closes (governed by R/r ratio)',
    group: 'Composition',
  },
  layering: {
    name: 'Layers',
    type: 'number', min: 1, max: 8, step: 1, default: 1,
    help: 'Overlapping copies rotated evenly around the centre — creates radially symmetric mandala patterns',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['solid', 'gradient'],
    default: 'solid',
    help: 'solid: each layer takes one palette colour | gradient: colour sweeps through the full palette along the curve — reveals the rotational rhythm and self-intersection structure',
    group: 'Color',
  },
  strokeWidth: {
    name: 'Stroke Width',
    type: 'number', min: 0.5, max: 10, step: 0.5, default: 2,
    group: 'Texture',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.01, max: 2, step: 0.05, default: 0.3,
    help: 'Rotation speed in animation mode',
    group: 'Flow/Motion',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const spirograph: Generator = {
  id: 'spirograph',
  family: 'geometry',
  styleName: 'Spirograph',
  definition: 'Hypotrochoid and epitrochoid curves — a rolling circle inside or outside a fixed ring traces a pen point; layering fans symmetric copies around the centre to build mandalas',
  algorithmNotes:
    'Hypotrochoid: x=(R−r)cos(t)+d·cos((R−r)/r·t), y=(R−r)sin(t)−d·sin((R−r)/r·t). Epitrochoid: x=(R+r)cos(t)−d·cos((R+r)/r·t), y=(R+r)sin(t)−d·sin((R+r)/r·t). The curve closes after lcm(R,r)/r turns. Classic Spirograph toys use hypotrochoids; epitrochoids produce rose-like petals and Maclaurin spirals when d=r. Each layer is rotated by 2π/N, giving exact rotational symmetry. Gradient mode maps t-position to the full palette, exposing the repeating symmetry group of the curve as colour bands.',
  parameterSchema,
  defaultParams: {
    radius: 200, smallRadius: 120, distance: 100,
    mode: 'hypotrochoid', turns: 10, layering: 1,
    colorMode: 'solid', strokeWidth: 2, speed: 0.3,
  },
  supportsVector: true,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const cx = W / 2, cy = H / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const R    = params.radius      ?? 200;
    const sm   = Math.max(1, params.smallRadius ?? 120);
    const d    = params.distance    ?? 100;
    const epi  = (params.mode ?? 'hypotrochoid') === 'epitrochoid';
    const turns     = Math.max(1, (params.turns    ?? 10) | 0);
    const layers    = Math.max(1, (params.layering ?? 1)  | 0);
    const colorMode = params.colorMode  ?? 'solid';
    const sw        = params.strokeWidth ?? 2;
    const phase     = time * (params.speed ?? 0.3);

    // Scale so curve always fits the canvas
    const maxR = epi ? (R + sm + d) : (Math.abs(R - sm) + d);
    const normScale = maxR > 0 ? (Math.min(W, H) * 0.46) / maxR : 1;

    const steps = Math.max(600, 400 * turns);
    const rgbColors = palette.colors.map(hexToRgb);

    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let layer = 0; layer < layers; layer++) {
      // Distribute layers evenly around centre; animate by rotating
      const layerAngle = (layer / layers) * Math.PI * 2 + phase;

      const drawSegment = (iStart: number, iEnd: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (let i = iStart; i <= iEnd; i++) {
          const ang = (i / steps) * Math.PI * 2 * turns;
          const [px, py] = spiroPoint(R, sm, d, ang, epi);
          const rx = px * normScale, ry = py * normScale;
          // Rotate by layerAngle
          const sx = rx * Math.cos(layerAngle) - ry * Math.sin(layerAngle);
          const sy = rx * Math.sin(layerAngle) + ry * Math.cos(layerAngle);
          if (i === iStart) ctx.moveTo(cx + sx, cy + sy);
          else ctx.lineTo(cx + sx, cy + sy);
        }
        ctx.stroke();
      };

      if (colorMode === 'gradient') {
        const nSeg = 80;
        for (let seg = 0; seg < nSeg; seg++) {
          const t  = seg / nSeg;
          // Offset each layer slightly in the gradient so they look distinct
          const ct = (t + layer / Math.max(layers, 1) * 0.4) % 1;
          drawSegment(
            Math.floor(t * steps),
            Math.ceil((seg + 1) / nSeg * steps),
            lerpColor(rgbColors, ct),
          );
        }
      } else {
        // Solid: cycle through palette per layer
        ctx.strokeStyle = palette.colors[layer % palette.colors.length];
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const ang = (i / steps) * Math.PI * 2 * turns;
          const [px, py] = spiroPoint(R, sm, d, ang, epi);
          const rx = px * normScale, ry = py * normScale;
          const sx = rx * Math.cos(layerAngle) - ry * Math.sin(layerAngle);
          const sy = rx * Math.sin(layerAngle) + ry * Math.cos(layerAngle);
          if (i === 0) ctx.moveTo(cx + sx, cy + sy);
          else ctx.lineTo(cx + sx, cy + sy);
        }
        ctx.stroke();
      }
    }
  },

  renderVector(params, seed, palette) {
    const builder = new SVGPathBuilder();
    const cx = 540, cy = 540;

    const R    = params.radius      ?? 200;
    const sm   = Math.max(1, params.smallRadius ?? 120);
    const d    = params.distance    ?? 100;
    const epi  = (params.mode ?? 'hypotrochoid') === 'epitrochoid';
    const turns  = Math.max(1, (params.turns    ?? 10) | 0);
    const layers = Math.max(1, (params.layering ?? 1)  | 0);
    const steps  = Math.max(600, 400 * turns);
    const maxR   = epi ? (R + sm + d) : (Math.abs(R - sm) + d);
    const normScale = maxR > 0 ? 480 / maxR : 1;

    for (let layer = 0; layer < layers; layer++) {
      const layerAngle = (layer / layers) * Math.PI * 2;
      const color = palette.colors[layer % palette.colors.length];
      const pts: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const ang = (i / steps) * Math.PI * 2 * turns;
        const [px, py] = spiroPoint(R, sm, d, ang, epi);
        const rx = px * normScale, ry = py * normScale;
        const sx = rx * Math.cos(layerAngle) - ry * Math.sin(layerAngle);
        const sy = rx * Math.sin(layerAngle) + ry * Math.cos(layerAngle);
        pts.push([cx + sx, cy + sy]);
      }
      builder.addPolyline(pts, color, undefined, params.strokeWidth ?? 2);
    }
    return builder.getPaths();
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return (params.turns ?? 10) * (params.layering ?? 1) * 50; },
};
