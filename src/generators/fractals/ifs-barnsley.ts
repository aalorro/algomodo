import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  if (colors.length === 0) return [128, 128, 128];
  if (colors.length === 1) return colors[0];
  const v = Math.max(0, Math.min(1, t));
  if (isNaN(v)) return colors[0];
  const s = v * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

// Affine transform: [a, b, c, d, e, f, probability]
// x' = a*x + b*y + e,  y' = c*x + d*y + f
type AffineTransform = [number, number, number, number, number, number, number];

const PRESETS: Record<string, AffineTransform[]> = {
  barnsley: [
    [0, 0, 0, 0.16, 0, 0, 0.01],
    [0.85, 0.04, -0.04, 0.85, 0, 1.6, 0.85],
    [0.2, -0.26, 0.23, 0.22, 0, 1.6, 0.07],
    [-0.15, 0.28, 0.26, 0.24, 0, 0.44, 0.07],
  ],
  sierpinski: [
    [0.5, 0, 0, 0.5, 0, 0, 0.333],
    [0.5, 0, 0, 0.5, 0.5, 0, 0.333],
    [0.5, 0, 0, 0.5, 0.25, 0.433, 0.334],
  ],
  maple: [
    [0.14, 0.01, 0, 0.51, -0.08, -1.31, 0.10],
    [0.43, 0.52, -0.45, 0.50, 1.49, -0.75, 0.35],
    [0.45, -0.49, 0.47, 0.47, -1.62, -0.74, 0.35],
    [0.49, 0, 0, 0.51, 0.02, 1.62, 0.20],
  ],
  dragon: [
    [0.824074, 0.281482, -0.212346, 0.864198, -1.882290, -0.110607, 0.787473],
    [0.088272, 0.520988, -0.463889, -0.377778, 0.785360, 8.095795, 0.212527],
  ],
  tree: [
    [0, 0, 0, 0.5, 0, 0, 0.05],
    [0.42, -0.42, 0.42, 0.42, 0, 0.2, 0.40],
    [0.42, 0.42, -0.42, 0.42, 0, 0.2, 0.40],
    [0.1, 0, 0, 0.1, 0, 0.2, 0.15],
  ],
  spiral: [
    [0.7879, -0.4242, 0.2424, 0.8590, 1.7580, 1.4080, 0.90],
    [-0.1212, 0.2576, 0.1515, 0.0530, -6.7214, 1.3772, 0.10],
  ],
  crystal: [
    [0.382, 0, 0, 0.382, 0.3072, 0.6190, 0.25],
    [0.382, 0, 0, 0.382, 0.6033, 0.4044, 0.25],
    [0.382, 0, 0, 0.382, 0.0139, 0.4044, 0.25],
    [0.382, 0, 0, 0.382, 0.1253, 0.0595, 0.25],
  ],
  koch: [
    [0.333, 0, 0, 0.333, 0, 0, 0.25],
    [0.167, -0.289, 0.289, 0.167, 0.333, 0, 0.25],
    [0.167, 0.289, -0.289, 0.167, 0.5, 0.289, 0.25],
    [0.333, 0, 0, 0.333, 0.667, 0, 0.25],
  ],
};

