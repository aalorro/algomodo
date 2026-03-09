import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

// Golden angle in radians: 2π / φ² = π(3 − √5)
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count',
    type: 'number', min: 100, max: 5000, step: 100, default: 1500,
    group: 'Composition',
  },
  spread: {
    name: 'Spread',
    type: 'number', min: 0.5, max: 6, step: 0.25, default: 3.0,
    help: 'Scale factor c in r = c * sqrt(i) — controls how tightly packed the spiral is',
    group: 'Geometry',
  },
  angleOffset: {
    name: 'Angle Offset',
    type: 'number', min: -0.05, max: 0.05, step: 0.002, default: 0,
    help: 'Tiny deviation from golden angle — even 0.01 creates dramatically different spiral arms',
    group: 'Geometry',
  },
  dotSize: {
    name: 'Dot Size',
    type: 'number', min: 0.5, max: 10, step: 0.5, default: 3.5,
    group: 'Geometry',
  },
  sizeMode: {
    name: 'Size Mode',
    type: 'select',
    options: ['uniform', 'grow', 'shrink', 'wave'],
    default: 'uniform',
    help: 'uniform: same size | grow: bigger toward edge | shrink: bigger at center | wave: sinusoidal pulsing',
    group: 'Geometry',
  },
  shape: {
    name: 'Shape',
    type: 'select',
    options: ['circle', 'petal', 'star', 'square'],
    default: 'circle',
    help: 'circle: round dots | petal: teardrop pointing outward | star: 5-point star | square: rotated rect',
    group: 'Geometry',
  },
  connectLines: {
    name: 'Connect Lines',
    type: 'boolean',
    default: false,
    help: 'Draw a line connecting sequential dots — creates beautiful spiral line art',
    group: 'Texture',
  },
  glow: {
    name: 'Glow',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0.3,
    help: 'Radial halo around each dot — creates bioluminescent or watercolor bloom effect',
    group: 'Texture',
  },
  depthFade: {
    name: 'Depth Fade',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0.2,
    help: 'Center-to-edge opacity falloff — creates atmospheric perspective',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-radius', 'palette-angle', 'palette-noise', 'palette-fibonacci'],
    default: 'palette-radius',
    help: 'palette-radius: by distance | palette-angle: by position | palette-noise: FBM tint | palette-fibonacci: by Fibonacci spiral arm',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
  spinSpeed: {
    name: 'Spin Speed',
    type: 'number', min: 0, max: 0.5, step: 0.01, default: 0.05,
    help: 'Whole-pattern rotation speed (rad/s)',
    group: 'Flow/Motion',
  },
};

