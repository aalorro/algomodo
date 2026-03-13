import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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
};

interface Instance {
  x: number; y: number;
  baseSize: number;
  baseRotation: number;
  colorIdx: number;
  filled: boolean;
  dist: number; // from center, for wave
}

function drawShape(
  ctx: CanvasRenderingContext2D, shape: string,
  x: number, y: number, size: number, rotation: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();

  if (shape === 'circle') {
    ctx.arc(0, 0, size, 0, TAU);
  } else if (shape === 'square') {
    const hs = size;
    ctx.rect(-hs, -hs, hs * 2, hs * 2);
  } else if (shape === 'triangle') {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * size, Math.sin(a) * size);
      else ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
    }
    ctx.closePath();
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      if (i === 0) ctx.moveTo(Math.cos(a) * size, Math.sin(a) * size);
      else ctx.lineTo(Math.cos(a) * size, Math.sin(a) * size);
    }
    ctx.closePath();
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const r = i % 2 === 0 ? size : size * 0.45;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
  }

  ctx.restore();
}

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
    rotationVar: 0.4, waveSpeed: 1.0, fillMode: 'filled',
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

    // Audio reactivity
    const audioBass = params._audioBass ?? 0;
    const audioMid = params._audioMid ?? 0;

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    // Generate instance data
    const instances: Instance[] = [];
    const baseSize = minDim * 0.035;

    if (arrangement === 'grid') {
      const cols = Math.ceil(Math.sqrt(count * w / h));
      const rows = Math.ceil(count / cols);
      const cellW = w / (cols + 1);
      const cellH = h / (rows + 1);
      for (let r = 0; r < rows && instances.length < count; r++) {
        for (let c = 0; c < cols && instances.length < count; c++) {
          const x = cellW * (c + 1) + rng.range(-0.2, 0.2) * cellW;
          const y = cellH * (r + 1) + rng.range(-0.2, 0.2) * cellH;
          const sz = baseSize * (1 + rng.range(-sizeVar, sizeVar));
          instances.push({
            x, y, baseSize: sz,
            baseRotation: rng.random() * rotVar * TAU,
            colorIdx: rng.integer(0, nC - 1),
            filled: fillMode === 'filled' || (fillMode === 'mixed' && rng.random() > 0.4),
            dist: Math.sqrt((x - cx) ** 2 + (y - cy) ** 2),
          });
        }
      }
    } else if (arrangement === 'radial') {
      const rings = Math.max(1, Math.ceil(Math.sqrt(count / 3)));
      let placed = 0;
      for (let ri = 0; ri < rings && placed < count; ri++) {
        const ringR = (ri + 1) / (rings + 1) * minDim * 0.45;
        const perRing = Math.max(3, Math.round(count / rings));
        for (let pi = 0; pi < perRing && placed < count; pi++) {
          const a = (pi / perRing) * TAU + ri * 0.3;
          const x = cx + Math.cos(a) * ringR;
          const y = cy + Math.sin(a) * ringR;
          const sz = baseSize * (1 + rng.range(-sizeVar, sizeVar));
          instances.push({
            x, y, baseSize: sz,
            baseRotation: rng.random() * rotVar * TAU,
            colorIdx: rng.integer(0, nC - 1),
            filled: fillMode === 'filled' || (fillMode === 'mixed' && rng.random() > 0.4),
            dist: ringR,
          });
          placed++;
        }
      }
    } else if (arrangement === 'spiral') {
      const maxR = minDim * 0.44;
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const r = t * maxR;
        const a = i * GOLDEN_ANGLE;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        const sz = baseSize * (1 + rng.range(-sizeVar, sizeVar));
        instances.push({
          x, y, baseSize: sz,
          baseRotation: rng.random() * rotVar * TAU,
          colorIdx: rng.integer(0, nC - 1),
          filled: fillMode === 'filled' || (fillMode === 'mixed' && rng.random() > 0.4),
          dist: r,
        });
      }
    } else {
      // scatter
      for (let i = 0; i < count; i++) {
        const x = rng.range(baseSize, w - baseSize);
        const y = rng.range(baseSize, h - baseSize);
        const sz = baseSize * (1 + rng.range(-sizeVar, sizeVar));
        instances.push({
          x, y, baseSize: sz,
          baseRotation: rng.random() * rotVar * TAU,
          colorIdx: rng.integer(0, nC - 1),
          filled: fillMode === 'filled' || (fillMode === 'mixed' && rng.random() > 0.4),
          dist: Math.sqrt((x - cx) ** 2 + (y - cy) ** 2),
        });
      }
    }

    // Sort by distance for back-to-front drawing (outer first = further away)
    instances.sort((a, b) => b.dist - a.dist);

    // Draw instances
    ctx.lineWidth = Math.max(1, minDim * 0.003);

    for (const inst of instances) {
      // Wave animation
      const phase = inst.dist * 0.008 - time * waveSpd * 2;
      const scaleWave = 1 + (0.35 + audioBass * 0.8) * Math.sin(phase);
      const rotWave = (0.5 + audioMid * 0.6) * Math.sin(phase * 0.7 + 1.2);
      const alphaWave = 0.55 + 0.45 * Math.sin(phase * 0.5 + 0.8);

      const sz = inst.baseSize * scaleWave;
      const rot = inst.baseRotation + rotWave;
      const color = hexToRgba(palette.colors[inst.colorIdx], alphaWave);

      drawShape(ctx, shape, inst.x, inst.y, sz, rot);

      if (inst.filled) {
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round((params.count ?? 150) * 5);
  },
};
