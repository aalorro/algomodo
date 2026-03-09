import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  const s = v * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

function generatePoints(
  count: number, dist: string, w: number, h: number, rng: SeededRNG,
): [number, number][] {
  if (dist === 'random') {
    const pts: [number, number][] = [];
    for (let i = 0; i < count; i++) pts.push([rng.random() * w, rng.random() * h]);
    return pts;
  }
  if (dist === 'poisson-disc') {
    const minDist = Math.sqrt(w * h / count) * 0.7;
    const pts: [number, number][] = [];
    for (let attempt = 0; attempt < count * 30 && pts.length < count; attempt++) {
      const x = rng.random() * w, y = rng.random() * h;
      let ok = true;
      for (const p of pts) {
        if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < minDist * minDist) { ok = false; break; }
      }
      if (ok) pts.push([x, y]);
    }
    while (pts.length < count) pts.push([rng.random() * w, rng.random() * h]);
    return pts;
  }
  // jittered-grid
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const pts: [number, number][] = [];
  for (let r = 0; r < rows && pts.length < count; r++) {
    for (let c = 0; c < cols && pts.length < count; c++) {
      pts.push([(c + 0.2 + rng.random() * 0.6) * cw, (r + 0.2 + rng.random() * 0.6) * ch]);
    }
  }
  return pts;
}

type Tri = [number, number, number];

function circumcircle(p: [number, number][], a: number, b: number, c: number) {
  const ax = p[a][0], ay = p[a][1], bx = p[b][0], by = p[b][1], cx = p[c][0], cy = p[c][1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return { cx: 0, cy: 0, r2: Infinity };
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  return { cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
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
      const cc = circumcircle(all, t[0], t[1], t[2]);
      const dx = all[i][0] - cc.cx, dy = all[i][1] - cc.cy;
      if (dx * dx + dy * dy < cc.r2) bad.push(t);
    }
    const edgesArr: [number, number][] = [];
    for (const t of bad) {
      const triEdges: [number, number][] = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
      for (const e of triEdges) {
        const shared = bad.some(
          (t2: Tri) => t2 !== t && ((t2[0] === e[0] && t2[1] === e[1]) || (t2[0] === e[1] && t2[1] === e[0]) ||
                           (t2[1] === e[0] && t2[2] === e[1]) || (t2[1] === e[1] && t2[2] === e[0]) ||
                           (t2[2] === e[0] && t2[0] === e[1]) || (t2[2] === e[1] && t2[0] === e[0])),
        );
        if (!shared) edgesArr.push(e);
      }
    }
    triangles = triangles.filter((t: Tri) => !bad.includes(t));
    for (const [a, b] of edgesArr) triangles.push([a, b, i]);
  }
  return triangles.filter((t: Tri) => t[0] < n && t[1] < n && t[2] < n);
}

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count', type: 'number', min: 20, max: 300, step: 10, default: 80,
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['jittered-grid', 'random', 'poisson-disc'],
    default: 'poisson-disc', group: 'Composition',
  },
  constraintShape: {
    name: 'Constraint Shape', type: 'select',
    options: ['circle', 'cross', 'diamond', 'spiral'],
    default: 'circle',
    help: 'Shape of the forced constraint edges that partition the triangulation',
    group: 'Composition',
  },
  constraintCount: {
    name: 'Constraint Segments', type: 'number', min: 3, max: 20, step: 1, default: 8,
    help: 'Number of constraint segments in the shape',
    group: 'Composition',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 0, max: 6, step: 0.5, default: 2.5,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 3, step: 0.5, default: 1,
    group: 'Geometry',
  },
  constraintWidth: {
    name: 'Constraint Width', type: 'number', min: 1, max: 6, step: 0.5, default: 3,
    help: 'Thickness of constraint edges',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['zone', 'degree', 'noise', 'radial'],
    default: 'zone',
    help: 'zone: color by region (inside/outside constraint) · degree: connections · noise: FBM',
    group: 'Color',
  },
  fillFaces: {
    name: 'Fill Faces', type: 'boolean', default: true,
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['dark', 'white', 'cream'],
    default: 'dark', group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed', type: 'number', min: 0, max: 1, step: 0.05, default: 0.1,
    group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0a0a0f' };

function generateConstraintPoints(
  shape: string, count: number, w: number, h: number, time: number,
): [number, number][] {
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.3;
  const pts: [number, number][] = [];

  if (shape === 'cross') {
    const arm = r * 0.9;
    const thickness = r * 0.25;
    // Horizontal bar
    const hSegs = Math.ceil(count / 4);
    for (let i = 0; i <= hSegs; i++) {
      const t = i / hSegs;
      pts.push([cx - arm + t * arm * 2, cy - thickness]);
      pts.push([cx - arm + t * arm * 2, cy + thickness]);
    }
    // Vertical bar
    const vSegs = Math.ceil(count / 4);
    for (let i = 0; i <= vSegs; i++) {
      const t = i / vSegs;
      pts.push([cx - thickness, cy - arm + t * arm * 2]);
      pts.push([cx + thickness, cy - arm + t * arm * 2]);
    }
  } else if (shape === 'diamond') {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      // Diamond: use L1 norm shape
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const scale = r / (Math.abs(cos) + Math.abs(sin));
      pts.push([cx + cos * scale, cy + sin * scale]);
    }
  } else if (shape === 'spiral') {
    const turns = 2.5;
    for (let i = 0; i < count * 2; i++) {
      const t = i / (count * 2);
      const angle = t * turns * Math.PI * 2 + time * 0.2;
      const sr = r * 0.15 + r * 0.85 * t;
      pts.push([cx + Math.cos(angle) * sr, cy + Math.sin(angle) * sr]);
    }
  } else {
    // circle
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + time * 0.15;
      pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
  }
  return pts;
}

