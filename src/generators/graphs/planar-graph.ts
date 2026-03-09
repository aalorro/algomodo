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
  if (dist === 'concentric') {
    const pts: [number, number][] = [];
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) * 0.45;
    const rings = Math.max(2, Math.ceil(Math.sqrt(count / 6)));
    let placed = 0;
    for (let ring = 0; ring < rings && placed < count; ring++) {
      const r = maxR * (ring + 1) / rings;
      const circumference = 2 * Math.PI * r;
      const ptsOnRing = Math.max(3, Math.round(circumference / (maxR / rings)));
      for (let p = 0; p < ptsOnRing && placed < count; p++) {
        const angle = (p / ptsOnRing) * Math.PI * 2 + ring * 0.3;
        pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
        placed++;
      }
    }
    if (placed < count) pts.push([cx, cy]);
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

// ── Bowyer-Watson Delaunay triangulation ──────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count', type: 'number', min: 10, max: 300, step: 5, default: 80,
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['jittered-grid', 'random', 'poisson-disc', 'concentric'],
    default: 'poisson-disc', group: 'Composition',
  },
  density: {
    name: 'Edge Density', type: 'number', min: 0.2, max: 1, step: 0.1, default: 0.7,
    help: 'Fraction of Delaunay edges to keep — lower values remove longest edges first for a sparser graph',
    group: 'Composition',
  },
  edgeStyle: {
    name: 'Edge Style', type: 'select',
    options: ['straight', 'curved', 'angular'],
    default: 'straight',
    help: 'straight: lines · curved: smooth arcs · angular: right-angle bends',
    group: 'Geometry',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 0, max: 10, step: 0.5, default: 4,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 4, step: 0.5, default: 1.5,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['four-color', 'degree', 'noise', 'depth'],
    default: 'four-color',
    help: 'four-color: greedy graph coloring · degree: by connections · noise: FBM · depth: distance from center',
    group: 'Color',
  },
  fillFaces: {
    name: 'Fill Faces', type: 'boolean', default: true,
    help: 'Fill triangular faces with translucent colors',
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['dark', 'white', 'cream'],
    default: 'dark', group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed', type: 'number', min: 0, max: 1, step: 0.05, default: 0.1,
    help: 'Vertex drift speed (0 = static)', group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0a0a0f' };

export const planarGraph: Generator = {
  id: 'graph-planar',
  family: 'graphs',
  styleName: 'Planar Graph',
  definition: 'Planar graph from Delaunay triangulation — density controls edge thinning by removing longest edges',
  algorithmNotes:
    'Generates N points, computes Delaunay triangulation (guaranteed planar), extracts unique edges, then ' +
    'removes the longest edges to reach the target density. This produces a planar graph efficiently with ' +
    'no crossing checks needed. Supports greedy four-coloring of nodes, face filling, and multiple edge styles.',
  parameterSchema,
  defaultParams: {
    pointCount: 80, distribution: 'poisson-disc', density: 0.7,
    edgeStyle: 'straight', nodeSize: 4, edgeWidth: 1.5,
    colorMode: 'four-color', fillFaces: true, background: 'dark', animSpeed: 0.1,
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
    const density = params.density ?? 0.7;
    const edgeStyle = params.edgeStyle ?? 'straight';
    const nodeSize = params.nodeSize ?? 4;
    const edgeWidth = params.edgeWidth ?? 1.5;
    const colorMode = params.colorMode ?? 'four-color';
    const fillFaces = params.fillFaces ?? true;
    const animSpeed = params.animSpeed ?? 0.1;

    // Generate and animate points
    const basePts = generatePoints(pointCount, params.distribution ?? 'poisson-disc', w, h, rng);
    const avgCell = Math.sqrt(w * h / pointCount);
    const amp = animSpeed > 0 ? avgCell * 0.15 : 0;
    const pts: [number, number][] = basePts.map(([bx, by], i) => {
      if (time <= 0 || amp <= 0) return [bx, by];
      return [
        bx + Math.cos(time * animSpeed + i * 2.399) * amp,
        by + Math.sin(time * animSpeed * 1.3 + i * 3.7) * amp,
      ];
    });

    if (pts.length < 3) return;

    // Compute Delaunay triangulation (always planar)
    const tris = delaunay(pts, w, h);

    // Extract unique edges with distances
    const edgeMap = new Map<string, { i: number; j: number; dist: number }>();
    for (const [a, b, c] of tris) {
      for (const [ei, ej] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const key = ei < ej ? `${ei}-${ej}` : `${ej}-${ei}`;
        if (!edgeMap.has(key)) {
          const dx = pts[ej][0] - pts[ei][0], dy = pts[ej][1] - pts[ei][1];
          edgeMap.set(key, { i: Math.min(ei, ej), j: Math.max(ei, ej), dist: Math.sqrt(dx * dx + dy * dy) });
        }
      }
    }

    // Sort edges by distance and keep only the density fraction (remove longest first)
    let allEdges = Array.from(edgeMap.values());
    allEdges.sort((a, b) => a.dist - b.dist);
    const keepCount = Math.max(pointCount - 1, Math.round(allEdges.length * density));
    const edges = allEdges.slice(0, keepCount);

    // Build adjacency and compute degree
    const degree: number[] = new Array(pointCount).fill(0);
    const adj: Set<number>[] = Array.from({ length: pointCount }, () => new Set());
    const edgeSet = new Set<string>();

    for (const e of edges) {
      degree[e.i]++;
      degree[e.j]++;
      adj[e.i].add(e.j);
      adj[e.j].add(e.i);
      edgeSet.add(`${e.i}-${e.j}`);
      edgeSet.add(`${e.j}-${e.i}`);
    }

    const maxDeg = Math.max(1, ...degree);

    // Greedy graph coloring
    const graphColor: number[] = new Array(pointCount).fill(-1);
    for (let i = 0; i < pointCount; i++) {
      const usedColors = new Set<number>();
      for (const nb of adj[i]) {
        if (graphColor[nb] >= 0) usedColors.add(graphColor[nb]);
      }
      let c = 0;
      while (usedColors.has(c)) c++;
      graphColor[i] = c;
    }
    const maxGraphColor = Math.max(1, ...graphColor);

    // Node colors
    const nodeColors: [number, number, number][] = new Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      if (colorMode === 'four-color') {
        nodeColors[i] = paletteSample(graphColor[i] / Math.max(maxGraphColor, colors.length - 1), colors);
      } else if (colorMode === 'degree') {
        nodeColors[i] = paletteSample(degree[i] / maxDeg, colors);
      } else if (colorMode === 'noise') {
        const nv = noise.fbm(pts[i][0] / w * 3 + 5, pts[i][1] / h * 3 + 5, 3, 2, 0.5);
        nodeColors[i] = paletteSample(nv * 0.5 + 0.5, colors);
      } else {
        const dx = pts[i][0] - w / 2, dy = pts[i][1] - h / 2;
        const rd = Math.sqrt(dx * dx + dy * dy) / (Math.min(w, h) * 0.5);
        nodeColors[i] = paletteSample(Math.min(1, rd), colors);
      }
    }

    // Fill triangular faces
    if (fillFaces) {
      for (const [a, b, c] of tris) {
        // Only fill if all three edges are still present
        const hasAB = edgeSet.has(`${Math.min(a, b)}-${Math.max(a, b)}`);
        const hasBC = edgeSet.has(`${Math.min(b, c)}-${Math.max(b, c)}`);
        const hasCA = edgeSet.has(`${Math.min(c, a)}-${Math.max(c, a)}`);
        if (!hasAB || !hasBC || !hasCA) continue;

        const [cr0, cg0, cb0] = nodeColors[a];
        const [cr1, cg1, cb1] = nodeColors[b];
        const [cr2, cg2, cb2] = nodeColors[c];
        const cr = ((cr0 + cr1 + cr2) / 3) | 0;
        const cg = ((cg0 + cg1 + cg2) / 3) | 0;
        const cb = ((cb0 + cb1 + cb2) / 3) | 0;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.1 : 0.08})`;
        ctx.beginPath();
        ctx.moveTo(pts[a][0], pts[a][1]);
        ctx.lineTo(pts[b][0], pts[b][1]);
        ctx.lineTo(pts[c][0], pts[c][1]);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Draw edges
    ctx.lineCap = 'round';
    ctx.lineWidth = edgeWidth;
    const edgeAlpha = isDark ? 0.45 : 0.35;

    for (const e of edges) {
      const [cr0, cg0, cb0] = nodeColors[e.i];
      const [cr1, cg1, cb1] = nodeColors[e.j];
      const grad = ctx.createLinearGradient(pts[e.i][0], pts[e.i][1], pts[e.j][0], pts[e.j][1]);
      grad.addColorStop(0, `rgba(${cr0},${cg0},${cb0},${edgeAlpha})`);
      grad.addColorStop(1, `rgba(${cr1},${cg1},${cb1},${edgeAlpha})`);
      ctx.strokeStyle = grad;

      if (edgeStyle === 'curved') {
        const mx = (pts[e.i][0] + pts[e.j][0]) / 2;
        const my = (pts[e.i][1] + pts[e.j][1]) / 2;
        const dx = pts[e.j][0] - pts[e.i][0], dy = pts[e.j][1] - pts[e.i][1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const bulge = len * 0.12;
        const cpx = mx + (-dy / len) * bulge;
        const cpy = my + (dx / len) * bulge;
        ctx.beginPath();
        ctx.moveTo(pts[e.i][0], pts[e.i][1]);
        ctx.quadraticCurveTo(cpx, cpy, pts[e.j][0], pts[e.j][1]);
        ctx.stroke();
      } else if (edgeStyle === 'angular') {
        const mx = (pts[e.i][0] + pts[e.j][0]) / 2;
        const my = (pts[e.i][1] + pts[e.j][1]) / 2;
        ctx.beginPath();
        ctx.moveTo(pts[e.i][0], pts[e.i][1]);
        if ((e.i + e.j) % 2 === 0) {
          ctx.lineTo(mx, pts[e.i][1]);
          ctx.lineTo(mx, pts[e.j][1]);
        } else {
          ctx.lineTo(pts[e.i][0], my);
          ctx.lineTo(pts[e.j][0], my);
        }
        ctx.lineTo(pts[e.j][0], pts[e.j][1]);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[e.i][0], pts[e.i][1]);
        ctx.lineTo(pts[e.j][0], pts[e.j][1]);
        ctx.stroke();
      }
    }

    // Draw nodes with glow
    if (nodeSize > 0) {
      for (let i = 0; i < pointCount; i++) {
        const [cr, cg, cb] = nodeColors[i];
        if (isDark) {
          const grad = ctx.createRadialGradient(pts[i][0], pts[i][1], 0, pts[i][0], pts[i][1], nodeSize * 2.5);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.3)`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pts[i][0], pts[i][1], nodeSize * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], nodeSize, 0, Math.PI * 2);
        ctx.fill();
        // Bright center dot
        ctx.fillStyle = `rgba(255,255,255,${isDark ? 0.4 : 0.3})`;
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], nodeSize * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = params.pointCount ?? 80;
    return Math.round(n * n * 0.1 + n * 10);
  },
};
