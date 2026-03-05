import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
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
};

function generateRandomIFS(rng: SeededRNG): AffineTransform[] {
  const count = rng.integer(3, 5);
  const transforms: AffineTransform[] = [];
  let totalP = 0;
  for (let i = 0; i < count; i++) {
    const s = rng.range(0.1, 0.5);
    const angle = rng.randomAngle();
    const cos = Math.cos(angle) * s;
    const sin = Math.sin(angle) * s;
    const skew = rng.range(-0.2, 0.2);
    transforms.push([cos + skew, -sin, sin, cos - skew, rng.range(-1, 1), rng.range(-0.5, 2), 0]);
    const p = rng.range(0.1, 1.0);
    totalP += p;
    transforms[i][6] = p;
  }
  for (const t of transforms) t[6] /= totalP;
  return transforms;
}

const parameterSchema: ParameterSchema = {
  preset: {
    name: 'Preset', type: 'select', options: ['barnsley', 'sierpinski', 'maple', 'random'], default: 'barnsley',
    help: 'barnsley: classic fern | sierpinski: triangle | maple: leaf | random: seed-based IFS',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations', type: 'number', min: 50000, max: 500000, step: 50000, default: 200000,
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
    name: 'Color Mode', type: 'select', options: ['height', 'iteration', 'density'], default: 'height',
    help: 'height: color by y-position | iteration: color by step | density: color by point density',
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
  definition: 'Iterated Function Systems — chaos game with affine transforms producing ferns, triangles, and more',
  algorithmNotes:
    'Implements the chaos game algorithm: start at an arbitrary point, repeatedly choose a random affine ' +
    'transform (weighted by probability) and apply it. After a warmup period, plot each resulting point. ' +
    'Presets include the classic Barnsley fern, Sierpinski triangle, maple leaf, and a random IFS from seed.',
  parameterSchema,
  defaultParams: { preset: 'barnsley', iterations: 200000, pointSize: 2, rotation: 0, colorMode: 'height', speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    if (w === 0 || h === 0) return;
    const colors = palette.colors.map(hexToRgb);
    const rng = new SeededRNG(seed);
    const preset = params.preset ?? 'barnsley';
    const colorMode = params.colorMode ?? 'height';
    const speed = params.speed ?? 0.5;
    const baseRotation = ((params.rotation ?? 0) * Math.PI) / 180;
    const rotation = time > 0 ? baseRotation + time * speed * 0.3 : baseRotation;
    const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
    const ptSize = Math.max(1, (params.pointSize ?? 2) | 0);

    const iterCount = quality === 'draft' ? Math.max(10000, (params.iterations ?? 200000) >> 2)
                    : quality === 'ultra' ? (params.iterations ?? 200000) * 2
                    : (params.iterations ?? 200000);

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

      if (i >= warmup) {
        const idx = i - warmup;
        pointsX[idx] = x * cosR - y * sinR;
        pointsY[idx] = x * sinR + y * cosR;
      }
    }

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pointCount; i++) {
      if (pointsX[i] < minX) minX = pointsX[i];
      if (pointsX[i] > maxX) maxX = pointsX[i];
      if (pointsY[i] < minY) minY = pointsY[i];
      if (pointsY[i] > maxY) maxY = pointsY[i];
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

    // Render using ImageData (fast) — fill background, then stamp points
    const img = ctx.createImageData(w, h);
    const d = img.data;

    // Fill background with first palette color
    const bg = colors[0];
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      d[idx] = bg[0]; d[idx + 1] = bg[1]; d[idx + 2] = bg[2]; d[idx + 3] = 255;
    }

    if (colorMode === 'density') {
      // Accumulate density histogram
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
      const logMax = Math.log(maxDensity + 1);
      for (let i = 0; i < w * h; i++) {
        if (density[i] > 0) {
          const v = Math.log(density[i] + 1) / logMax;
          const [r, g, b] = paletteSample(v, colors);
          const idx = i * 4;
          d[idx] = r; d[idx + 1] = g; d[idx + 2] = b;
        }
      }
    } else {
      // Plot points into ImageData with ptSize×ptSize blocks
      for (let i = 0; i < pointCount; i++) {
        const px = ((pointsX[i] - minX) * sc + offX) | 0;
        const py = (h - 1 - ((pointsY[i] - minY) * sc + offY)) | 0;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          let v: number;
          if (colorMode === 'height') {
            v = (pointsY[i] - minY) / rangeY;
          } else {
            v = i / pointCount;
          }
          const [r, g, b] = paletteSample(v, colors);
          // Stamp a ptSize×ptSize block
          for (let dy = 0; dy < ptSize && py + dy < h; dy++) {
            for (let dx = 0; dx < ptSize && px + dx < w; dx++) {
              const idx = ((py + dy) * w + (px + dx)) * 4;
              d[idx] = r; d[idx + 1] = g; d[idx + 2] = b;
            }
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.iterations ?? 200000) / 1000) | 0; },
};
