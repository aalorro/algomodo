import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  particleCount: {
    name: 'Particle Count',
    type: 'number', min: 500, max: 10000, step: 500, default: 4000,
    group: 'Composition',
  },
  noiseScale: {
    name: 'Noise Scale',
    type: 'number', min: 0.2, max: 5, step: 0.1, default: 1.2,
    help: 'Spatial scale of the curl field',
    group: 'Composition',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.5, max: 8, step: 0.25, default: 3.0,
    group: 'Flow/Motion',
  },
  trailDecay: {
    name: 'Trail Decay',
    type: 'number', min: 0.005, max: 0.2, step: 0.005, default: 0.025,
    help: 'Trail fade rate (lower = longer)',
    group: 'Texture',
  },
  evolution: {
    name: 'Evolution',
    type: 'number', min: 0, max: 0.3, step: 0.005, default: 0.05,
    help: 'How fast the field evolves',
    group: 'Flow/Motion',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.25, max: 3, step: 0.25, default: 0.75,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'velocity', 'position'],
    default: 'palette',
    group: 'Color',
  },
};

const EPS = 0.001;

export const curlFluid: Generator = {
  id: 'curl-fluid',
  family: 'animation',
  styleName: 'Curl Fluid',
  definition: 'Particles driven by the curl of a Perlin noise field — a divergence-free velocity field that produces fluid-like swirling motion',
  algorithmNotes: 'The curl of scalar noise field f is computed numerically as (∂f/∂y, -∂f/∂x). This guarantees no sources or sinks, giving purely rotational, physically plausible flow.',
  parameterSchema,
  defaultParams: { particleCount: 4000, noiseScale: 1.2, speed: 3.0, trailDecay: 0.025, evolution: 0.05, lineWidth: 0.75, colorMode: 'palette' },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const { particleCount, noiseScale, speed, trailDecay, evolution, lineWidth, colorMode } = params;

    const storeKey = `__curl_${seed}`;
    let state = (globalThis as any)[storeKey];

    if (!state || state.w !== w || state.h !== h || state.count !== particleCount) {
      const rng = new SeededRNG(seed);
      const particles = Array.from({ length: particleCount }, () => ({
        x: rng.random() * w,
        y: rng.random() * h,
        vx: 0,
        vy: 0,
        age: rng.integer(0, 200),
        maxAge: 100 + rng.integer(0, 300),
        colorIdx: rng.integer(0, palette.colors.length - 1),
      }));

      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const offCtx = off.getContext('2d')!;
      offCtx.fillStyle = '#080808';
      offCtx.fillRect(0, 0, w, h);

      state = { particles, off, offCtx, w, h, count: particleCount };
      (globalThis as any)[storeKey] = state;
    }

    const { offCtx } = state as {
      particles: { x: number; y: number; vx: number; vy: number; age: number; maxAge: number; colorIdx: number }[];
      off: HTMLCanvasElement;
      offCtx: CanvasRenderingContext2D;
    };

    const noise = new SimplexNoise(seed);
    const t = time * evolution;

    // Fade trails
    offCtx.fillStyle = `rgba(8,8,8,${trailDecay})`;
    offCtx.fillRect(0, 0, w, h);
    offCtx.lineWidth = lineWidth;

    for (const p of state.particles) {
      const nx = (p.x / w) * noiseScale;
      const ny = (p.y / h) * noiseScale;

      // Curl: numerically differentiate noise
      const dfdx = (noise.noise2D(nx + EPS, ny + t) - noise.noise2D(nx - EPS, ny + t)) / (2 * EPS);
      const dfdy = (noise.noise2D(nx, ny + EPS + t) - noise.noise2D(nx, ny - EPS + t)) / (2 * EPS);

      // Curl velocity: (∂f/∂y, -∂f/∂x)
      const cvx = dfdy * speed;
      const cvy = -dfdx * speed;

      p.vx = p.vx * 0.85 + cvx * 0.15;
      p.vy = p.vy * 0.85 + cvy * 0.15;

      const px = p.x, py = p.y;
      p.x += p.vx;
      p.y += p.vy;
      p.age++;

      // Color
      let col: string;
      if (colorMode === 'velocity') {
        const v = Math.min(1, Math.sqrt(p.vx * p.vx + p.vy * p.vy) / (speed * 1.5));
        col = palette.colors[Math.min(Math.floor(v * palette.colors.length), palette.colors.length - 1)];
      } else if (colorMode === 'position') {
        const posT = (p.x / w * 0.5 + p.y / h * 0.5);
        const ci = posT * (palette.colors.length - 1);
        col = palette.colors[Math.min(Math.floor(ci), palette.colors.length - 1)];
      } else {
        col = palette.colors[p.colorIdx % palette.colors.length];
      }

      const [r, g, b] = hexToRgb(col);
      const alpha = Math.sin(Math.min(1, p.age / 30) * Math.PI * 0.5) * 0.7;
      offCtx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      offCtx.beginPath();
      offCtx.moveTo(px, py);
      offCtx.lineTo(p.x, p.y);
      offCtx.stroke();

      // Respawn
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.age > p.maxAge) {
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.vx = 0; p.vy = 0;
        p.age = 0;
        p.colorIdx = Math.floor(Math.random() * palette.colors.length);
        p.maxAge = 100 + Math.floor(Math.random() * 300);
      }
    }

    ctx.drawImage(state.off, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(params.particleCount / 6); },
};
