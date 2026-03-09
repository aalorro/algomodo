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

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count', type: 'number', min: 8, max: 80, step: 2, default: 24,
    help: 'Keep low for visible Euler trails',
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['jittered-grid', 'random', 'poisson-disc'],
    default: 'poisson-disc', group: 'Composition',
  },
  trailStyle: {
    name: 'Trail Style', type: 'select',
    options: ['smooth', 'angular', 'dashed'],
    default: 'smooth',
    help: 'smooth: bezier curves · angular: straight segments · dashed: dotted path',
    group: 'Geometry',
  },
  trailWidth: {
    name: 'Trail Width', type: 'number', min: 1, max: 8, step: 0.5, default: 2.5,
    group: 'Geometry',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 0, max: 8, step: 0.5, default: 4,
    group: 'Geometry',
  },
  showGraph: {
    name: 'Show Graph', type: 'boolean', default: true,
    help: 'Show the underlying graph edges behind the Euler trail',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['trail-progress', 'rainbow', 'palette-segments', 'monochrome'],
    default: 'trail-progress',
    help: 'trail-progress: gradient along path · rainbow: hue sweep · palette-segments: each edge a palette color',
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['dark', 'white', 'cream'],
    default: 'dark', group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2,
    help: 'Trail drawing animation speed (0 = show full trail)', group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0a0a0f' };

// Hierholzer's algorithm: find an Euler circuit/trail
function findEulerTrail(
  n: number, adj: Map<number, number[]>,
): number[] {
  // Find a start vertex: prefer odd-degree vertex, else any with edges
  let start = -1;
  for (let i = 0; i < n; i++) {
    const edges = adj.get(i);
    if (!edges || edges.length === 0) continue;
    if (edges.length % 2 === 1) { start = i; break; }
    if (start === -1) start = i;
  }
  if (start === -1) return [];

  // Hierholzer's
  const stack: number[] = [start];
  const trail: number[] = [];
  const localAdj = new Map<number, number[]>();
  for (const [k, v] of adj) localAdj.set(k, [...v]);

  while (stack.length > 0) {
    const v = stack[stack.length - 1];
    const edges = localAdj.get(v);
    if (edges && edges.length > 0) {
      const u = edges.pop()!;
      // Remove the reverse edge
      const uEdges = localAdj.get(u);
      if (uEdges) {
        const idx = uEdges.indexOf(v);
        if (idx !== -1) uEdges.splice(idx, 1);
      }
      stack.push(u);
    } else {
      trail.push(stack.pop()!);
    }
  }

  return trail;
}

export const eulerTrails: Generator = {
  id: 'graph-euler-trails',
  family: 'graphs',
  styleName: 'Euler Trails',
  definition: 'Euler trail on a graph — a path that visits every edge exactly once, drawn as a continuous flowing line',
  algorithmNotes:
    'Generates a Delaunay triangulation, ensures all vertices have even degree by removing edges from odd-degree ' +
    'vertices (guaranteeing an Euler circuit exists), then finds the circuit via Hierholzer\'s algorithm. The trail ' +
    'is rendered as a continuous colored path with animated progressive reveal.',
  parameterSchema,
  defaultParams: {
    pointCount: 24, distribution: 'poisson-disc', trailStyle: 'smooth',
    trailWidth: 2.5, nodeSize: 4, showGraph: true,
    colorMode: 'trail-progress', background: 'dark', animSpeed: 0.2,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const bg = params.background ?? 'dark';
    const isDark = bg === 'dark';
    ctx.fillStyle = BG[bg] ?? BG.dark;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const colors = palette.colors.map(hexToRgb);

    const pointCount = Math.max(4, params.pointCount ?? 24);
    const trailStyle = params.trailStyle ?? 'smooth';
    const trailWidth = params.trailWidth ?? 2.5;
    const nodeSize = params.nodeSize ?? 4;
    const showGraph = params.showGraph ?? true;
    const colorMode = params.colorMode ?? 'trail-progress';
    const animSpeed = params.animSpeed ?? 0.2;

    // Generate points
    const pts = generatePoints(pointCount, params.distribution ?? 'poisson-disc', w, h, rng);
    if (pts.length < 3) return;

    // Delaunay triangulation
    const tris = delaunay(pts, w, h);

    // Build adjacency list (with duplicates for multigraph)
    const adj = new Map<number, number[]>();
    for (let i = 0; i < pointCount; i++) adj.set(i, []);

    const edgeSet = new Set<string>();
    for (const [a, b, c] of tris) {
      for (const [ei, ej] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const key = ei < ej ? `${ei}-${ej}` : `${ej}-${ei}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          adj.get(ei)!.push(ej);
          adj.get(ej)!.push(ei);
        }
      }
    }

    // Make all vertices even-degree by removing edges from odd-degree vertices
    // (This guarantees an Euler circuit exists)
    for (let i = 0; i < pointCount; i++) {
      const edges = adj.get(i)!;
      while (edges.length % 2 === 1 && edges.length > 0) {
        // Remove an edge to a neighbor that also has odd degree, if possible
        let removed = false;
        for (let k = edges.length - 1; k >= 0; k--) {
          const nb = edges[k];
          const nbEdges = adj.get(nb)!;
          if (nbEdges.length % 2 === 1) {
            // Remove edge i-nb
            edges.splice(k, 1);
            const nbIdx = nbEdges.indexOf(i);
            if (nbIdx !== -1) nbEdges.splice(nbIdx, 1);
            removed = true;
            break;
          }
        }
        if (!removed && edges.length > 0) {
          // Remove last edge
          const nb = edges.pop()!;
          const nbEdges = adj.get(nb)!;
          const nbIdx = nbEdges.indexOf(i);
          if (nbIdx !== -1) nbEdges.splice(nbIdx, 1);
        }
      }
    }

    // Find Euler trail
    const trail = findEulerTrail(pointCount, adj);

    // Draw underlying graph edges
    if (showGraph) {
      ctx.lineWidth = 0.5;
      const graphAlpha = isDark ? 0.12 : 0.08;
      ctx.strokeStyle = isDark ? `rgba(255,255,255,${graphAlpha})` : `rgba(0,0,0,${graphAlpha})`;
      for (const key of edgeSet) {
        const [si, sj] = key.split('-').map(Number);
        ctx.beginPath();
        ctx.moveTo(pts[si][0], pts[si][1]);
        ctx.lineTo(pts[sj][0], pts[sj][1]);
        ctx.stroke();
      }
    }

    // Determine how much of the trail to draw (animation)
    const totalSegments = Math.max(1, trail.length - 1);
    let drawSegments: number;
    if (animSpeed <= 0 || time <= 0) {
      drawSegments = totalSegments;
    } else {
      const cycleDuration = totalSegments / (animSpeed * 8);
      const cycleTime = time % (cycleDuration * 1.3); // 30% pause at end
      const progress = Math.min(1, cycleTime / cycleDuration);
      drawSegments = Math.ceil(progress * totalSegments);
    }

    // Draw trail
    if (trail.length >= 2 && drawSegments > 0) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let seg = 0; seg < drawSegments && seg < trail.length - 1; seg++) {
        const a = trail[seg], b = trail[seg + 1];
        const t = seg / totalSegments;

        // Color
        let cr: number, cg: number, cb: number;
        if (colorMode === 'rainbow') {
          const hue = t * 360;
          // Simple HSV to RGB (S=1, V=1)
          const hi = Math.floor(hue / 60) % 6;
          const f = hue / 60 - Math.floor(hue / 60);
          const q = 1 - f, s2 = f;
          const rgb = [[1, s2, 0], [q, 1, 0], [0, 1, s2], [0, q, 1], [s2, 0, 1], [1, 0, q]][hi];
          cr = (rgb[0] * 255) | 0; cg = (rgb[1] * 255) | 0; cb = (rgb[2] * 255) | 0;
        } else if (colorMode === 'palette-segments') {
          [cr, cg, cb] = colors[seg % colors.length];
        } else if (colorMode === 'monochrome') {
          const brightness = isDark ? 200 : 40;
          cr = cg = cb = brightness;
        } else {
          // trail-progress
          [cr, cg, cb] = paletteSample(t, colors);
        }

        const alpha = isDark ? 0.8 : 0.7;

        // Edge glow on dark backgrounds
        if (isDark) {
          ctx.save();
          ctx.shadowColor = `rgba(${cr},${cg},${cb},0.4)`;
          ctx.shadowBlur = 6;
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha * 0.5})`;
          ctx.lineWidth = trailWidth + 2;

          if (trailStyle === 'smooth' && seg > 0 && seg < drawSegments - 1) {
            const prev = trail[seg - 1];
            const next = trail[Math.min(seg + 1, trail.length - 1)];
            const cpx = pts[a][0], cpy = pts[a][1];
            ctx.beginPath();
            ctx.moveTo((pts[prev][0] + pts[a][0]) / 2, (pts[prev][1] + pts[a][1]) / 2);
            ctx.quadraticCurveTo(cpx, cpy, (pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.moveTo(pts[a][0], pts[a][1]);
            ctx.lineTo(pts[b][0], pts[b][1]);
            ctx.stroke();
          }
          ctx.restore();
        }

        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.lineWidth = trailWidth;

        if (trailStyle === 'dashed') {
          ctx.setLineDash([trailWidth * 3, trailWidth * 2]);
        } else {
          ctx.setLineDash([]);
        }

        if (trailStyle === 'smooth' && seg > 0 && seg < drawSegments - 1) {
          const prev = trail[seg - 1];
          const cpx = pts[a][0], cpy = pts[a][1];
          ctx.beginPath();
          ctx.moveTo((pts[prev][0] + pts[a][0]) / 2, (pts[prev][1] + pts[a][1]) / 2);
          ctx.quadraticCurveTo(cpx, cpy, (pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[a][0], pts[a][1]);
          ctx.lineTo(pts[b][0], pts[b][1]);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    // Draw nodes
    if (nodeSize > 0) {
      // Highlight start/end of trail
      for (let i = 0; i < pointCount; i++) {
        const [cr, cg, cb] = paletteSample(i / (pointCount - 1), colors);
        const isTrailEnd = trail.length > 0 && (i === trail[0] || i === trail[trail.length - 1]);
        const ns = isTrailEnd ? nodeSize * 1.3 : nodeSize;

        if (isDark) {
          const grad = ctx.createRadialGradient(pts[i][0], pts[i][1], 0, pts[i][0], pts[i][1], ns * 2.5);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},${isTrailEnd ? 0.5 : 0.25})`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pts[i][0], pts[i][1], ns * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], ns, 0, Math.PI * 2);
        ctx.fill();

        if (isTrailEnd) {
          ctx.fillStyle = `rgba(255,255,255,0.5)`;
          ctx.beginPath();
          ctx.arc(pts[i][0], pts[i][1], ns * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = params.pointCount ?? 24;
    return Math.round(n * n * 0.15 + n * 10);
  },
};
