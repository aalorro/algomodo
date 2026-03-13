import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// SDF primitives
function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r;
}

function sdBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number): number {
  const dx = Math.abs(px - cx) - hw;
  const dy = Math.abs(py - cy) - hh;
  return Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) + Math.min(Math.max(dx, dy), 0);
}

function sdRoundBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
  return sdBox(px, py, cx, cy, hw - r, hh - r) - r;
}

// Boolean ops
function opSmoothUnion(d1: number, d2: number, k: number): number {
  if (k < 0.001) return Math.min(d1, d2);
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (d2 - d1) / k));
  return d1 * h + d2 * (1 - h) - k * h * (1 - h);
}

function opSmoothSubtract(d1: number, d2: number, k: number): number {
  if (k < 0.001) return Math.max(d1, -d2);
  const h = Math.max(0, Math.min(1, 0.5 - 0.5 * (d1 + d2) / k));
  return d1 * (1 - h) + (-d2) * h + k * h * (1 - h);
}

interface Primitive {
  type: 'circle' | 'box' | 'roundbox';
  cx: number; cy: number;
  r: number; hw: number; hh: number; rr: number;
  orbitR: number; orbitSpeed: number; orbitPhase: number;
  colorIdx: number;
  op: 'union' | 'subtract';
}

const parameterSchema: ParameterSchema = {
  sceneType: {
    name: 'Scene', type: 'select',
    options: ['spheres', 'boxes', 'blend', 'fractal'],
    default: 'spheres',
    help: 'spheres: circles | boxes: rounded rects | blend: mixed | fractal: recursive self-similar',
    group: 'Composition',
  },
  complexity: {
    name: 'Complexity', type: 'number', min: 1, max: 8, step: 1, default: 4,
    help: 'Number of SDF primitives',
    group: 'Composition',
  },
  glowIntensity: {
    name: 'Glow', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5,
    help: 'Glow halo intensity around shapes',
    group: 'Texture',
  },
  bandWidth: {
    name: 'Band Width', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Distance-based contour band width (0 = off)',
    group: 'Texture',
  },
  smoothBlend: {
    name: 'Smooth Blend', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Smooth union/subtract blending factor',
    group: 'Geometry',
  },
  rotationSpeed: {
    name: 'Rotation Speed', type: 'number', min: 0, max: 2, step: 0.1, default: 0.5,
    help: 'Primitive orbit speed',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 2, step: 0.1, default: 0.5,
    help: 'Global animation speed',
    group: 'Flow/Motion',
  },
};

