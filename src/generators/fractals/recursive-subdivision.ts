import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';
import { SVGPathBuilder } from '../../renderers/svg/builder';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const s = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

interface Cell {
  x: number; y: number; w: number; h: number;
  depth: number;
  // For triangle mode
  points?: [number, number][];
}

function subdivideQuad(
  cells: Cell[], x: number, y: number, w: number, h: number,
  depth: number, maxDepth: number, jitter: number, rng: SeededRNG
) {
  if (depth >= maxDepth || w < 4 || h < 4) {
    cells.push({ x, y, w, h, depth });
    return;
  }
  // Jittered split positions
  const splitX = w * (0.5 + (rng.random() - 0.5) * jitter);
  const splitY = h * (0.5 + (rng.random() - 0.5) * jitter);
  subdivideQuad(cells, x, y, splitX, splitY, depth + 1, maxDepth, jitter, rng);
  subdivideQuad(cells, x + splitX, y, w - splitX, splitY, depth + 1, maxDepth, jitter, rng);
  subdivideQuad(cells, x, y + splitY, splitX, h - splitY, depth + 1, maxDepth, jitter, rng);
  subdivideQuad(cells, x + splitX, y + splitY, w - splitX, h - splitY, depth + 1, maxDepth, jitter, rng);
}

function subdivideTriangle(
  cells: Cell[], points: [number, number][],
  depth: number, maxDepth: number, jitter: number, rng: SeededRNG
) {
  if (depth >= maxDepth) {
    cells.push({ x: 0, y: 0, w: 0, h: 0, depth, points });
    return;
  }
  const [a, b, c] = points;
  // Midpoints with jitter
  const j = jitter * 0.2;
  const mid = (p1: [number, number], p2: [number, number]): [number, number] => [
    (p1[0] + p2[0]) * 0.5 + (rng.random() - 0.5) * j * Math.abs(p2[0] - p1[0]),
    (p1[1] + p2[1]) * 0.5 + (rng.random() - 0.5) * j * Math.abs(p2[1] - p1[1]),
  ];
  const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
  subdivideTriangle(cells, [a, ab, ca], depth + 1, maxDepth, jitter, rng);
  subdivideTriangle(cells, [ab, b, bc], depth + 1, maxDepth, jitter, rng);
  subdivideTriangle(cells, [ca, bc, c], depth + 1, maxDepth, jitter, rng);
  subdivideTriangle(cells, [ab, bc, ca], depth + 1, maxDepth, jitter, rng);
}

function subdivideIrregular(
  cells: Cell[], x: number, y: number, w: number, h: number,
  depth: number, maxDepth: number, jitter: number, rng: SeededRNG
) {
  if (depth >= maxDepth || w < 4 || h < 4) {
    cells.push({ x, y, w, h, depth });
    return;
  }
  // Randomly split horizontal or vertical
  if (rng.random() < 0.5 || h < 8) {
    const splitX = w * (0.3 + rng.random() * 0.4 * (1 + jitter));
    const clampedSplit = Math.max(4, Math.min(w - 4, splitX));
    subdivideIrregular(cells, x, y, clampedSplit, h, depth + 1, maxDepth, jitter, rng);
    subdivideIrregular(cells, x + clampedSplit, y, w - clampedSplit, h, depth + 1, maxDepth, jitter, rng);
  } else {
    const splitY = h * (0.3 + rng.random() * 0.4 * (1 + jitter));
    const clampedSplit = Math.max(4, Math.min(h - 4, splitY));
    subdivideIrregular(cells, x, y, w, clampedSplit, depth + 1, maxDepth, jitter, rng);
    subdivideIrregular(cells, x, y + clampedSplit, w, h - clampedSplit, depth + 1, maxDepth, jitter, rng);
  }
}

const parameterSchema: ParameterSchema = {
  depth: {
    name: 'Depth', type: 'number', min: 1, max: 10, step: 1, default: 5,
    help: 'Recursion depth — higher = more cells',
    group: 'Composition',
  },
  splitMode: {
    name: 'Split Mode', type: 'select', options: ['quad', 'triangle', 'irregular'], default: 'quad',
    help: 'quad: 4-way rectangle split | triangle: Sierpinski-like | irregular: random axis splits',
    group: 'Composition',
  },
  jitter: {
    name: 'Jitter', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Randomness of split positions (0 = uniform, 1 = maximum variation)',
    group: 'Geometry',
  },
  margin: {
    name: 'Margin', type: 'number', min: 0, max: 10, step: 0.5, default: 2,
    help: 'Gap between cells in pixels',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['depth', 'noise', 'random'], default: 'depth',
    help: 'depth: shade by recursion level | noise: simplex noise | random: per-cell random color',
    group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation speed for depth reveal',
    group: 'Flow/Motion',
  },
};

