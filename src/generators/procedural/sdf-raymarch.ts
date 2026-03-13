import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
  reactivity: {
    name: 'Audio Reactivity', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0,
    help: 'Sensitivity to audio input (0 = none)',
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
    smoothBlend: 0.3, rotationSpeed: 0.5, speed: 0.5, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const minDim = Math.min(w, h);
    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : 2;

    const sceneType = params.sceneType || 'spheres';
    const complexity = Math.max(1, params.complexity ?? 4) | 0;
    const rx = params.reactivity ?? 1.0;
    const audioBass = (params._audioBass ?? 0) * rx;
    const audioMid = (params._audioMid ?? 0) * rx;

    const glowIntensity = (params.glowIntensity ?? 0.5) + audioBass * 0.5;
    const bandWidth = params.bandWidth ?? 0.3;
    const smoothK = (params.smoothBlend ?? 0.3) * minDim * 0.15;
    const useSmooth = smoothK >= 0.001;
    const rotSpeed = (params.rotationSpeed ?? 0.5) * (1 + audioMid * 1.5);
    const spd = params.speed ?? 0.5;
    const t = time * spd;

    const colors = palette.colors.map(hexToRgb);
    const nC = colors.length;

    // Generate primitives — use flat arrays (SoA) for cache-friendly per-pixel access
    const addPrimDepth0 = sceneType === 'fractal' ? 2 : 1;
    const maxPrims = complexity * addPrimDepth0 + (sceneType === 'fractal' ? Math.min(3, complexity) : 0);
    const primType = new Uint8Array(maxPrims);    // 0=circle, 1=roundbox
    const primCx = new Float64Array(maxPrims);
    const primCy = new Float64Array(maxPrims);
    const primR = new Float64Array(maxPrims);
    const primHW = new Float64Array(maxPrims);
    const primHH = new Float64Array(maxPrims);
    const primRR = new Float64Array(maxPrims);
    const primOrbitR = new Float64Array(maxPrims);
    const primOrbitSpd = new Float64Array(maxPrims);
    const primOrbitPhase = new Float64Array(maxPrims);
    const primColorIdx = new Uint8Array(maxPrims);
    const primOp = new Uint8Array(maxPrims); // 0=union, 1=subtract

    let primCount = 0;
    const addPrim = (depth: number) => {
      const count = depth === 0 ? complexity : Math.min(3, complexity);
      const sizeScale = depth === 0 ? 1 : 0.4;
      for (let i = 0; i < count; i++) {
        const isCircle = sceneType === 'spheres' || (sceneType === 'blend' && rng.random() > 0.5);
        const isBox = sceneType === 'boxes' || (sceneType === 'blend' && !isCircle && sceneType !== 'spheres');
        const idx = primCount++;
        primType[idx] = isCircle ? 0 : ((isBox || sceneType === 'boxes') ? 1 : 0);
        primCx[idx] = rng.range(0.2, 0.8) * w;
        primCy[idx] = rng.range(0.2, 0.8) * h;
        primR[idx] = rng.range(0.06, 0.18) * minDim * sizeScale;
        const hw = rng.range(0.05, 0.16) * minDim * sizeScale;
        const hh = rng.range(0.05, 0.16) * minDim * sizeScale;
        const rr = rng.range(0.01, 0.04) * minDim * sizeScale;
        primHW[idx] = hw - rr;
        primHH[idx] = hh - rr;
        primRR[idx] = rr;
        primOrbitR[idx] = rng.range(0.02, 0.1) * minDim * sizeScale;
        primOrbitSpd[idx] = rng.range(0.5, 2.0) * (rng.random() > 0.5 ? 1 : -1);
        primOrbitPhase[idx] = rng.randomAngle();
        primColorIdx[idx] = rng.integer(0, nC - 1);
        primOp[idx] = (i === 0 || rng.random() > 0.3) ? 0 : 1;
      }
    };
    addPrim(0);
    if (sceneType === 'fractal') addPrim(1);

    // Precompute animated positions
    const animCx = new Float64Array(primCount);
    const animCy = new Float64Array(primCount);
    for (let i = 0; i < primCount; i++) {
      const a = t * rotSpeed * primOrbitSpd[i] + primOrbitPhase[i];
      animCx[i] = primCx[i] + Math.cos(a) * primOrbitR[i];
      animCy[i] = primCy[i] + Math.sin(a) * primOrbitR[i];
    }

    // Precompute shading constants
    const shadeDiv = 1 / (minDim * 0.05);
    const glowDiv = -1 / (minDim * 0.06);
    const bandScale = bandWidth > 0.01 ? Math.PI / (bandWidth * minDim * 0.05) : 0;
    const hasGlow = glowIntensity > 0;
    const hasBand = bandScale > 0;

    // Render with Uint32Array for fast 4-byte writes
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const buf32 = new Uint32Array(data.buffer);
    // Detect endianness
    data[0] = 1; data[1] = 2; data[2] = 3; data[3] = 4;
    const isLE = buf32[0] === 0x04030201;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        // Inline evalSDF — no tuple allocation
        let d = Infinity;
        let closest = 0;
        for (let i = 0; i < primCount; i++) {
          let di: number;
          if (primType[i] === 0) {
            // sdCircle inlined
            const dx = px - animCx[i];
            const dy = py - animCy[i];
            di = Math.sqrt(dx * dx + dy * dy) - primR[i];
          } else {
            // sdRoundBox inlined (sdBox with pre-subtracted rr)
            const dx = Math.abs(px - animCx[i]) - primHW[i];
            const dy = Math.abs(py - animCy[i]) - primHH[i];
            const dx0 = dx > 0 ? dx : 0;
            const dy0 = dy > 0 ? dy : 0;
            di = Math.sqrt(dx0 * dx0 + dy0 * dy0) + (dx > dy ? (dy > 0 ? 0 : dy) : (dx > 0 ? 0 : dx)) - primRR[i];
          }
          if (i === 0) {
            d = di;
          } else if (primOp[i] === 1) {
            // smooth subtract
            if (useSmooth) {
              const h = Math.max(0, Math.min(1, 0.5 - 0.5 * (d + di) / smoothK));
              const nd = d * (1 - h) + (-di) * h + smoothK * h * (1 - h);
              if (nd !== d) closest = i;
              d = nd;
            } else {
              const nd = d > -di ? d : -di;
              if (nd !== d) closest = i;
              d = nd;
            }
          } else {
            if (di < d) closest = i;
            if (useSmooth) {
              const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (di - d) / smoothK));
              d = d * h + di * (1 - h) - smoothK * h * (1 - h);
            } else {
              if (di < d) d = di;
            }
          }
        }

        let r: number, g: number, b: number;
        if (d < 0) {
          const c = colors[primColorIdx[closest]];
          const shade = 0.7 + 0.3 * Math.min(1, -d * shadeDiv);
          r = c[0] * shade;
          g = c[1] * shade;
          b = c[2] * shade;
        } else {
          const glow = hasGlow ? Math.exp(d * glowDiv) * glowIntensity : 0;
          const band = hasBand ? (Math.sin(d * bandScale) * 0.5 + 0.5) * 0.35 : 0;
          const v = glow + band;
          const c = colors[primColorIdx[closest] % nC];
          r = c[0] * v;
          g = c[1] * v;
          b = c[2] * v;
        }

        const ri = r < 0 ? 0 : r > 255 ? 255 : r | 0;
        const gi = g < 0 ? 0 : g > 255 ? 255 : g | 0;
        const bi = b < 0 ? 0 : b > 255 ? 255 : b | 0;
        const pixel = isLE
          ? (0xFF000000 | (bi << 16) | (gi << 8) | ri)
          : ((ri << 24) | (gi << 16) | (bi << 8) | 0xFF);

        // Fill step×step block
        if (step === 1) {
          buf32[py * w + px] = pixel;
        } else {
          const maxDy = Math.min(step, h - py);
          const maxDx = Math.min(step, w - px);
          for (let dy = 0; dy < maxDy; dy++) {
            const rowBase = (py + dy) * w + px;
            for (let dx = 0; dx < maxDx; dx++) {
              buf32[rowBase + dx] = pixel;
            }
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
