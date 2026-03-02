import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(
  a: [number, number, number], b: [number, number, number], t: number
): [number, number, number] {
  return [(a[0] + (b[0] - a[0]) * t) | 0, (a[1] + (b[1] - a[1]) * t) | 0, (a[2] + (b[2] - a[2]) * t) | 0];
}

// Bowyer–Watson Delaunay triangulation
type Tri = [number, number, number];

function circumcircle(p: [number, number][], a: number, b: number, c: number): { cx: number; cy: number; r2: number } {
  const ax = p[a][0], ay = p[a][1];
  const bx = p[b][0], by = p[b][1];
  const cx = p[c][0], cy = p[c][1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return { cx: 0, cy: 0, r2: Infinity };
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  const r2 = (ax - ux) ** 2 + (ay - uy) ** 2;
  return { cx: ux, cy: uy, r2 };
}

function delaunay(points: [number, number][], w: number, h: number): Tri[] {
  const n = points.length;
  const all: [number, number][] = [...points];

  const M = Math.max(w, h) * 10;
  all.push([-M, -M], [3 * M, -M], [-M, 3 * M]);
  const s0 = n, s1 = n + 1, s2 = n + 2;

  let triangles: Tri[] = [[s0, s1, s2]];

  for (let i = 0; i < n; i++) {
    const bad: Tri[] = [];
    for (const t of triangles) {
      const { cx, cy, r2 } = circumcircle(all, t[0], t[1], t[2]);
      const dx = all[i][0] - cx, dy = all[i][1] - cy;
      if (dx * dx + dy * dy < r2) bad.push(t);
    }

    const edges: [number, number][] = [];
    for (const t of bad) {
      const triEdges: [number, number][] = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
      for (const e of triEdges) {
        const shared = bad.some(
          t2 => t2 !== t && ((t2[0] === e[0] && t2[1] === e[1]) || (t2[0] === e[1] && t2[1] === e[0]) ||
                             (t2[1] === e[0] && t2[2] === e[1]) || (t2[1] === e[1] && t2[2] === e[0]) ||
                             (t2[2] === e[0] && t2[0] === e[1]) || (t2[2] === e[1] && t2[0] === e[0])),
        );
        if (!shared) edges.push(e);
      }
    }

    triangles = triangles.filter(t => !bad.includes(t));
    for (const [a, b] of edges) triangles.push([a, b, i]);
  }

  return triangles.filter(t => t[0] < n && t[1] < n && t[2] < n);
}

function jitteredGrid(count: number, w: number, h: number, rng: SeededRNG): [number, number][] {
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const pts: [number, number][] = [];
  for (let r = 0; r < rows && pts.length < count; r++) {
    for (let c = 0; c < cols && pts.length < count; c++) {
      pts.push([(c + 0.2 + rng.random() * 0.6) * cw, (r + 0.2 + rng.random() * 0.6) * ch]);
    }
  }
  while (pts.length < count) pts.push([rng.random() * w, rng.random() * h]);
  return pts;
}

function animateSites(base: [number, number][], amp: number, speed: number, time: number): [number, number][] {
  return base.map(([bx, by], i) => {
    const ph = i * 2.39996;
    return [bx + Math.cos(time * speed + ph) * amp, by + Math.sin(time * speed * 1.3 + ph * 1.7) * amp];
  });
}

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count',
    type: 'number', min: 6, max: 300, step: 6, default: 80,
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['by-position', 'by-area', 'palette-cycle', 'gradient-y'],
    default: 'by-position',
    group: 'Color',
  },
  showEdges: {
    name: 'Show Edges',
    type: 'boolean', default: true,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width',
    type: 'number', min: 0.5, max: 4, step: 0.5, default: 1,
    group: 'Geometry',
  },
  edgeOpacity: {
    name: 'Edge Opacity',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.5,
    group: 'Color',
  },
  jitter: {
    name: 'Color Jitter',
    type: 'number', min: 0, max: 0.4, step: 0.02, default: 0.1,
    help: 'Random brightness variation per triangle',
    group: 'Texture',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 2, step: 0.05, default: 0.4,
    group: 'Flow/Motion',
  },
  animAmp: {
    name: 'Anim Amplitude',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.2,
    help: 'Drift distance as a fraction of average cell size',
    group: 'Flow/Motion',
  },
};