export const phyllotaxis: Generator = {
  id: 'plotter-phyllotaxis',
  family: 'plotter',
  styleName: 'Phyllotaxis',
  definition: 'Sunflower spiral: dots placed at successive golden-angle increments, radii growing as sqrt(i)',
  algorithmNotes:
    'Each point i is placed at angle i*(golden_angle + offset) and radius c*sqrt(i). Shape variants (petals, stars) and size modes (grow, shrink, wave) add visual variety. ConnectLines draws a continuous spiral. Angle offset lets users explore non-golden divergence angles that produce striking spiral arm patterns.',
  parameterSchema,
  defaultParams: {
    pointCount: 1500, spread: 3.0, angleOffset: 0, dotSize: 3.5,
    sizeMode: 'uniform', shape: 'circle', connectLines: false,
    glow: 0.3, depthFade: 0.2,
    colorMode: 'palette-radius', background: 'cream', spinSpeed: 0.05,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const noise = new SimplexNoise(seed);
    const cxc = w / 2, cyc = h / 2;
    const n = Math.max(1, params.pointCount ?? 1500) | 0;
    const c = params.spread ?? 3.0;
    const angleOff = params.angleOffset ?? 0;
    const baseDotR = params.dotSize ?? 3.5;
    const spinSpeed = params.spinSpeed ?? 0.05;
    const colorMode = params.colorMode || 'palette-radius';
    const sizeMode = params.sizeMode || 'uniform';
    const shape = params.shape || 'circle';
    const connectLines = params.connectLines ?? false;
    const glowAmount = params.glow ?? 0.3;
    const depthFade = params.depthFade ?? 0.2;
    const colors = palette.colors.map(hexToRgb);
    const isDark = params.background === 'dark';
    const spin = time * spinSpeed;

    // Maximum radius to clip dots inside canvas
    const maxR = Math.min(w, h) * 0.49;

    // Effective divergence angle
    const divergence = GOLDEN_ANGLE + angleOff;

    // Pre-compute positions
    const points: Array<{ x: number; y: number; r: number; dotR: number; i: number; angle: number }> = [];

    for (let i = 0; i < n; i++) {
      const angle = i * divergence + spin;
      const r = c * Math.sqrt(i);
      if (r > maxR) continue;

      const x = cxc + r * Math.cos(angle);
      const y = cyc + r * Math.sin(angle);
      if (x < -baseDotR * 4 || x > w + baseDotR * 4 || y < -baseDotR * 4 || y > h + baseDotR * 4) continue;

      // Size mode
      const t = r / maxR; // 0 = center, 1 = edge
      let dotR = baseDotR;
      if (sizeMode === 'grow') {
        dotR = baseDotR * (0.3 + t * 1.4);
      } else if (sizeMode === 'shrink') {
        dotR = baseDotR * (1.5 - t * 1.2);
      } else if (sizeMode === 'wave') {
        dotR = baseDotR * (0.5 + 0.8 * Math.abs(Math.sin(i * 0.15)));
      }

      points.push({ x, y, r, dotR, i, angle });
    }

    const baseAlpha = isDark ? 0.88 : 0.85;

    // Draw connecting lines first (behind dots)
    if (connectLines && points.length > 1) {
      ctx.lineCap = 'round';

      for (let si = 1; si < points.length; si++) {
        const t = si / points.length;
        const [cr, cg, cb] = interpolateColor(colors, t);
        const lineAlpha = (isDark ? 0.45 : 0.30) * (1 - t * 0.5);
        const lineWidth = Math.max(0.3, baseDotR * 0.4 * (1 - t * 0.6));

        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${lineAlpha})`;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();

        const prev = points[si - 1];
        const curr = points[si];
        const midX = (prev.x + curr.x) / 2;
        const midY = (prev.y + curr.y) / 2;
        ctx.moveTo(prev.x, prev.y);
        ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
        ctx.stroke();
      }
    }

    // Glow pass (behind solid shapes, uses additive compositing)
    if (glowAmount > 0) {
      ctx.save();
      ctx.globalCompositeOperation = isDark ? 'lighter' : 'screen';

      for (const p of points) {
        const t = p.r / maxR;
        let cr: number, cg: number, cb: number;
        [cr, cg, cb] = getPointColor(p, t, colorMode, isDark, colors, noise, w, h, cxc, cyc, maxR);

        const glowPulse = time > 0 ? (1 + 0.12 * Math.sin(time * 1.5 + p.i * 0.02)) : 1;
        const glowR = p.dotR * (1.5 + glowAmount * 2.5) * glowPulse;
        const depthAlpha = 1 - t * depthFade;

        const grad = ctx.createRadialGradient(p.x, p.y, p.dotR * 0.2, p.x, p.y, glowR);
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},${(0.4 * glowAmount * depthAlpha).toFixed(3)})`);
        grad.addColorStop(0.4, `rgba(${cr},${cg},${cb},${(0.12 * glowAmount * depthAlpha).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    // Draw solid shapes
    for (const p of points) {
      const t = p.r / maxR;
      let cr: number, cg: number, cb: number;
      [cr, cg, cb] = getPointColor(p, t, colorMode, isDark, colors, noise, w, h, cxc, cyc, maxR);

      const depthAlpha = baseAlpha * (1 - t * depthFade);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${depthAlpha.toFixed(3)})`;

      if (shape === 'petal') {
        const outAngle = Math.atan2(p.y - cyc, p.x - cxc);
        const noiseWarp = noise.noise2D(p.i * 0.1 + 7.3, seed * 0.01) * 0.15;
        const petalLen = p.dotR * (1.8 + noiseWarp);
        const petalW = p.dotR * (0.65 + noiseWarp * 0.3);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(outAngle);
        ctx.beginPath();
        ctx.moveTo(petalLen, 0);
        ctx.bezierCurveTo(petalLen * 0.4, -petalW * 1.1, -p.dotR * 0.3, -petalW * 0.5, -p.dotR * 0.4, 0);
        ctx.bezierCurveTo(-p.dotR * 0.3, petalW * 0.5, petalLen * 0.4, petalW * 1.1, petalLen, 0);
        ctx.fill();
        ctx.restore();
      } else if (shape === 'star') {
        const outAngle = Math.atan2(p.y - cyc, p.x - cxc);
        const noiseRot = noise.noise2D(p.i * 0.05, seed * 0.01) * 0.3;
        const rays = 5;
        const outerR = p.dotR;
        const innerR = p.dotR * 0.35;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(outAngle + noiseRot);
        ctx.beginPath();
        for (let v = 0; v < rays * 2; v++) {
          const sa = (v / (rays * 2)) * Math.PI * 2;
          const sr = v % 2 === 0 ? outerR : innerR;
          const sx = Math.cos(sa) * sr, sy = Math.sin(sa) * sr;
          if (v === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (shape === 'square') {
        const outAngle = Math.atan2(p.y - cyc, p.x - cxc);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(outAngle);
        ctx.fillRect(-p.dotR, -p.dotR, p.dotR * 2, p.dotR * 2);
        ctx.restore();
      } else {
        // circle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return ((params.pointCount ?? 1500) * 0.05) | 0;
  },
};

function getPointColor(
  p: { x: number; y: number; r: number; i: number },
  t: number,
  colorMode: string,
  isDark: boolean,
  colors: [number, number, number][],
  noise: SimplexNoise,
  w: number, h: number,
  _cxc: number, _cyc: number,
  _maxR: number,
): [number, number, number] {
  if (colorMode === 'monochrome') {
    return isDark ? [220, 220, 220] : [30, 30, 30];
  } else if (colorMode === 'palette-angle') {
    return colors[p.i % colors.length];
  } else if (colorMode === 'palette-noise') {
    const nv = noise.fbm((p.x / w - 0.5) * 3 + 5, (p.y / h - 0.5) * 3 + 5, 3, 2, 0.5);
    const nt = Math.max(0, nv * 0.5 + 0.5);
    return interpolateColor(colors, nt);
  } else if (colorMode === 'palette-fibonacci') {
    const armIndex = p.i % 13;
    return colors[armIndex % colors.length];
  } else {
    // palette-radius
    return interpolateColor(colors, t);
  }
}

function interpolateColor(colors: [number, number, number][], t: number): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ct), i1 = Math.min(colors.length - 1, i0 + 1);
  const f = ct - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}