function generateRandomIFS(rng: SeededRNG): AffineTransform[] {
  const templates = [
    // Spiral type
    () => {
      const transforms: AffineTransform[] = [];
      const n = rng.integer(2, 3);
      let totalP = 0;
      for (let i = 0; i < n; i++) {
        const s = rng.range(0.6, 0.9);
        const angle = rng.range(0.3, 2.0) * (rng.random() > 0.5 ? 1 : -1);
        const cos = Math.cos(angle) * s;
        const sin = Math.sin(angle) * s;
        const p = rng.range(0.3, 1.0);
        transforms.push([cos, -sin, sin, cos, rng.range(-2, 2), rng.range(-1, 3), p]);
        totalP += p;
      }
      for (const t of transforms) t[6] /= totalP;
      return transforms;
    },
    // Symmetric type
    () => {
      const s = rng.range(0.4, 0.7);
      const angle = rng.range(0.2, 1.5);
      const cos = Math.cos(angle) * s;
      const sin = Math.sin(angle) * s;
      const tx = rng.range(0, 2);
      const ty = rng.range(0, 2);
      return [
        [cos, -sin, sin, cos, tx, ty, 0.5] as AffineTransform,
        [cos, sin, -sin, cos, -tx, ty, 0.5] as AffineTransform,
      ];
    },
    // Fern-like
    () => {
      const transforms: AffineTransform[] = [];
      transforms.push([0, 0, 0, rng.range(0.1, 0.25), 0, 0, 0.02]);
      const s = rng.range(0.75, 0.9);
      const skew = rng.range(0.01, 0.08);
      transforms.push([s, skew, -skew, s, 0, rng.range(1, 2.5), 0.80]);
      for (let i = 0; i < 2; i++) {
        const sign = i === 0 ? 1 : -1;
        const a = rng.range(0.15, 0.35);
        transforms.push([a, sign * rng.range(-0.4, -0.15), sign * rng.range(0.15, 0.4), a, 0, rng.range(0.5, 2), 0.09]);
      }
      let totalP = 0;
      for (const t of transforms) totalP += t[6];
      for (const t of transforms) t[6] /= totalP;
      return transforms;
    },
    // Tiling type
    () => {
      const n = rng.integer(3, 5);
      const s = 1.0 / Math.sqrt(n);
      const transforms: AffineTransform[] = [];
      for (let i = 0; i < n; i++) {
        const angle = rng.range(-0.5, 0.5);
        const cos = Math.cos(angle) * s;
        const sin = Math.sin(angle) * s;
        transforms.push([cos, -sin, sin, cos, rng.range(-1.5, 1.5), rng.range(-0.5, 2.5), 1 / n]);
      }
      return transforms;
    },
  ];
  return templates[rng.integer(0, templates.length - 1)]();
}

const parameterSchema: ParameterSchema = {
  preset: {
    name: 'Preset', type: 'select',
    options: ['barnsley', 'sierpinski', 'maple', 'dragon', 'tree', 'spiral', 'crystal', 'koch', 'random'],
    default: 'barnsley',
    help: 'Classic IFS fractals or seed-based random systems',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations', type: 'number', min: 50000, max: 500000, step: 50000, default: 300000,
    help: 'More iterations = denser, more detailed image',
    group: 'Composition',
  },
  pointSize: {
    name: 'Point Size', type: 'number', min: 1, max: 4, step: 1, default: 2,
    help: 'Size of each plotted point in pixels',
    group: 'Geometry',
  },
  rotation: {
    name: 'Rotation', type: 'number', min: 0, max: 360, step: 5, default: 0,
    help: 'Rotate the entire fractal',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['flame', 'height', 'density'], default: 'flame',
    help: 'flame: color by transform blending | height: by y-position | density: by point density',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation rotation speed',
    group: 'Flow/Motion',
  },
};