export const sdfRaymarch: Generator = {
  id: 'procedural-sdf-raymarch',
  family: 'procedural',
  styleName: 'SDF Raymarch',
  definition: '2D signed-distance-field rendering with smooth boolean operations, glow halos, and distance-band contours',
  algorithmNotes:
    'Generates SDF primitives (circles, rounded boxes) with seeded positions and sizes. Primitives orbit their base positions over time. Per-pixel: combined SDF is evaluated via smooth union/subtract. Interior is palette-colored by nearest primitive; exterior shows exponential glow and sinusoidal distance banding. Fractal mode recursively adds smaller self-similar copies.',
  parameterSchema,
  defaultParams: {
    sceneType: 'spheres', complexity: 4, glowIntensity: 0.5, bandWidth: 0.3,
    smoothBlend: 0.3, rotationSpeed: 0.5, speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const minDim = Math.min(w, h);
    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : 2;

    const sceneType = params.sceneType || 'spheres';
    const complexity = Math.max(1, params.complexity ?? 4) | 0;
    // Audio reactivity
    const audioBass = params._audioBass ?? 0;
    const audioMid = params._audioMid ?? 0;

    const glowIntensity = (params.glowIntensity ?? 0.5) + audioBass * 0.5;
    const bandWidth = params.bandWidth ?? 0.3;
    const smoothK = (params.smoothBlend ?? 0.3) * minDim * 0.15;
    const rotSpeed = (params.rotationSpeed ?? 0.5) * (1 + audioMid * 1.5);
    const spd = params.speed ?? 0.5;
    const t = time * spd;

    // Parse palette
    const colors = palette.colors.map(hexToRgb);
    const nC = colors.length;

    // Generate primitives
    const prims: Primitive[] = [];
    const addPrim = (depth: number) => {
      const count = depth === 0 ? complexity : Math.min(3, complexity);
      const sizeScale = depth === 0 ? 1 : 0.4;
      for (let i = 0; i < count; i++) {
        const isCircle = sceneType === 'spheres' || (sceneType === 'blend' && rng.random() > 0.5);
        const isBox = sceneType === 'boxes' || (sceneType === 'blend' && !isCircle && sceneType !== 'spheres');
        const cx = rng.range(0.2, 0.8) * w;
        const cy = rng.range(0.2, 0.8) * h;
        const r = rng.range(0.06, 0.18) * minDim * sizeScale;
        const hw = rng.range(0.05, 0.16) * minDim * sizeScale;
        const hh = rng.range(0.05, 0.16) * minDim * sizeScale;
        const rr = rng.range(0.01, 0.04) * minDim * sizeScale;
        prims.push({
          type: isCircle ? 'circle' : (isBox || sceneType === 'boxes') ? 'roundbox' : 'circle',
          cx, cy, r, hw, hh, rr,
          orbitR: rng.range(0.02, 0.1) * minDim * sizeScale,
          orbitSpeed: rng.range(0.5, 2.0) * (rng.random() > 0.5 ? 1 : -1),
          orbitPhase: rng.randomAngle(),
          colorIdx: rng.integer(0, nC - 1),
          op: i === 0 || rng.random() > 0.3 ? 'union' : 'subtract',
        });
      }
    };
    addPrim(0);
    if (sceneType === 'fractal') addPrim(1);

    // Animated positions
    const animCx: number[] = [];
    const animCy: number[] = [];
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const a = t * rotSpeed * p.orbitSpeed + p.orbitPhase;
      animCx[i] = p.cx + Math.cos(a) * p.orbitR;
      animCy[i] = p.cy + Math.sin(a) * p.orbitR;
    }

    // Evaluate scene SDF at a point
    const evalSDF = (px: number, py: number): [number, number] => {
      let d = Infinity;
      let closest = 0;
      for (let i = 0; i < prims.length; i++) {
        const p = prims[i];
        let di: number;
        if (p.type === 'circle') {
          di = sdCircle(px, py, animCx[i], animCy[i], p.r);
        } else {
          di = sdRoundBox(px, py, animCx[i], animCy[i], p.hw, p.hh, p.rr);
        }
        if (i === 0) {
          d = di;
          closest = 0;
        } else if (p.op === 'subtract') {
          const prev = d;
          d = opSmoothSubtract(d, di, smoothK);
          if (d !== prev) closest = i;
        } else {
          if (di < d) closest = i;
          d = opSmoothUnion(d, di, smoothK);
        }
      }
      return [d, closest];
    };

    // Render pixel by pixel
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const bandScale = bandWidth > 0.01 ? Math.PI / (bandWidth * minDim * 0.05) : 0;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const [d, closest] = evalSDF(px, py);
        let r: number, g: number, b: number;

        if (d < 0) {
          // Interior — palette color of nearest primitive
          const c = colors[prims[closest as number].colorIdx];
          // Slight shading by depth
          const shade = 0.7 + 0.3 * Math.min(1, -d / (minDim * 0.05));
          r = c[0] * shade;
          g = c[1] * shade;
          b = c[2] * shade;
        } else {
          // Exterior
          const glow = glowIntensity > 0
            ? Math.exp(-d / (minDim * 0.06)) * glowIntensity
            : 0;
          const band = bandScale > 0
            ? (Math.sin(d * bandScale) * 0.5 + 0.5) * 0.35
            : 0;
          const v = glow + band;
          // Map glow/band to palette
          const ci = (closest as number) % nC;
          const c = colors[ci];
          r = c[0] * v;
          g = c[1] * v;
          b = c[2] * v;
        }

        r = Math.max(0, Math.min(255, r)) | 0;
        g = Math.max(0, Math.min(255, g)) | 0;
        b = Math.max(0, Math.min(255, b)) | 0;

        // Fill step×step block
        for (let dy = 0; dy < step && py + dy < h; dy++) {
          for (let dx = 0; dx < step && px + dx < w; dx++) {
            const idx = ((py + dy) * w + (px + dx)) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round((params.complexity ?? 4) * 150 + (params.sceneType === 'fractal' ? 200 : 0));
  },
};
