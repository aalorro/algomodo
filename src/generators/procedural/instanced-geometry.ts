import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Precomputed unit polygon vertices
const POLY_CACHE: Record<string, { x: Float64Array; y: Float64Array }> = {};
function getPolyVertices(shape: string): { x: Float64Array; y: Float64Array } {
  if (POLY_CACHE[shape]) return POLY_CACHE[shape];
  let n: number;
  let offset = 0;
  let altRadius: number | null = null;
  if (shape === 'triangle') { n = 3; offset = -Math.PI / 2; }
  else if (shape === 'hexagon') { n = 6; offset = 0; }
  else if (shape === 'star') { n = 10; offset = -Math.PI / 2; altRadius = 0.45; }
  else { n = 0; offset = 0; }

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + offset;
    const r = (altRadius !== null && i % 2 !== 0) ? altRadius : 1;
    x[i] = Math.cos(a) * r;
    y[i] = Math.sin(a) * r;
  }
  POLY_CACHE[shape] = { x, y };
  return { x, y };
}

const parameterSchema: ParameterSchema = {
  shape: {
    name: 'Shape', type: 'select',
    options: ['triangle', 'hexagon', 'circle', 'square', 'star'],
    default: 'hexagon',
    group: 'Geometry',
  },
  count: {
    name: 'Count', type: 'number', min: 10, max: 500, step: 10, default: 150,
    help: 'Number of shape instances',
    group: 'Composition',
  },
  arrangement: {
    name: 'Arrangement', type: 'select',
    options: ['grid', 'radial', 'spiral', 'scatter'],
    default: 'grid',
    group: 'Composition',
  },
  sizeVar: {
    name: 'Size Variance', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Random size variation per instance',
    group: 'Geometry',
  },
  rotationVar: {
    name: 'Rotation Var', type: 'number', min: 0, max: 1, step: 0.05, default: 0.4,
    help: 'Random rotation variation',
    group: 'Geometry',
  },
  waveSpeed: {
    name: 'Wave Speed', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0,
    help: 'Animation wave propagation speed',
    group: 'Flow/Motion',
  },
  fillMode: {
    name: 'Fill Mode', type: 'select',
    options: ['filled', 'outlined', 'mixed'],
    default: 'filled',
    group: 'Texture',
  },
  reactivity: {
    name: 'Audio Reactivity', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0,
    help: 'Sensitivity to audio input (0 = none)',
    group: 'Flow/Motion',
  },
};