export const ifsBarnsley: Generator = {
  id: 'fractal-ifs-barnsley',
  family: 'fractals',
  styleName: 'IFS / Barnsley Fern',
  definition: 'Iterated Function Systems — chaos game with affine transforms producing ferns, dragons, spirals, and more',
  algorithmNotes:
    'Implements the chaos game algorithm. Points are colored using fractal flame-style transform blending, ' +
    'y-position gradient, or log-density histogram mapping. Presets include Barnsley fern, Sierpinski triangle, ' +
    'dragon curve, tree, spiral, crystal, and Koch curve.',
  parameterSchema,
  defaultParams: { preset: 'barnsley', iterations: 300000, pointSize: 2, rotation: 0, colorMode: 'flame', speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;
    const colors = palette.colors.map(hexToRgb);
    if (colors.length === 0) return;
    const rng = new SeededRNG(seed);
    const preset = params.preset ?? 'barnsley';
    const colorMode = params.colorMode ?? 'flame';
    const speed = params.speed ?? 0.5;
    const baseRotation = ((params.rotation ?? 0) * Math.PI) / 180;
    const rotation = time > 0 ? baseRotation + time * speed * 0.3 : baseRotation;
    const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
    const ptSize = Math.max(1, (params.pointSize ?? 2) | 0);

    const iterCount = quality === 'draft' ? Math.max(20000, (params.iterations ?? 300000) >> 2)
                    : quality === 'ultra' ? (params.iterations ?? 300000) * 2
                    : (params.iterations ?? 300000);

    const transforms = preset === 'random'
      ? generateRandomIFS(rng)
      : PRESETS[preset] ?? PRESETS.barnsley;

    // Build cumulative probability array
    const cumP: number[] = [];
    let sum = 0;
    for (const t of transforms) { sum += t[6]; cumP.push(sum); }

    // Run chaos game
    let x = 0, y = 0;
    const warmup = 100;
    const pointCount = iterCount - warmup;
    const pointsX = new Float32Array(pointCount);
    const pointsY = new Float32Array(pointCount);
    const pointColor = new Float32Array(pointCount); // 0-1 color value per point

    // Flame-style running color
    let flameColor = 0.5;

    for (let i = 0; i < iterCount; i++) {
      const r = rng.random();
      let ti = 0;
      for (; ti < cumP.length - 1; ti++) {
        if (r < cumP[ti]) break;
      }
      const t = transforms[ti];
      const nx = t[0] * x + t[1] * y + t[4];
      const ny = t[2] * x + t[3] * y + t[5];
      x = nx; y = ny;

      // Flame-style color: blend running color with transform index
      const tc = transforms.length > 1 ? ti / (transforms.length - 1) : 0.5;
      flameColor = (flameColor + tc) * 0.5;

      if (i >= warmup) {
        const idx = i - warmup;
        pointsX[idx] = x * cosR - y * sinR;
        pointsY[idx] = x * sinR + y * cosR;
        pointColor[idx] = flameColor;
      }
    }

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pointCount; i++) {
      const px = pointsX[i], py = pointsY[i];
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // Compute mapping
    const margin = 0.05;
    const scaleX = (1 - 2 * margin) * w / rangeX;
    const scaleY = (1 - 2 * margin) * h / rangeY;
    const sc = Math.min(scaleX, scaleY);
    const offX = (w - rangeX * sc) * 0.5;
    const offY = (h - rangeY * sc) * 0.5;

    // Create image with black background
    const img = ctx.createImageData(w, h);
    const d = img.data;
    // Set all alpha to 255 (opaque black background)
    for (let i = 3; i < d.length; i += 4) d[i] = 255;

    if (colorMode === 'density') {
      // Density histogram mode: accumulate hits, then log-normalize to palette
      const density = new Float32Array(w * h);
      let maxDensity = 0;
      for (let i = 0; i < pointCount; i++) {
        const px = ((pointsX[i] - minX) * sc + offX) | 0;
        const py = (h - 1 - ((pointsY[i] - minY) * sc + offY)) | 0;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          const di = py * w + px;
          density[di]++;
          if (density[di] > maxDensity) maxDensity = density[di];
        }
      }
      if (maxDensity > 0) {
        const logMax = Math.log(maxDensity + 1);
        for (let i = 0; i < w * h; i++) {
          if (density[i] > 0) {
            const v = Math.pow(Math.log(density[i] + 1) / logMax, 0.4);
            const [cr, cg, cb] = paletteSample(v, colors);
            const idx = i * 4;
            d[idx] = cr; d[idx + 1] = cg; d[idx + 2] = cb;
          }
        }
      }
    } else {
      // Flame or height mode: stamp points with color
      for (let i = 0; i < pointCount; i++) {
        const px = ((pointsX[i] - minX) * sc + offX) | 0;
        const py = (h - 1 - ((pointsY[i] - minY) * sc + offY)) | 0;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          let v: number;
          if (colorMode === 'flame') {
            v = pointColor[i];
          } else {
            v = (pointsY[i] - minY) / rangeY;
          }
          const [cr, cg, cb] = paletteSample(v, colors);
          // Stamp ptSize×ptSize block
          for (let dy = 0; dy < ptSize && py + dy < h; dy++) {
            for (let dx = 0; dx < ptSize && px + dx < w; dx++) {
              const idx = ((py + dy) * w + (px + dx)) * 4;
              d[idx] = cr; d[idx + 1] = cg; d[idx + 2] = cb;
            }
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.iterations ?? 300000) / 1000) | 0; },
};
