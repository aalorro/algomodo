import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Gielis superformula: r = (|cos(m·θ/4)/a|^n2 + |sin(m·θ/4)/b|^n3)^(-1/n1) */
function superformula(theta: number, m: number, n1: number, n2: number, n3: number, a: number, b: number): number {
  const t1 = Math.pow(Math.abs(Math.cos(m * theta / 4) / a), n2);
  const t2 = Math.pow(Math.abs(Math.sin(m * theta / 4) / b), n3);
  const base = t1 + t2;
  if (base === 0) return 0;
  return Math.pow(base, -1 / n1);
}

const parameterSchema: ParameterSchema = {
  m: {
    name: 'Symmetry (m)', type: 'number', min: 1, max: 20, step: 1, default: 6,
    help: 'm controls rotational symmetry — m=3 → triangle, m=4 → square, m=5 → pentagon, m=6 → hexagon, etc.',
    group: 'Geometry',
  },
  n1: {
    name: 'n1', type: 'number', min: 0.1, max: 20, step: 0.1, default: 1.0,
    help: 'Primary exponent — large n1 → rectangle-like; n1=1 → smooth; small n1 → star-like',
    group: 'Geometry',
  },
  n2: {
    name: 'n2', type: 'number', min: 0.1, max: 20, step: 0.1, default: 1.0,
    help: 'Cosine exponent — asymmetric n2≠n3 breaks fore/aft symmetry',
    group: 'Geometry',
  },
  n3: {
    name: 'n3', type: 'number', min: 0.1, max: 20, step: 0.1, default: 1.0,
    help: 'Sine exponent',
    group: 'Geometry',
  },
  a: {
    name: 'a', type: 'number', min: 0.1, max: 4, step: 0.1, default: 1.0,
    group: 'Geometry',
  },
  b: {
    name: 'b', type: 'number', min: 0.1, max: 4, step: 0.1, default: 1.0,
    group: 'Geometry',
  },
  layers: {
    name: 'Layers', type: 'number', min: 1, max: 6, step: 1, default: 2,
    help: 'Concentric superformula shapes with scaled radius',
    group: 'Composition',
  },
  strokeWidth: {
    name: 'Stroke Width', type: 'number', min: 0.5, max: 8, step: 0.5, default: 2,
    group: 'Texture',
  },
  fill: {
    name: 'Fill', type: 'boolean', default: false,
    help: 'Fill shape interiors with semi-transparent color',
    group: 'Color',
  },
  resolution: {
    name: 'Resolution', type: 'number', min: 200, max: 4000, step: 200, default: 1000,
    help: 'Number of θ samples per shape',
    group: 'Composition',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['spin', 'morph', 'breathe'], default: 'morph',
    help: 'spin: rotate | morph: n1 drifts continuously cycling topologies | breathe: radius pulses',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.25,
    group: 'Flow/Motion',
  },
};

export const geoSuperformula: Generator = {
  id: 'geo-superformula',
  family: 'geometry',
  styleName: 'Superformula',
  definition: "Johan Gielis' superformula — a single polar equation that continuously deforms through every polygon, star, flower, and fractal boundary by varying six parameters",
  algorithmNotes:
    'r(θ) = (|cos(m·θ/4)/a|^n2 + |sin(m·θ/4)/b|^n3)^(-1/n1). At n1=n2=n3=1, a=b=1 the shape is a circle; integers m give m-fold rotational symmetry. Large n1 flattens edges (rectangle); small n1 sharpens corners (star). Setting n2≠n3 with a≠b breaks the m-fold symmetry into asymmetric blobs. The parameter space smoothly interpolates between every regular polygon and star polygon, making morph animations naturally continuous.',
  parameterSchema,
  defaultParams: {
    m: 6, n1: 1.0, n2: 1.0, n3: 1.0, a: 1.0, b: 1.0,
    layers: 2, strokeWidth: 2, fill: false, resolution: 1000,
    animMode: 'morph', speed: 0.25,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) * 0.42;

    const m        = Math.max(1, (params.m ?? 6) | 0);
    const n2       = Math.max(0.01, params.n2 ?? 1.0);
    const n3       = Math.max(0.01, params.n3 ?? 1.0);
    const a        = Math.max(0.01, params.a  ?? 1.0);
    const b        = Math.max(0.01, params.b  ?? 1.0);
    const layers   = Math.max(1, Math.min(6, (params.layers ?? 2) | 0));
    const sw       = params.strokeWidth ?? 2;
    const doFill   = params.fill ?? false;
    const animMode = params.animMode ?? 'morph';
    const t        = time * (params.speed ?? 0.25);
    const steps    = quality === 'draft' || time > 0
      ? Math.min(params.resolution ?? 1000, 800)
      : (params.resolution ?? 1000);

    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    for (let L = 0; L < layers; L++) {
      const color = palette.colors[L % palette.colors.length];
      const [cr, cg, cb] = hexToRgb(color);
      const layerScale = 1 - L * 0.22;

      // Animated n1
      let n1 = Math.max(0.01, params.n1 ?? 1.0);
      let rotAngle = 0;
      let radiusMul = 1;

      if (animMode === 'morph') {
        // n1 cycles: 0.2 … 20 in a smooth sinusoidal orbit
        n1 = Math.max(0.01, 1.0 + 9.0 * Math.sin(t * 0.4 + L * 0.8));
      } else if (animMode === 'spin') {
        rotAngle = t * (1 + L * 0.25);
      } else if (animMode === 'breathe') {
        radiusMul = 1 + 0.15 * Math.sin(t * 1.2 + L * Math.PI / layers);
      }

      // Sample the curve
      const points: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * 2 * Math.PI;
        const r = superformula(theta + rotAngle, m, n1, n2, n3, a, b);
        // Normalize r — the raw value can vary wildly; find max first via fast pass
        // We defer normalization to after full sampling
        points.push([r, theta]);
      }

      // Find max r for normalization
      let maxVal = 0;
      for (const [r] of points) if (r > maxVal) maxVal = r;
      if (maxVal === 0) continue;

      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.9)`;
      ctx.lineWidth = sw;
      if (doFill) ctx.fillStyle = `rgba(${cr},${cg},${cb},0.12)`;

      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const [r, theta] = points[i];
        const rn = (r / maxVal) * maxR * layerScale * radiusMul;
        const x = cx + rn * Math.cos(theta);
        const y = cy + rn * Math.sin(theta);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (doFill) ctx.fill();
      ctx.stroke();
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    return ((params.layers ?? 2) * (params.resolution ?? 1000) / 20) | 0;
  },
};