export const instancedGeometry: Generator = {
  id: 'procedural-instanced-geometry',
  family: 'procedural',
  styleName: 'Instanced Geometry',
  definition: 'Many copies of a base shape arranged in grids, spirals, or radial patterns with wave-propagation animation',
  algorithmNotes:
    'Generates N instances of a parametric shape placed by arrangement rule (grid, radial, golden-angle spiral, random scatter). Each instance has seeded size, rotation, and palette color. Animation propagates a wave outward from center, modulating scale and rotation per instance based on distance.',
  parameterSchema,
  defaultParams: {
    shape: 'hexagon', count: 150, arrangement: 'grid', sizeVar: 0.3,
    rotationVar: 0.4, waveSpeed: 1.0, fillMode: 'filled', reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const minDim = Math.min(w, h);
    const cx = w / 2, cy = h / 2;

    const shape = params.shape || 'hexagon';
    const count = Math.max(1, params.count ?? 150) | 0;
    const arrangement = params.arrangement || 'grid';
    const sizeVar = params.sizeVar ?? 0.3;
    const rotVar = params.rotationVar ?? 0.4;
    const waveSpd = params.waveSpeed ?? 1.0;
    const fillMode = params.fillMode || 'filled';
    const nC = palette.colors.length;

    const rx = params.reactivity ?? 1.0;
    const audioBass = (params._audioBass ?? 0) * rx;
    const audioMid = (params._audioMid ?? 0) * rx;

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    // Pre-parse palette colors to RGB arrays
    const palR = new Uint8Array(nC);
    const palG = new Uint8Array(nC);
    const palB = new Uint8Array(nC);
    for (let i = 0; i < nC; i++) {
      const n = parseInt(palette.colors[i].replace('#', ''), 16);
      palR[i] = (n >> 16) & 255; palG[i] = (n >> 8) & 255; palB[i] = n & 255;
    }

    // Generate instance data into flat arrays (SoA)
    const instX = new Float32Array(count);
    const instY = new Float32Array(count);
    const instSize = new Float32Array(count);
    const instRot = new Float32Array(count);
    const instColorIdx = new Uint8Array(count);
    const instFilled = new Uint8Array(count);
    const instDist = new Float32Array(count);
    let instCount = 0;

    const baseSize = minDim * 0.035;

    if (arrangement === 'grid') {
      const cols = Math.ceil(Math.sqrt(count * w / h));
      const rows = Math.ceil(count / cols);
      const cellW = w / (cols + 1);
      const cellH = h / (rows + 1);
      for (let r = 0; r < rows && instCount < count; r++) {
        for (let c = 0; c < cols && instCount < count; c++) {
          const x = cellW * (c + 1) + rng.range(-0.2, 0.2) * cellW;
          const y = cellH * (r + 1) + rng.range(-0.2, 0.2) * cellH;
          instX[instCount] = x;
          instY[instCount] = y;
          instSize[instCount] = baseSize * (1 + rng.range(-sizeVar, sizeVar));
          instRot[instCount] = rng.random() * rotVar * TAU;
          instColorIdx[instCount] = rng.integer(0, nC - 1);
          instFilled[instCount] = (fillMode === 'filled' || (fillMode === 'mixed' && rng.random() > 0.4)) ? 1 : 0;
          const dx = x - cx, dy = y - cy;
          instDist[instCount] = Math.sqrt(dx * dx + dy * dy);
          instCount++;
        }
      }
    } else if (arrangement === 'radial') {
      const rings = Math.max(1, Math.ceil(Math.sqrt(count / 3)));
      for (let ri = 0; ri < rings && instCount < count; ri++) {
        const ringR = (ri + 1) / (rings + 1) * minDim * 0.45;
        const perRing = Math.max(3, Math.round(count / rings));
        for (let pi = 0; pi < perRing && instCount < count; pi++) {
          const a = (pi / perRing) * TAU + ri * 0.3;
          instX[instCount] = cx + Math.cos(a) * ringR;
          instY[instCount] = cy + Math.sin(a) * ringR;
          instSize[instCount] = baseSize * (1 + rng.range(-sizeVar, sizeVar));
          instRot[instCount] = rng.random() * rotVar * TAU;
          instColorIdx[instCount] = rng.integer(0, nC - 1);
          instFilled[instCount] = (fillMode === 'filled' || (fillMode === 'mixed' && rng.random() > 0.4)) ? 1 : 0;
          instDist[instCount] = ringR;
          instCount++;
        }
      }
    } else if (arrangement === 'spiral') {
      const maxR = minDim * 0.44;
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const r = t * maxR;
        const a = i * GOLDEN_ANGLE;
        instX[instCount] = cx + Math.cos(a) * r;
        instY[instCount] = cy + Math.sin(a) * r;
        instSize[instCount] = baseSize * (1 + rng.range(-sizeVar, sizeVar));
        instRot[instCount] = rng.random() * rotVar * TAU;
        instColorIdx[instCount] = rng.integer(0, nC - 1);
        instFilled[instCount] = (fillMode === 'filled' || (fillMode === 'mixed' && rng.random() > 0.4)) ? 1 : 0;
        instDist[instCount] = r;
        instCount++;
      }
    } else {
      for (let i = 0; i < count; i++) {
        const x = rng.range(baseSize, w - baseSize);
        const y = rng.range(baseSize, h - baseSize);
        instX[instCount] = x;
        instY[instCount] = y;
        instSize[instCount] = baseSize * (1 + rng.range(-sizeVar, sizeVar));
        instRot[instCount] = rng.random() * rotVar * TAU;
        instColorIdx[instCount] = rng.integer(0, nC - 1);
        instFilled[instCount] = (fillMode === 'filled' || (fillMode === 'mixed' && rng.random() > 0.4)) ? 1 : 0;
        const dx = x - cx, dy = y - cy;
        instDist[instCount] = Math.sqrt(dx * dx + dy * dy);
        instCount++;
      }
    }

    // Sort indices by distance (back-to-front)
    const sortIdx = new Uint16Array(instCount);
    for (let i = 0; i < instCount; i++) sortIdx[i] = i;
    sortIdx.sort((a, b) => instDist[b] - instDist[a]);

    // Precompute polygon vertices if applicable
    const isCircle = shape === 'circle';
    const isSquare = shape === 'square';
    const poly = (!isCircle && !isSquare) ? getPolyVertices(shape) : null;
    const polyN = poly ? poly.x.length : 0;

    // Draw instances
    ctx.lineWidth = Math.max(1, minDim * 0.003);
    const waveSpd2 = waveSpd * 2;
    const bassAmp = 0.35 + audioBass * 0.8;
    const midAmp = 0.5 + audioMid * 0.6;

    for (let si = 0; si < instCount; si++) {
      const ii = sortIdx[si];
      const phase = instDist[ii] * 0.008 - time * waveSpd2;
      const sinPhase = Math.sin(phase);
      const scaleWave = 1 + bassAmp * sinPhase;
      const rotWave = midAmp * Math.sin(phase * 0.7 + 1.2);
      const alphaWave = 0.55 + 0.45 * Math.sin(phase * 0.5 + 0.8);

      const sz = instSize[ii] * scaleWave;
      const rot = instRot[ii] + rotWave;
      const ci = instColorIdx[ii];

      // Set style
      const alphaStr = alphaWave.toFixed(2);
      const colorStr = `rgba(${palR[ci]},${palG[ci]},${palB[ci]},${alphaStr})`;

      const ix = instX[ii], iy = instY[ii];

      // Draw shape using setTransform (avoids save/restore overhead)
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      ctx.setTransform(cosR, sinR, -sinR, cosR, ix, iy);
      ctx.beginPath();

      if (isCircle) {
        ctx.arc(0, 0, sz, 0, TAU);
      } else if (isSquare) {
        ctx.rect(-sz, -sz, sz * 2, sz * 2);
      } else {
        ctx.moveTo(poly!.x[0] * sz, poly!.y[0] * sz);
        for (let v = 1; v < polyN; v++) {
          ctx.lineTo(poly!.x[v] * sz, poly!.y[v] * sz);
        }
        ctx.closePath();
      }

      if (instFilled[ii]) {
        ctx.fillStyle = colorStr;
        ctx.fill();
      } else {
        ctx.strokeStyle = colorStr;
        ctx.stroke();
      }
    }

    // Reset transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round((params.count ?? 150) * 5);
  },
};
