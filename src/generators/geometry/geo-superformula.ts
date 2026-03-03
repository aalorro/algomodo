import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(colors: [number, number, number][], t: number): string {
  const ci = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
  const f  = ci - i0;
  const r  = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
  const g  = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
  const b  = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

/** Gielis superformula: r = (|cos(m·θ/4)/a|^n2 + |sin(m·θ/4)/b|^n3)^(-1/n1) */
function superformula(
  theta: number, m: number,
  n1: number, n2: number, n3: number,
  a: number, b: number,
): number {
  const t1   = Math.pow(Math.abs(Math.cos(m * theta / 4) / a), n2);
  const t2   = Math.pow(Math.abs(Math.sin(m * theta / 4) / b), n3);
  const base = t1 + t2;
  if (base === 0) return 0;
  return Math.pow(base, -1 / n1);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  m: {
    name: 'Symmetry (m)', type: 'number', min: 1, max: 20, step: 1, default: 6,
    help: 'm controls rotational symmetry — 3 = triangle, 4 = square, 5 = pentagon, 6 = hexagon, etc.',
    group: 'Geometry',
  },
  n1: {
    name: 'n1', type: 'number', min: 0.1, max: 20, step: 0.1, default: 1.0,
    help: 'Primary exponent — large n1 = rectangle-like; n1=1 = smooth circle/polygon; small n1 = star-like',
    group: 'Geometry',
  },
  n2: {
    name: 'n2', type: 'number', min: 0.1, max: 20, step: 0.1, default: 1.0,
    help: 'Cosine exponent — n2≠n3 breaks fore/aft symmetry',
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
    help: 'Concentric superformula outlines — each successive layer slightly varies n2 and n3 for organic depth',
    group: 'Composition',
  },
  copies: {
    name: 'Copies', type: 'number', min: 1, max: 8, step: 1, default: 1,
    help: 'Rotationally replicate the full shape stack — N evenly-spaced copies fan around the centre, building mandala-like radial symmetry on top of the shape\'s own m-fold symmetry',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['layer', 'gradient', 'radial'],
    default: 'layer',
    help: 'layer: each concentric ring uses one palette color | gradient: color sweeps through the full palette along the curve perimeter — reveals the rotational rhythm of the shape | radial: color by normalized radius — inner vs outer parts of the shape',
    group: 'Color',
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
    help: 'Number of θ samples per shape — increase for high-m values',
    group: 'Composition',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['spin', 'morph', 'breathe'], default: 'morph',
    help: 'spin: rotate copies | morph: n1 orbits around its set value, cycling through star↔polygon↔circle topologies | breathe: radius pulses per layer',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.25,
    group: 'Flow/Motion',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const geoSuperformula: Generator = {
  id: 'geo-superformula',
  family: 'geometry',
  styleName: 'Superformula',
  definition: "Johan Gielis' superformula — a single polar equation deforming through every polygon, star, and organic shape; rotational copies build mandalas, and gradient / radial colour modes reveal the angular and radial structure of the curve",
  algorithmNotes:
    'r(θ) = (|cos(m·θ/4)/a|^n2 + |sin(m·θ/4)/b|^n3)^(-1/n1). At n1=n2=n3=1, a=b=1 the shape is a circle; integer m gives m-fold rotational symmetry. Large n1 flattens edges (rectangle); small n1 sharpens corners (star); n2≠n3 or a≠b breaks symmetry. Copies: N shapes rotated by 2π/N, overlaying the m-fold shape symmetry with an additional N-fold radial replication. Per-layer n2/n3 variation (±12% per layer index) gives each concentric ring a slightly distinct shape. Morph animation orbits the set n1 value: n1_eff = max(0.01, n1 + 4·sin(t·0.4 + L·0.8)), passing through stars, polygons, and rounded forms continuously. Gradient colorMode: 60 segments per curve, each colored by θ/2π → palette lerp — reveals the m-fold periodicity as colour repeats. Radial colorMode: segment midpoint r / maxR → palette — inner parts of deeply-concave star shapes appear as one palette end, outer lobes as the other.',
  parameterSchema,
  defaultParams: {
    m: 6, n1: 1.0, n2: 1.0, n3: 1.0, a: 1.0, b: 1.0,
    layers: 2, copies: 1, colorMode: 'layer',
    strokeWidth: 2, fill: false, resolution: 1000,
    animMode: 'morph', speed: 0.25,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const canvasR = Math.min(w, h) * 0.42;

    const m         = Math.max(1, (params.m ?? 6) | 0);
    const n2base    = Math.max(0.01, params.n2 ?? 1.0);
    const n3base    = Math.max(0.01, params.n3 ?? 1.0);
    const a         = Math.max(0.01, params.a  ?? 1.0);
    const b         = Math.max(0.01, params.b  ?? 1.0);
    const layers    = Math.max(1, Math.min(6, (params.layers  ?? 2) | 0));
    const copies    = Math.max(1, Math.min(8, (params.copies  ?? 1) | 0));
    const colorMode = (params.colorMode ?? 'layer') as string;
    const sw        = params.strokeWidth ?? 2;
    const doFill    = params.fill    ?? false;
    const animMode  = (params.animMode  ?? 'morph') as string;
    const t         = time * (params.speed ?? 0.25);
    const steps     = quality === 'draft' || time > 0
      ? Math.min((params.resolution ?? 1000) | 0, 800)
      : Math.max(200, (params.resolution ?? 1000) | 0);

    const rgbPalette = palette.colors.map(hexToRgb);
    const nSeg = 60; // segments for gradient/radial modes

    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let copy = 0; copy < copies; copy++) {
      const copyRot = (copy / copies) * Math.PI * 2;

      for (let L = 0; L < layers; L++) {
        const layerScale = 1 - L * 0.22;
        const color = palette.colors[(L + copy * layers) % palette.colors.length];
        const [cr, cg, cb] = hexToRgb(color);

        // Per-layer n2/n3 variation for organic depth
        const n2 = Math.max(0.01, n2base * (1 + L * 0.12 * (L % 2 ? 1 : -1)));
        const n3 = Math.max(0.01, n3base * (1 + L * 0.09));

        // n1 and transform
        let n1 = Math.max(0.01, params.n1 ?? 1.0);
        let rotAngle  = copyRot;
        let radiusMul = 1;

        if (animMode === 'morph') {
          // Orbit around the set n1 value
          n1 = Math.max(0.01, n1 + 4.0 * Math.sin(t * 0.4 + L * 0.8));
        } else if (animMode === 'spin') {
          rotAngle = copyRot + t * (1 + L * 0.25);
        } else if (animMode === 'breathe') {
          radiusMul = 1 + 0.15 * Math.sin(t * 1.2 + L * Math.PI / layers);
        }

        // Sample r(θ) — single pass, store [r, theta]
        const rVals = new Float32Array(steps + 1);
        for (let i = 0; i <= steps; i++) {
          const theta = (i / steps) * 2 * Math.PI;
          rVals[i] = superformula(theta, m, n1, n2, n3, a, b);
        }

        // Max r for normalization
        let maxVal = 0;
        for (let i = 0; i <= steps; i++) if (rVals[i] > maxVal) maxVal = rVals[i];
        if (maxVal === 0) continue;

        // Helper: get canvas x,y for sample i
        const getXY = (i: number): [number, number] => {
          const theta = (i / steps) * 2 * Math.PI + rotAngle;
          const rn = (rVals[i] / maxVal) * canvasR * layerScale * radiusMul;
          return [cx + rn * Math.cos(theta), cy + rn * Math.sin(theta)];
        };

        if (colorMode === 'gradient' || colorMode === 'radial') {
          // Draw in nSeg segments, each with its own color
          for (let seg = 0; seg < nSeg; seg++) {
            const iStart = Math.floor((seg       / nSeg) * steps);
            const iEnd   = Math.ceil(((seg + 1) / nSeg) * steps);

            let t_color: number;
            if (colorMode === 'gradient') {
              // θ position → palette, offset per layer and copy
              t_color = ((seg / nSeg) + (L / Math.max(layers, 1)) * 0.25 + (copy / Math.max(copies, 1)) * 0.4) % 1;
            } else {
              // midpoint r → palette
              const iMid = (iStart + iEnd) >> 1;
              t_color = maxVal > 0 ? rVals[iMid] / maxVal : 0;
            }

            ctx.strokeStyle = lerpColor(rgbPalette, t_color);
            ctx.beginPath();
            for (let i = iStart; i <= iEnd; i++) {
              const [x, y] = getXY(i);
              if (i === iStart) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        } else {
          // layer: solid color per layer/copy
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.9)`;
          if (doFill) ctx.fillStyle = `rgba(${cr},${cg},${cb},0.12)`;

          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const [x, y] = getXY(i);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          if (doFill) ctx.fill();
          ctx.stroke();
        }
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },

  estimateCost(params) {
    return (((params.layers ?? 2) * (params.copies ?? 1) * (params.resolution ?? 1000)) / 20) | 0;
  },
};
