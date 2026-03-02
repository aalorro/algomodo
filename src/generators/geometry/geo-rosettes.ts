import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  numerator: {
    name: 'Numerator (n)', type: 'number', min: 1, max: 20, step: 1, default: 7,
    help: 'Rose curve numerator — r = cos(n/d · θ). Odd n with odd d → n petals; even n → 2n petals',
    group: 'Geometry',
  },
  denominator: {
    name: 'Denominator (d)', type: 'number', min: 1, max: 20, step: 1, default: 4,
    help: 'Rose curve denominator — controls petal density and winding number',
    group: 'Geometry',
  },
  layers: {
    name: 'Layers', type: 'number', min: 1, max: 8, step: 1, default: 3,
    help: 'Number of overlapping rose curves with staggered n/d ratios',
    group: 'Composition',
  },
  layerSpread: {
    name: 'Layer Spread', type: 'number', min: 0, max: 3, step: 0.1, default: 1.0,
    help: 'How much the n/d ratio shifts between layers',
    group: 'Composition',
  },
  radius: {
    name: 'Radius', type: 'number', min: 0.2, max: 0.95, step: 0.05, default: 0.45,
    help: 'Fraction of half-canvas used as the maximum petal radius',
    group: 'Geometry',
  },
  strokeWidth: {
    name: 'Stroke Width', type: 'number', min: 0.5, max: 6, step: 0.5, default: 1.5,
    group: 'Texture',
  },
  resolution: {
    name: 'Resolution', type: 'number', min: 500, max: 8000, step: 500, default: 3000,
    help: 'Steps per full curve traversal — higher = smoother petals',
    group: 'Composition',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['spin', 'bloom', 'morph'], default: 'spin',
    help: 'spin: rotate all curves | bloom: layers phase-shift at different rates | morph: n/d ratio drifts slowly',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.3,
    group: 'Flow/Motion',
  },
};

export const geoRosettes: Generator = {
  id: 'geo-rosettes',
  family: 'geometry',
  styleName: 'Rosettes',
  definition: 'Polar rose curves r = cos(n/d · θ) — the ratio n/d determines petal count and winding; multiple layers with shifted ratios produce complex mandala-like rosettes',
  algorithmNotes:
    'The polar curve r = cos(k·θ) traces a rose with k petals when k is an odd integer, 2k petals when k is even. Using rational k = n/d with gcd(n,d)=1 the curve closes after d full rotations (period = d·2π), producing max(n,d) or 2·max(n,d) petals depending on parity. Overlaying layers with slightly shifted ratios (n/d, (n+Δ)/d, …) creates interference rosettes reminiscent of celtic knotwork or mandala art. The "morph" animation slowly increments k, cycling through petal topologies.',
  parameterSchema,
  defaultParams: {
    numerator: 7, denominator: 4, layers: 3, layerSpread: 1.0,
    radius: 0.45, strokeWidth: 1.5, resolution: 3000,
    animMode: 'spin', speed: 0.3,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * (params.radius ?? 0.45);
    const n0 = Math.max(1, (params.numerator  ?? 7) | 0);
    const d0 = Math.max(1, (params.denominator ?? 4) | 0);
    const layers     = Math.max(1, Math.min(8, (params.layers ?? 3) | 0));
    const spread     = params.layerSpread ?? 1.0;
    const sw         = params.strokeWidth ?? 1.5;
    const animMode   = params.animMode ?? 'spin';
    const t          = time * (params.speed ?? 0.3);
    // Fewer steps in draft/animation for performance
    const res = quality === 'draft' || time > 0
      ? Math.min(params.resolution ?? 3000, 2000)
      : (params.resolution ?? 3000);

    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    for (let L = 0; L < layers; L++) {
      const color = palette.colors[L % palette.colors.length];
      const [cr, cg, cb] = hexToRgb(color);

      // Per-layer n/d ratio, optionally morphed by time
      let k: number;
      if (animMode === 'morph') {
        // Slowly increment effective ratio across all layers simultaneously
        k = (n0 + L * spread + t * 0.12) / d0;
      } else {
        k = (n0 + L * spread) / d0;
      }

      // Winding period: curve closes after d0 full rotations (2π each)
      const period = d0 * 2 * Math.PI;
      const steps  = res;

      // Per-layer phase offset
      let rotOffset = 0;
      if (animMode === 'spin') {
        rotOffset = t * (1 + L * 0.2);
      } else if (animMode === 'bloom') {
        rotOffset = t * (L + 1) * 0.35;
      }

      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.85)`;
      ctx.lineWidth = sw;
      ctx.beginPath();

      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * period;
        const r = R * Math.cos(k * theta);
        const x = cx + r * Math.cos(theta + rotOffset);
        const y = cy + r * Math.sin(theta + rotOffset);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    return ((params.layers ?? 3) * (params.resolution ?? 3000) / 100) | 0;
  },
};