export const constrained: Generator = {
  id: 'graph-constrained',
  family: 'graphs',
  styleName: 'Constrained',
  definition: 'Constrained Delaunay triangulation — forced constraint edges partition the triangulation into zones',
  algorithmNotes:
    'Generates random points plus constraint shape points, computes Delaunay triangulation on the combined set, ' +
    'then highlights the constraint edges (forced paths) which create visually distinct partitioned regions. ' +
    'The constraint shape (circle, cross, diamond, spiral) is overlaid as thick colored edges.',
  parameterSchema,
  defaultParams: {
    pointCount: 80, distribution: 'poisson-disc', constraintShape: 'circle',
    constraintCount: 8, nodeSize: 2.5, edgeWidth: 1, constraintWidth: 3,
    colorMode: 'zone', fillFaces: true, background: 'dark', animSpeed: 0.1,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const bg = params.background ?? 'dark';
    const isDark = bg === 'dark';
    ctx.fillStyle = BG[bg] ?? BG.dark;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const colors = palette.colors.map(hexToRgb);

    const pointCount = params.pointCount ?? 80;
    const constraintShape = params.constraintShape ?? 'circle';
    const constraintCount = params.constraintCount ?? 8;
    const nodeSize = params.nodeSize ?? 2.5;
    const edgeWidth = params.edgeWidth ?? 1;
    const constraintWidth = params.constraintWidth ?? 3;
    const colorMode = params.colorMode ?? 'zone';
    const fillFaces = params.fillFaces ?? true;
    const animSpeed = params.animSpeed ?? 0.1;

    // Generate random points
    const basePts = generatePoints(pointCount, params.distribution ?? 'poisson-disc', w, h, rng);
    const avgCell = Math.sqrt(w * h / pointCount);
    const amp = animSpeed > 0 ? avgCell * 0.12 : 0;
    const randomPts: [number, number][] = basePts.map(([bx, by], i) => {
      if (time <= 0 || amp <= 0) return [bx, by];
      return [
        bx + Math.cos(time * animSpeed + i * 2.399) * amp,
        by + Math.sin(time * animSpeed * 1.3 + i * 3.7) * amp,
      ];
    });

    // Generate constraint shape points
    const constraintPts = generateConstraintPoints(constraintShape, constraintCount, w, h, time * animSpeed);
    const constraintStart = randomPts.length;

    // Combine all points
    const allPts: [number, number][] = [...randomPts, ...constraintPts];
    if (allPts.length < 3) return;

    // Delaunay triangulation on combined point set
    const tris = delaunay(allPts, w, h);

    // Extract unique edges
    const edgeMap = new Map<string, { i: number; j: number; dist: number }>();
    for (const [a, b, c] of tris) {
      for (const [ei, ej] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const key = ei < ej ? `${ei}-${ej}` : `${ej}-${ei}`;
        if (!edgeMap.has(key)) {
          const dx = allPts[ej][0] - allPts[ei][0], dy = allPts[ej][1] - allPts[ei][1];
          edgeMap.set(key, { i: Math.min(ei, ej), j: Math.max(ei, ej), dist: Math.sqrt(dx * dx + dy * dy) });
        }
      }
    }

    // Identify constraint edges (both endpoints are constraint points)
    const constraintEdgeKeys = new Set<string>();
    for (const [key, e] of edgeMap) {
      if (e.i >= constraintStart && e.j >= constraintStart) {
        constraintEdgeKeys.add(key);
      }
    }

    // Build adjacency and degree
    const n = allPts.length;
    const degree: number[] = new Array(n).fill(0);
    const adj: Set<number>[] = Array.from({ length: n }, () => new Set());
    for (const e of edgeMap.values()) {
      degree[e.i]++;
      degree[e.j]++;
      adj[e.i].add(e.j);
      adj[e.j].add(e.i);
    }
    const maxDeg = Math.max(1, ...degree);

    // Determine zone: is point inside or outside constraint shape?
    const cxc = w / 2, cyc = h / 2;
    const cRadius = Math.min(w, h) * 0.3;

    function isInside(pt: [number, number]): boolean {
      const dx = pt[0] - cxc, dy = pt[1] - cyc;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < cRadius;
    }

    // Node colors
    const nodeColors: [number, number, number][] = new Array(n);
    for (let i = 0; i < n; i++) {
      if (colorMode === 'zone') {
        const inside = isInside(allPts[i]);
        const t = inside ? 0.2 : 0.8;
        nodeColors[i] = paletteSample(t, colors);
      } else if (colorMode === 'degree') {
        nodeColors[i] = paletteSample(degree[i] / maxDeg, colors);
      } else if (colorMode === 'noise') {
        const nv = noise.fbm(allPts[i][0] / w * 3 + 5, allPts[i][1] / h * 3 + 5, 3, 2, 0.5);
        nodeColors[i] = paletteSample(nv * 0.5 + 0.5, colors);
      } else {
        const dx = allPts[i][0] - cxc, dy = allPts[i][1] - cyc;
        const rd = Math.sqrt(dx * dx + dy * dy) / (Math.min(w, h) * 0.5);
        nodeColors[i] = paletteSample(Math.min(1, rd), colors);
      }
    }

    // Fill triangular faces
    if (fillFaces) {
      for (const [a, b, c] of tris) {
        const [cr0, cg0, cb0] = nodeColors[a];
        const [cr1, cg1, cb1] = nodeColors[b];
        const [cr2, cg2, cb2] = nodeColors[c];
        const cr = ((cr0 + cr1 + cr2) / 3) | 0;
        const cg = ((cg0 + cg1 + cg2) / 3) | 0;
        const cb = ((cb0 + cb1 + cb2) / 3) | 0;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.08 : 0.06})`;
        ctx.beginPath();
        ctx.moveTo(allPts[a][0], allPts[a][1]);
        ctx.lineTo(allPts[b][0], allPts[b][1]);
        ctx.lineTo(allPts[c][0], allPts[c][1]);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw regular edges
    ctx.lineCap = 'round';
    ctx.lineWidth = edgeWidth;
    const edgeAlpha = isDark ? 0.35 : 0.25;
    for (const [key, e] of edgeMap) {
      if (constraintEdgeKeys.has(key)) continue;
      const [cr0, cg0, cb0] = nodeColors[e.i];
      const [cr1, cg1, cb1] = nodeColors[e.j];
      const grad = ctx.createLinearGradient(allPts[e.i][0], allPts[e.i][1], allPts[e.j][0], allPts[e.j][1]);
      grad.addColorStop(0, `rgba(${cr0},${cg0},${cb0},${edgeAlpha})`);
      grad.addColorStop(1, `rgba(${cr1},${cg1},${cb1},${edgeAlpha})`);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(allPts[e.i][0], allPts[e.i][1]);
      ctx.lineTo(allPts[e.j][0], allPts[e.j][1]);
      ctx.stroke();
    }

    // Draw constraint edges (thick, bright)
    ctx.lineWidth = constraintWidth;
    ctx.lineCap = 'round';
    for (const key of constraintEdgeKeys) {
      const e = edgeMap.get(key)!;
      const ci = (e.i - constraintStart) / Math.max(1, constraintPts.length - 1);
      const cj = (e.j - constraintStart) / Math.max(1, constraintPts.length - 1);
      const [cr0, cg0, cb0] = paletteSample(ci, colors);
      const [cr1, cg1, cb1] = paletteSample(cj, colors);
      const cAlpha = isDark ? 0.85 : 0.75;

      // Glow behind constraint edge
      if (isDark) {
        ctx.save();
        ctx.shadowColor = `rgba(${cr0},${cg0},${cb0},0.5)`;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(${cr0},${cg0},${cb0},${cAlpha * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(allPts[e.i][0], allPts[e.i][1]);
        ctx.lineTo(allPts[e.j][0], allPts[e.j][1]);
        ctx.stroke();
        ctx.restore();
      }

      const grad = ctx.createLinearGradient(allPts[e.i][0], allPts[e.i][1], allPts[e.j][0], allPts[e.j][1]);
      grad.addColorStop(0, `rgba(${cr0},${cg0},${cb0},${cAlpha})`);
      grad.addColorStop(1, `rgba(${cr1},${cg1},${cb1},${cAlpha})`);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(allPts[e.i][0], allPts[e.i][1]);
      ctx.lineTo(allPts[e.j][0], allPts[e.j][1]);
      ctx.stroke();
    }

    // Draw nodes
    if (nodeSize > 0) {
      for (let i = 0; i < n; i++) {
        const [cr, cg, cb] = nodeColors[i];
        const isConstraint = i >= constraintStart;
        const ns = isConstraint ? nodeSize * 1.4 : nodeSize;

        if (isDark) {
          const grad = ctx.createRadialGradient(allPts[i][0], allPts[i][1], 0, allPts[i][0], allPts[i][1], ns * 2);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},${isConstraint ? 0.4 : 0.2})`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(allPts[i][0], allPts[i][1], ns * 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.arc(allPts[i][0], allPts[i][1], ns, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = (params.pointCount ?? 80) + (params.constraintCount ?? 8) * 4;
    return Math.round(n * n * 0.1);
  },
};