export const recursiveSubdivision: Generator = {
  id: 'fractal-recursive-subdivision',
  family: 'fractals',
  styleName: 'Recursive Subdivision',
  definition: 'Recursively subdivide space into smaller cells with random perturbation',
  algorithmNotes:
    'Starts with the full canvas as a single cell and recursively subdivides it. In quad mode, each cell ' +
    'splits into 4 rectangles with jittered split positions. In triangle mode, triangles subdivide into 4 ' +
    'sub-triangles (Sierpinski-like). Irregular mode randomly chooses horizontal or vertical splits. ' +
    'Cells are colored by recursion depth, simplex noise value at their center, or randomly from the palette. ' +
    'Animation progressively reveals deeper subdivision levels.',
  parameterSchema,
  defaultParams: { depth: 5, splitMode: 'quad', jitter: 0.3, margin: 2, colorMode: 'depth', speed: 0.5 },
  supportsVector: true, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const colors = palette.colors.map(hexToRgb);
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const maxDepth = params.depth ?? 5;
    const splitMode = params.splitMode ?? 'quad';
    const jitter = params.jitter ?? 0.3;
    const margin = params.margin ?? 2;
    const colorMode = params.colorMode ?? 'depth';
    const speed = params.speed ?? 0.5;

    // Animated depth reveal — cycles from 1 to maxDepth and back
    let visibleDepth: number;
    if (time > 0) {
      const period = maxDepth / (speed * 1.5); // seconds per full cycle
      const phase = (time % period) / period;  // 0→1 within each cycle
      visibleDepth = Math.max(1, Math.min(maxDepth, Math.floor(phase * (maxDepth + 1))));
    } else {
      visibleDepth = maxDepth;
    }

    // Generate cells
    const cells: Cell[] = [];
    if (splitMode === 'triangle') {
      const pad = margin;
      subdivideTriangle(
        cells,
        [[w * 0.5, pad], [w - pad, h - pad], [pad, h - pad]],
        0, visibleDepth, jitter, rng
      );
    } else if (splitMode === 'irregular') {
      subdivideIrregular(cells, 0, 0, w, h, 0, visibleDepth, jitter, rng);
    } else {
      subdivideQuad(cells, 0, 0, w, h, 0, visibleDepth, jitter, rng);
    }

    // Clear
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Draw cells
    for (const cell of cells) {
      let v: number;
      if (colorMode === 'depth') {
        v = cell.depth / maxDepth;
      } else if (colorMode === 'noise') {
        if (cell.points) {
          const cx = (cell.points[0][0] + cell.points[1][0] + cell.points[2][0]) / 3;
          const cy = (cell.points[0][1] + cell.points[1][1] + cell.points[2][1]) / 3;
          v = (noise.noise2D(cx / w * 4, cy / h * 4) + 1) * 0.5;
        } else {
          v = (noise.noise2D((cell.x + cell.w * 0.5) / w * 4, (cell.y + cell.h * 0.5) / h * 4) + 1) * 0.5;
        }
      } else {
        v = rng.random();
      }

      const [r, g, b] = paletteSample(v, colors);
      ctx.fillStyle = `rgb(${r},${g},${b})`;

      if (cell.points) {
        // Triangle
        const m = margin * 0.5;
        const cx = (cell.points[0][0] + cell.points[1][0] + cell.points[2][0]) / 3;
        const cy = (cell.points[0][1] + cell.points[1][1] + cell.points[2][1]) / 3;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const px = cell.points[i][0] + (cx - cell.points[i][0]) * m * 0.02;
          const py = cell.points[i][1] + (cy - cell.points[i][1]) * m * 0.02;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        // Rectangle with margin
        ctx.fillRect(
          cell.x + margin * 0.5,
          cell.y + margin * 0.5,
          Math.max(1, cell.w - margin),
          Math.max(1, cell.h - margin)
        );
      }
    }
  },

  renderVector(params, seed, palette) {
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const builder = new SVGPathBuilder();
    const w = 1080, h = 1080;
    const maxDepth = params.depth ?? 5;
    const splitMode = params.splitMode ?? 'quad';
    const jitter = params.jitter ?? 0.3;
    const margin = params.margin ?? 2;
    const colorMode = params.colorMode ?? 'depth';

    const cells: Cell[] = [];
    if (splitMode === 'triangle') {
      const pad = margin;
      subdivideTriangle(
        cells,
        [[w * 0.5, pad], [w - pad, h - pad], [pad, h - pad]],
        0, maxDepth, jitter, rng
      );
    } else if (splitMode === 'irregular') {
      subdivideIrregular(cells, 0, 0, w, h, 0, maxDepth, jitter, rng);
    } else {
      subdivideQuad(cells, 0, 0, w, h, 0, maxDepth, jitter, rng);
    }

    for (const cell of cells) {
      let v: number;
      if (colorMode === 'depth') {
        v = cell.depth / maxDepth;
      } else if (colorMode === 'noise') {
        if (cell.points) {
          const cx = (cell.points[0][0] + cell.points[1][0] + cell.points[2][0]) / 3;
          const cy = (cell.points[0][1] + cell.points[1][1] + cell.points[2][1]) / 3;
          v = (noise.noise2D(cx / w * 4, cy / h * 4) + 1) * 0.5;
        } else {
          v = (noise.noise2D((cell.x + cell.w * 0.5) / w * 4, (cell.y + cell.h * 0.5) / h * 4) + 1) * 0.5;
        }
      } else {
        v = rng.random();
      }

      const ci = Math.floor(Math.max(0, Math.min(1, v)) * (palette.colors.length - 1));
      const color = palette.colors[ci];

      if (cell.points) {
        const cx = (cell.points[0][0] + cell.points[1][0] + cell.points[2][0]) / 3;
        const cy = (cell.points[0][1] + cell.points[1][1] + cell.points[2][1]) / 3;
        const m = margin * 0.02;
        const pts: [number, number][] = cell.points.map(p => [
          p[0] + (cx - p[0]) * m,
          p[1] + (cy - p[1]) * m,
        ]);
        builder.addPolygon(pts, color, undefined, 0);
      } else {
        builder.rect(
          cell.x + margin * 0.5,
          cell.y + margin * 0.5,
          Math.max(1, cell.w - margin),
          Math.max(1, cell.h - margin)
        ).endPath(undefined, color, 0);
      }
    }

    return builder.getPaths();
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.pow(4, Math.min(params.depth ?? 5, 10)) | 0; },
};
