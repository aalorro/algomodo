import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  particleCount: {
    name: 'Particle Count',
    type: 'number', min: 200, max: 6000, step: 200, default: 2000,
    group: 'Composition',
  },
  fieldScale: {
    name: 'Field Scale',
    type: 'number', min: 0.3, max: 6, step: 0.1, default: 1.8,
    help: 'Spatial frequency of the noise flow field',
    group: 'Composition',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.5, max: 8, step: 0.25, default: 2.5,
    group: 'Flow/Motion',
  },
  trailDecay: {
    name: 'Trail Decay',
    type: 'number', min: 0.01, max: 0.3, step: 0.01, default: 0.04,
    help: 'How quickly trails fade (lower = longer)',
    group: 'Texture',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 1.0,
    group: 'Geometry',
  },
  timeScale: {
    name: 'Evolution Speed',
    type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.08,
    help: 'How fast the flow field morphs over time',
    group: 'Flow/Motion',
  },
  opacity: {
    name: 'Stroke Opacity',
    type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 0.6,
    group: 'Texture',
  },
};

export const flowFieldInk: Generator = {
  id: 'flow-field-ink',
  family: 'animation',
  styleName: 'Flow Field Ink',
  definition: 'Ink-like particles drift through a noise-driven vector field, leaving persistent trails',
  algorithmNotes: 'Particles follow the gradient angle of time-varying Perlin noise. Trails persist and fade slowly, building up dense ink-like strokes over time.',
  parameterSchema,
  defaultParams: { particleCount: 2000, fieldScale: 1.8, speed: 2.5, trailDecay: 0.04, lineWidth: 1.0, timeScale: 0.08, opacity: 0.6 },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { particleCount, fieldScale, speed, trailDecay, lineWidth, timeScale, opacity } = params;

    const storeKey = `__ffi_${seed}`;
    let state = (globalThis as any)[storeKey];

    if (!state || state.w !== w || state.h !== h || state.count !== particleCount) {
      const rng = new SeededRNG(seed);
      const particles = Array.from({ length: particleCount }, (_, i) => ({
        x: rng.random() * w,
        y: rng.random() * h,
        colorIdx: i % palette.colors.length,
        life: rng.random() * 300,
        maxLife: 150 + rng.integer(0, 250),
      }));

      // Persistent offscreen canvas for trail accumulation
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const offCtx = off.getContext('2d')!;
      offCtx.fillStyle = '#0a0a0a';
      offCtx.fillRect(0, 0, w, h);

      state = { particles, off, offCtx, w, h, count: particleCount };
      (globalThis as any)[storeKey] = state;
    }

    const { particles, offCtx } = state as {
      particles: { x: number; y: number; colorIdx: number; life: number; maxLife: number }[];
      off: HTMLCanvasElement;
      offCtx: CanvasRenderingContext2D;
    };

    const noise = new SimplexNoise(seed);
    const t = time * timeScale;

    // Fade the trail canvas
    offCtx.fillStyle = `rgba(10,10,10,${trailDecay})`;
    offCtx.fillRect(0, 0, w, h);
    offCtx.lineWidth = lineWidth;

    for (const p of particles) {
      const nx = (p.x / w) * fieldScale;
      const ny = (p.y / h) * fieldScale;
      const angle = noise.noise2D(nx + t, ny + t * 0.7) * Math.PI * 4;

      const px = p.x;
      const py = p.y;
      p.x += Math.cos(angle) * speed;
      p.y += Math.sin(angle) * speed;
      p.life++;

      const col = palette.colors[p.colorIdx % palette.colors.length];
      const [r, g, b] = hexToRgb(col);
      offCtx.strokeStyle = `rgba(${r},${g},${b},${opacity})`;
      offCtx.beginPath();
      offCtx.moveTo(px, py);
      offCtx.lineTo(p.x, p.y);
      offCtx.stroke();

      // Respawn dead or out-of-bounds particles
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.life > p.maxLife) {
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.life = 0;
        p.colorIdx = Math.floor(Math.random() * palette.colors.length);
      }
    }

    ctx.drawImage(state.off, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.04, 0.04, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(params.particleCount / 8); },
};
