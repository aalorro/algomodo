import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

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
  warpStrength: {
    name: 'Domain Warp',
    type: 'number', min: 0, max: 2, step: 0.1, default: 0.5,
    help: 'Warp flow coordinates with a second noise layer for turbulent organics',
    group: 'Composition',
  },
  inkStyle: {
    name: 'Ink Style',
    type: 'select',
    options: ['fine', 'bold', 'mixed', 'splatter'],
    default: 'mixed',
    help: 'fine = thin hairlines; bold = thick strokes; mixed = both; splatter = ink blobs on death',
    group: 'Geometry',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.5, max: 8, step: 0.25, default: 2.5,
    group: 'Flow/Motion',
  },
  timeScale: {
    name: 'Evolution Speed',
    type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.08,
    help: 'How fast the flow field morphs over time',
    group: 'Flow/Motion',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 1.0,
    group: 'Texture',
  },
  trailDecay: {
    name: 'Trail Decay',
    type: 'number', min: 0.01, max: 0.3, step: 0.01, default: 0.04,
    help: 'How quickly trails fade (lower = longer, darker ink)',
    group: 'Texture',
  },
  opacity: {
    name: 'Stroke Opacity',
    type: 'number', min: 0.1, max: 1.0, step: 0.05, default: 0.55,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'angle', 'mono'],
    default: 'angle',
    help: 'palette = particle color; angle = flow direction → palette; mono = single ink color',
    group: 'Color',
  },
};

// ─── Generator ────────────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  colorIdx: number;
  life: number;
  maxLife: number;
  bold: boolean;
}

