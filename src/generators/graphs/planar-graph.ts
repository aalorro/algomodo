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
    // Add center point
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

// Check if two line segments (p1-p2) and (p3-p4) intersect (proper crossing, not endpoint)
function segmentsIntersect(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number,
): boolean {
  const d1x = x2 - x1, d1y = y2 - y1;
  const d2x = x4 - x3, d2y = y4 - y3;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false;
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / cross;
  const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / cross;
  // Proper intersection: exclude endpoints
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count', type: 'number', min: 10, max: 200, step: 5, default: 60,
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['jittered-grid', 'random', 'poisson-disc', 'concentric'],
    default: 'poisson-disc', group: 'Composition',
  },
  density: {
    name: 'Edge Density', type: 'number', min: 0.3, max: 1, step: 0.1, default: 0.6,
    help: 'Target edge density — higher adds more edges while maintaining planarity',
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
    help: 'Fill planar faces with translucent colors',
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
  definition: 'Maximal planar graph — edges are greedily added by proximity while ensuring no crossings',
  algorithmNotes:
    'Generates N points, sorts all possible edges by distance, then greedily adds each edge if it does not ' +
    'cross any existing edge (segment intersection test). This produces a planar graph that maximizes short ' +
    'connections. Supports greedy four-coloring of nodes, face filling, and multiple edge rendering styles.',
  parameterSchema,
  defaultParams: {
    pointCount: 60, distribution: 'poisson-disc', density: 0.6,
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

    const pointCount = params.pointCount ?? 60;
    const density = params.density ?? 0.6;
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

    // Build all candidate edges sorted by distance
    const candidates: { i: number; j: number; dist: number }[] = [];
    for (let i = 0; i < pointCount; i++) {
      for (let j = i + 1; j < pointCount; j++) {
        const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
        candidates.push({ i, j, dist: Math.sqrt(dx * dx + dy * dy) });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    // Greedy planarity: add edges that don't cross existing ones
    // Max edges in planar graph: 3n - 6
    const maxEdges = Math.round((3 * pointCount - 6) * density);
    const edges: [number, number][] = [];
    const degree: number[] = new Array(pointCount).fill(0);
    const adj: Set<number>[] = Array.from({ length: pointCount }, () => new Set());

    for (const cand of candidates) {
      if (edges.length >= maxEdges) break;

      // Check if this edge crosses any existing edge
      const x1 = pts[cand.i][0], y1 = pts[cand.i][1];
      const x2 = pts[cand.j][0], y2 = pts[cand.j][1];

      let crosses = false;
      for (const [ei, ej] of edges) {
        // Skip edges that share an endpoint
        if (ei === cand.i || ei === cand.j || ej === cand.i || ej === cand.j) continue;
        if (segmentsIntersect(x1, y1, x2, y2, pts[ei][0], pts[ei][1], pts[ej][0], pts[ej][1])) {
          crosses = true;
          break;
        }
      }

      if (!crosses) {
        edges.push([cand.i, cand.j]);
        degree[cand.i]++;
        degree[cand.j]++;
        adj[cand.i].add(cand.j);
        adj[cand.j].add(cand.i);
      }
    }

    const maxDeg = Math.max(1, ...degree);

    // Greedy graph coloring (for four-color mode)
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

    // Node colors based on mode
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
        // depth: distance from center
        const dx = pts[i][0] - w / 2, dy = pts[i][1] - h / 2;
        const rd = Math.sqrt(dx * dx + dy * dy) / (Math.min(w, h) * 0.5);
        nodeColors[i] = paletteSample(Math.min(1, rd), colors);
      }
    }

    // Fill triangular faces
    if (fillFaces) {
      const edgeSet = new Set<string>();
      for (const [i, j] of edges) {
        edgeSet.add(`${i}-${j}`);
        edgeSet.add(`${j}-${i}`);
      }
      // Find triangles
      for (const [i, j] of edges) {
        for (const k of adj[i]) {
          if (k > j && adj[j].has(k)) {
            const [cr0, cg0, cb0] = nodeColors[i];
            const [cr1, cg1, cb1] = nodeColors[j];
            const [cr2, cg2, cb2] = nodeColors[k];
            const cr = ((cr0 + cr1 + cr2) / 3) | 0;
            const cg = ((cg0 + cg1 + cg2) / 3) | 0;
            const cb = ((cb0 + cb1 + cb2) / 3) | 0;
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.1 : 0.08})`;
            ctx.beginPath();
            ctx.moveTo(pts[i][0], pts[i][1]);
            ctx.lineTo(pts[j][0], pts[j][1]);
            ctx.lineTo(pts[k][0], pts[k][1]);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }

    // Draw edges
    ctx.lineCap = 'round';
    ctx.lineWidth = edgeWidth;
    const edgeAlpha = isDark ? 0.45 : 0.35;

    for (const [i, j] of edges) {
      const [cr0, cg0, cb0] = nodeColors[i];
      const [cr1, cg1, cb1] = nodeColors[j];
      const grad = ctx.createLinearGradient(pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
      grad.addColorStop(0, `rgba(${cr0},${cg0},${cb0},${edgeAlpha})`);
      grad.addColorStop(1, `rgba(${cr1},${cg1},${cb1},${edgeAlpha})`);
      ctx.strokeStyle = grad;

      if (edgeStyle === 'curved') {
        const mx = (pts[i][0] + pts[j][0]) / 2;
        const my = (pts[i][1] + pts[j][1]) / 2;
        const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const bulge = len * 0.12;
        const cpx = mx + (-dy / len) * bulge;
        const cpy = my + (dx / len) * bulge;
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.quadraticCurveTo(cpx, cpy, pts[j][0], pts[j][1]);
        ctx.stroke();
      } else if (edgeStyle === 'angular') {
        // Right-angle bend at midpoint
        const mx = (pts[i][0] + pts[j][0]) / 2;
        const my = (pts[i][1] + pts[j][1]) / 2;
        // Choose horizontal-then-vertical or vice versa based on index parity
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        if ((i + j) % 2 === 0) {
          ctx.lineTo(mx, pts[i][1]);
          ctx.lineTo(mx, pts[j][1]);
        } else {
          ctx.lineTo(pts[i][0], my);
          ctx.lineTo(pts[j][0], my);
        }
        ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[j][0], pts[j][1]);
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
    const n = params.pointCount ?? 60;
    return Math.round(n * n * 0.2);
  },
};