export const delaunayMesh: Generator = {
  id: 'delaunay-mesh',
  family: 'voronoi',
  styleName: 'Delaunay Triangulation',
  definition: 'Computes the Delaunay triangulation of seed points and fills each triangle with a palette color',
  algorithmNotes: 'Uses the Bowyer–Watson incremental insertion algorithm. Each triangle is filled based on its centroid position, area, or palette index. Sites use jittered-grid placement for full-canvas coverage; topology is recomputed each frame during animation.',
  parameterSchema,
  defaultParams: {
    pointCount: 80, colorMode: 'by-position', showEdges: true,
    edgeWidth: 1, edgeOpacity: 0.5, jitter: 0.1, animSpeed: 0.4, animAmp: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(6, params.pointCount | 0);
    const colors = palette.colors.map(hexToRgb);

    const basePts = jitteredGrid(count, w, h, rng);
    const avgCellSize = Math.sqrt((w * h) / count);
    const amp = (params.animAmp ?? 0.2) * avgCellSize;
    const pts = time > 0 && amp > 0
      ? animateSites(basePts, amp, params.animSpeed ?? 0.4, time)
      : basePts;

    const tris = delaunay(pts, w, h);

    // Seeded jitter RNG (separate so animation doesn't change colors)
    const jitterRng = new SeededRNG(seed + 1);

    for (let ti = 0; ti < tris.length; ti++) {
      const [ai, bi, ci] = tris[ti];
      const [ax, ay] = pts[ai], [bx, by] = pts[bi], [cx, cy] = pts[ci];
      const centX = (ax + bx + cx) / 3, centY = (ay + by + cy) / 3;

      let base: [number, number, number];
      if (params.colorMode === 'palette-cycle') {
        base = colors[ti % colors.length];
      } else if (params.colorMode === 'gradient-y') {
        const ty = centY / h;
        const ci0 = ty * (colors.length - 1);
        const i0 = Math.floor(ci0), i1 = Math.min(colors.length - 1, i0 + 1);
        base = lerpColor(colors[i0], colors[i1], ci0 - i0);
      } else if (params.colorMode === 'by-area') {
        const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
        const maxArea = (w * h) / count;
        const tv = Math.min(1, area / maxArea);
        const ci0 = tv * (colors.length - 1);
        const i0 = Math.floor(ci0), i1 = Math.min(colors.length - 1, i0 + 1);
        base = lerpColor(colors[i0], colors[i1], ci0 - i0);
      } else {
        const tx = centX / w, ty2 = centY / h;
        const tv = (tx + ty2) / 2;
        const ci0 = tv * (colors.length - 1);
        const i0 = Math.floor(ci0), i1 = Math.min(colors.length - 1, i0 + 1);
        base = lerpColor(colors[i0], colors[i1], ci0 - i0);
      }

      const j = (jitterRng.random() * 2 - 1) * (params.jitter ?? 0);
      const rgb: [number, number, number] = [
        Math.max(0, Math.min(255, base[0] * (1 + j))) | 0,
        Math.max(0, Math.min(255, base[1] * (1 + j))) | 0,
        Math.max(0, Math.min(255, base[2] * (1 + j))) | 0,
      ];

      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy);
      ctx.closePath(); ctx.fill();
    }

    if (params.showEdges) {
      ctx.lineWidth = params.edgeWidth ?? 1;
      ctx.globalAlpha = params.edgeOpacity ?? 0.5;
      ctx.strokeStyle = '#000';
      for (const [ai, bi, ci] of tris) {
        const [ax, ay] = pts[ai], [bx, by] = pts[bi], [cx, cy] = pts[ci];
        ctx.beginPath();
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy);
        ctx.closePath(); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  },

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const c = gl.canvas as HTMLCanvasElement;
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    this.renderCanvas2D!(tmp.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost: (p) => p.pointCount * 10,
};