export const flowFieldInk: Generator = {
  id: 'flow-field-ink',
  family: 'animation',
  styleName: 'Flow Field Ink',
  definition: 'Ink-like particles drift through a domain-warped noise field, building up persistent layered strokes',
  algorithmNotes:
    'FBM noise drives a vector field; a second noise layer domain-warps the coordinates for organic ' +
    'turbulence. Particles age, fade in/out, and can be thin hairlines, bold strokes, or mixed. ' +
    'Color can follow flow-field direction for iridescent banding. Trails persist on an offscreen ' +
    'canvas and are seeded-warmed on first render so the static image is already dense.',
  parameterSchema,
  defaultParams: {
    particleCount: 2000, fieldScale: 1.8, warpStrength: 0.5, inkStyle: 'mixed',
    speed: 2.5, timeScale: 0.08,
    lineWidth: 1.0, trailDecay: 0.04, opacity: 0.55,
    colorMode: 'angle',
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const {
      particleCount, fieldScale, speed, trailDecay, lineWidth,
      timeScale, opacity,
    } = params;
    const warpStrength = params.warpStrength ?? 0.5;
    const inkStyle     = (params.inkStyle    ?? 'mixed') as string;
    const colorMode    = (params.colorMode   ?? 'angle') as string;

    // ── State: off-screen accumulation canvas + particles ─────────────────
    const storeKey = `__ffi_${seed}`;
    let state = (globalThis as any)[storeKey] as {
      particles: Particle[];
      off: HTMLCanvasElement;
      offCtx: CanvasRenderingContext2D;
      noise: SimplexNoise;
      w: number; h: number; count: number;
      initialized: boolean;
    } | undefined;

    if (!state || state.w !== w || state.h !== h || state.count !== particleCount) {
      const rng = new SeededRNG(seed);

      const boldRatio = inkStyle === 'bold' ? 0.7 : inkStyle === 'fine' ? 0 : 0.15;

      const particles: Particle[] = Array.from({ length: particleCount }, (_, i) => ({
        x: rng.range(0, w),
        y: rng.range(0, h),
        colorIdx: i % palette.colors.length,
        life: rng.range(0, 300),
        maxLife: rng.integer(150, 400),
        bold: rng.random() < boldRatio,
      }));

      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const offCtx = off.getContext('2d')!;
      offCtx.fillStyle = '#080810';
      offCtx.fillRect(0, 0, w, h);

      state = {
        particles, off, offCtx,
        noise: new SimplexNoise(seed),
        w, h, count: particleCount,
        initialized: false,
      };
      (globalThis as any)[storeKey] = state;
    }

    const { particles, offCtx, noise } = state;

    // ── Core update: move particles, stroke one line segment onto offCtx ──
    const runStep = (t: number) => {
      offCtx.lineWidth = lineWidth;

      for (const p of particles) {
        const nx = (p.x / w) * fieldScale;
        const ny = (p.y / h) * fieldScale;

        // Domain warp: shift sample coords with a second noise layer
        let wx = 0, wy = 0;
        if (warpStrength > 0) {
          wx = noise.fbm(nx * 0.6 + 40, ny * 0.6 + 40, 2, 2, 0.5) * warpStrength;
          wy = noise.fbm(nx * 0.6 + 80, ny * 0.6 + 60, 2, 2, 0.5) * warpStrength;
        }

        // FBM angle — 3 octaves for richer detail than plain noise2D
        const angle = noise.fbm(nx + wx + t, ny + wy + t * 0.71, 3, 2, 0.5) * Math.PI * 4;

        const ox = p.x;
        const oy = p.y;
        p.x += Math.cos(angle) * speed;
        p.y += Math.sin(angle) * speed;
        p.life++;

        // Resolve stroke color
        let col: string;
        if (colorMode === 'angle') {
          const normAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          const ci = Math.floor((normAngle / (Math.PI * 2)) * palette.colors.length) % palette.colors.length;
          col = palette.colors[ci];
        } else if (colorMode === 'mono') {
          col = palette.colors[0];
        } else {
          col = palette.colors[p.colorIdx % palette.colors.length];
        }

        // Life-based fade-in / fade-out envelope
        const lifeRatio = p.life / p.maxLife;
        const envelope = lifeRatio < 0.08 ? lifeRatio / 0.08
          : lifeRatio > 0.88 ? (1 - lifeRatio) / 0.12 : 1;
        const strokeAlpha = opacity * envelope * (p.bold ? 0.65 : 1.0);

        offCtx.strokeStyle = hexToRgba(col, strokeAlpha);
        offCtx.lineWidth = p.bold ? lineWidth * 3.5 : lineWidth;
        offCtx.lineCap = 'round';
        offCtx.beginPath();
        offCtx.moveTo(ox, oy);
        offCtx.lineTo(p.x, p.y);
        offCtx.stroke();

        // Respawn when dead or out of bounds
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.life > p.maxLife) {
          // Ink-splatter blob at death position (splatter style only)
          if (inkStyle === 'splatter' && p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h) {
            offCtx.fillStyle = hexToRgba(col, 0.75);
            const splatR = lineWidth * (2 + Math.random() * 3);
            offCtx.beginPath();
            offCtx.arc(p.x, p.y, splatR, 0, Math.PI * 2);
            offCtx.fill();
            // Secondary micro-drops
            for (let k = 0; k < 3; k++) {
              const da = Math.random() * Math.PI * 2;
              const dd = splatR * (0.5 + Math.random() * 1.5);
              offCtx.beginPath();
              offCtx.arc(p.x + Math.cos(da) * dd, p.y + Math.sin(da) * dd, splatR * 0.3, 0, Math.PI * 2);
              offCtx.fill();
            }
          }

          // Respawn at a random position (biased toward canvas interior)
          p.x = Math.random() * w;
          p.y = Math.random() * h;
          p.life = 0;
          p.maxLife = 150 + Math.floor(Math.random() * 250);
          p.colorIdx = Math.floor(Math.random() * palette.colors.length);
          if (inkStyle === 'mixed') p.bold = Math.random() < 0.15;
        }
      }
    };

    // ── First-render warmup: build up dense trails synchronously ──────────
    if (!state.initialized) {
      state.initialized = true;
      for (let i = 0; i < 200; i++) {
        offCtx.fillStyle = `rgba(8,8,16,${trailDecay})`;
        offCtx.fillRect(0, 0, w, h);
        runStep(i * timeScale * 0.016); // simulate ~200 frames at 60fps
      }
    }

    // ── Normal frame: fade trails then update ─────────────────────────────
    offCtx.fillStyle = `rgba(8,8,16,${trailDecay})`;
    offCtx.fillRect(0, 0, w, h);
    runStep(time * timeScale);

    // Blit offscreen to main canvas
    ctx.drawImage(state.off, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.06, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(params.particleCount / 8); },
};
