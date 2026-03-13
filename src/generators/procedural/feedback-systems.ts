import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

const TAU = Math.PI * 2;

const parameterSchema: ParameterSchema = {
  iterations: {
    name: 'Iterations', type: 'number', min: 3, max: 30, step: 1, default: 12,
    help: 'Number of recursive feedback passes',
    group: 'Composition',
  },
  zoomFactor: {
    name: 'Zoom Factor', type: 'number', min: 0.85, max: 1.15, step: 0.01, default: 0.97,
    help: 'Scale multiplier per iteration (<1 = zoom in, >1 = zoom out)',
    group: 'Geometry',
  },
  rotationRate: {
    name: 'Rotation Rate', type: 'number', min: 0, max: 2, step: 0.05, default: 0.5,
    help: 'Rotation speed in radians/second per iteration',
    group: 'Flow/Motion',
  },
  seedShape: {
    name: 'Seed Shape', type: 'select',
    options: ['circles', 'lines', 'grid', 'spiral'],
    default: 'circles',
    help: 'Initial pattern fed into the feedback loop',
    group: 'Composition',
  },
  colorDrift: {
    name: 'Color Drift', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Hue rotation amount per feedback iteration',
    group: 'Color',
  },
  blendOpacity: {
    name: 'Blend Opacity', type: 'number', min: 0.3, max: 1.0, step: 0.05, default: 0.75,
    help: 'Opacity of each feedback composite layer',
    group: 'Color',
  },
};

function drawSeedPattern(
  ctx: CanvasRenderingContext2D, shape: string, w: number, h: number,
  rng: SeededRNG, colors: string[],
) {
  const cx = w / 2, cy = h / 2;
  const minDim = Math.min(w, h);
  const nC = colors.length;

  if (shape === 'circles') {
    const count = rng.integer(6, 14);
    for (let i = 0; i < count; i++) {
      ctx.beginPath();
      const r = rng.range(minDim * 0.03, minDim * 0.12);
      const x = rng.range(w * 0.15, w * 0.85);
      const y = rng.range(h * 0.15, h * 0.85);
      ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = colors[i % nC];
      ctx.fill();
    }
  } else if (shape === 'lines') {
    const count = rng.integer(8, 20);
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      ctx.beginPath();
      ctx.lineWidth = rng.range(minDim * 0.003, minDim * 0.015);
      const a = rng.randomAngle();
      const len = rng.range(minDim * 0.15, minDim * 0.45);
      ctx.moveTo(cx + Math.cos(a) * len * 0.1, cy + Math.sin(a) * len * 0.1);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.strokeStyle = colors[i % nC];
      ctx.stroke();
    }
  } else if (shape === 'grid') {
    const cols = rng.integer(4, 10);
    const rows = rng.integer(4, 10);
    const cellW = w / (cols + 1);
    const cellH = h / (rows + 1);
    const dotR = Math.min(cellW, cellH) * 0.25;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.beginPath();
        const x = cellW * (c + 1);
        const y = cellH * (r + 1);
        ctx.arc(x, y, dotR, 0, TAU);
        ctx.fillStyle = colors[(r * cols + c) % nC];
        ctx.fill();
      }
    }
  } else {
    // spiral
    ctx.lineCap = 'round';
    const turns = rng.range(3, 8);
    const maxR = minDim * 0.4;
    const steps = 300;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const a = t * turns * TAU;
      const r = t * maxR;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const grad = ctx.createLinearGradient(0, 0, w, h);
    for (let i = 0; i < nC; i++) grad.addColorStop(i / (nC - 1), colors[i]);
    ctx.strokeStyle = grad;
    ctx.lineWidth = minDim * 0.008;
    ctx.stroke();
  }
}

export const feedbackSystems: Generator = {
  id: 'procedural-feedback-systems',
  family: 'procedural',
  styleName: 'Feedback Systems',
  definition: 'Iterative visual feedback loops that zoom, rotate, and color-shift the canvas onto itself creating fractal-like recursive patterns',
  algorithmNotes:
    'Draws a seed pattern (circles, lines, grid, or spiral) onto an offscreen canvas. Iteratively transforms (scale + rotate) and composites the buffer back onto itself with adjustable blend opacity. Each iteration applies a hue rotation for color drift. The result is a fractal feedback pattern where time drives the rotation angle.',
  parameterSchema,
  defaultParams: {
    iterations: 12, zoomFactor: 0.97, rotationRate: 0.5,
    seedShape: 'circles', colorDrift: 0.3, blendOpacity: 0.75,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const rng = new SeededRNG(seed);

    const iterations = Math.max(1, params.iterations ?? 12) | 0;
    let zoom = params.zoomFactor ?? 0.97;
    const rotRate = params.rotationRate ?? 0.5;
    const seedShape = params.seedShape || 'circles';
    const colorDrift = params.colorDrift ?? 0.3;
    const blendOpacity = params.blendOpacity ?? 0.75;

    // Audio reactivity
    const audioBass = params._audioBass ?? 0;
    const audioMid = params._audioMid ?? 0;
    zoom *= (1 + audioBass * 0.15);

    // Create offscreen buffers
    const bufA = document.createElement('canvas');
    bufA.width = w; bufA.height = h;
    const ctxA = bufA.getContext('2d')!;

    const bufB = document.createElement('canvas');
    bufB.width = w; bufB.height = h;
    const ctxB = bufB.getContext('2d')!;

    // Draw seed pattern on buffer A
    ctxA.fillStyle = '#000';
    ctxA.fillRect(0, 0, w, h);
    drawSeedPattern(ctxA, seedShape, w, h, rng, palette.colors);

    // Clear main canvas
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    // Feedback iterations
    for (let i = 0; i < iterations; i++) {
      const angle = rotRate * (time + i * 0.12) + audioMid * 0.4;

      // Transform A → B: clear B, then draw A with transform
      ctxB.clearRect(0, 0, w, h);
      ctxB.save();
      ctxB.translate(cx, cy);
      ctxB.rotate(angle);
      ctxB.scale(zoom, zoom);
      ctxB.translate(-cx, -cy);
      ctxB.drawImage(bufA, 0, 0);
      ctxB.restore();

      // Apply color drift via hue rotation filter
      if (colorDrift > 0) {
        ctxB.save();
        ctxB.globalCompositeOperation = 'source-atop';
        ctxB.filter = `hue-rotate(${i * colorDrift * 30}deg)`;
        ctxB.drawImage(bufB, 0, 0);
        ctxB.restore();
        ctxB.filter = 'none';
      }

      // Composite B onto main canvas with lighter blend
      ctx.save();
      ctx.globalAlpha = blendOpacity;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(bufB, 0, 0);
      ctx.restore();

      // Copy B → A for next iteration
      ctxA.clearRect(0, 0, w, h);
      ctxA.drawImage(bufB, 0, 0);
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round(300 + (params.iterations ?? 12) * 80);
  },
};
