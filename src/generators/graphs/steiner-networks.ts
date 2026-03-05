import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { SVGPathBuilder } from '../../renderers/svg/builder';

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

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
}

// Prim's MST (adapted from mst-web.ts)
function buildMST(pts: [number, number][]): [number, number, number][] {
  const n = pts.length;
  if (n < 2) return [];
  const inMST = new Uint8Array(n);
  const minDist = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  minDist[0] = 0;
  const edges: [number, number, number][] = [];

  for (let step = 0; step < n; step++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inMST[i] && (u === -1 || minDist[i] < minDist[u])) u = i;
    }
    if (u === -1) break;
    inMST[u] = 1;
    if (parent[u] !== -1) {
      edges.push([parent[u], u, dist(pts[parent[u]][0], pts[parent[u]][1], pts[u][0], pts[u][1])]);
    }
    for (let v = 0; v < n; v++) {
      if (!inMST[v]) {
        const d = dist(pts[u][0], pts[u][1], pts[v][0], pts[v][1]);
        if (d < minDist[v]) { minDist[v] = d; parent[v] = u; }
      }
    }
  }
  return edges;
}

// Compute Torricelli/Fermat point for three points
function torricelliPoint(a: [number, number], b: [number, number], c: [number, number]): [number, number] | null {
  // Check if any angle >= 120 degrees
  const ab = dist(a[0], a[1], b[0], b[1]);
  const bc = dist(b[0], b[1], c[0], c[1]);
  const ca = dist(c[0], c[1], a[0], a[1]);

  const cosA = (ab * ab + ca * ca - bc * bc) / (2 * ab * ca || 1);
  const cosB = (ab * ab + bc * bc - ca * ca) / (2 * ab * bc || 1);
  const cosC = (bc * bc + ca * ca - ab * ab) / (2 * bc * ca || 1);

  // If any angle >= 120, Steiner point = that vertex
  if (cosA <= -0.5) return a;
  if (cosB <= -0.5) return b;
  if (cosC <= -0.5) return c;

  // Iterative Weiszfeld algorithm for Fermat point
  let px = (a[0] + b[0] + c[0]) / 3;
  let py = (a[1] + b[1] + c[1]) / 3;

  for (let iter = 0; iter < 50; iter++) {
    const da = dist(px, py, a[0], a[1]) || 0.001;
    const db = dist(px, py, b[0], b[1]) || 0.001;
    const dc = dist(px, py, c[0], c[1]) || 0.001;
    const wa = 1 / da, wb = 1 / db, wc = 1 / dc;
    const wt = wa + wb + wc;
    const nx = (a[0] * wa + b[0] * wb + c[0] * wc) / wt;
    const ny = (a[1] * wa + b[1] * wb + c[1] * wc) / wt;
    if ((nx - px) ** 2 + (ny - py) ** 2 < 0.01) break;
    px = nx; py = ny;
  }
  return [px, py];
}

interface SteinerResult {
  points: [number, number][];
  edges: [number, number][];
  steinerIndices: number[];
  mstEdges: [number, number, number][];
}

function buildSteinerTree(
  terminals: [number, number][], iterations: number
): SteinerResult {
  const pts = [...terminals];
  const mstEdges = buildMST(pts);

  if (iterations === 0) {
    return {
      points: pts,
      edges: mstEdges.map(([a, b]) => [a, b]),
      steinerIndices: [],
      mstEdges,
    };
  }

  // Build adjacency from MST
  const n = pts.length;
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (const [a, b] of mstEdges) {
    adj[a].add(b);
    adj[b].add(a);
  }

  const steinerIndices: number[] = [];

  // Try to insert Steiner points at degree-2+ nodes
  for (let node = 0; node < terminals.length; node++) {
    const neighbors = [...adj[node]];
    if (neighbors.length < 2) continue;

    // Try all pairs of neighbors to form triples
    for (let i = 0; i < neighbors.length - 1 && steinerIndices.length < terminals.length; i++) {
      for (let j = i + 1; j < neighbors.length && steinerIndices.length < terminals.length; j++) {
        const a = pts[node], b = pts[neighbors[i]], c = pts[neighbors[j]];
        const tp = torricelliPoint(a, b, c);
        if (!tp) continue;

        // Check if Steiner point reduces total length
        const oldLen = dist(a[0], a[1], b[0], b[1]) + dist(a[0], a[1], c[0], c[1]);
        const newLen = dist(tp[0], tp[1], a[0], a[1]) + dist(tp[0], tp[1], b[0], b[1]) + dist(tp[0], tp[1], c[0], c[1]);

        if (newLen < oldLen * 0.98) {
          const sIdx = pts.length;
          pts.push(tp);
          steinerIndices.push(sIdx);

          // Update adjacency: remove old edges, add new ones through Steiner point
          adj[node].delete(neighbors[i]);
          adj[neighbors[i]].delete(node);
          adj[node].delete(neighbors[j]);
          adj[neighbors[j]].delete(node);

          adj.push(new Set());
          adj[sIdx].add(node); adj[node].add(sIdx);
          adj[sIdx].add(neighbors[i]); adj[neighbors[i]].add(sIdx);
          adj[sIdx].add(neighbors[j]); adj[neighbors[j]].add(sIdx);
          break;
        }
      }
    }
  }

  // Iterative refinement of Steiner point positions
  for (let iter = 0; iter < Math.min(iterations, 100); iter++) {
    let moved = false;
    for (const sIdx of steinerIndices) {
      const neighbors = [...adj[sIdx]];
      if (neighbors.length < 2) continue;

      // Move toward Weiszfeld optimum
      let wx = 0, wy = 0, wt = 0;
      for (const ni of neighbors) {
        const d = dist(pts[sIdx][0], pts[sIdx][1], pts[ni][0], pts[ni][1]) || 0.001;
        const w = 1 / d;
        wx += pts[ni][0] * w;
        wy += pts[ni][1] * w;
        wt += w;
      }
      const nx = wx / wt, ny = wy / wt;
      if ((nx - pts[sIdx][0]) ** 2 + (ny - pts[sIdx][1]) ** 2 > 0.1) {
        pts[sIdx] = [nx, ny];
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Collect edges from adjacency
  const finalEdges: [number, number][] = [];
  const seen = new Set<string>();
  for (let i = 0; i < adj.length; i++) {
    for (const j of adj[i]) {
      const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
      if (!seen.has(key)) {
        seen.add(key);
        finalEdges.push([i, j]);
      }
    }
  }

  return { points: pts, edges: finalEdges, steinerIndices, mstEdges };
}

function generateTerminals(
  count: number, distribution: string, w: number, h: number, rng: SeededRNG
): [number, number][] {
  const margin = Math.min(w, h) * 0.08;
  const iw = w - margin * 2, ih = h - margin * 2;
  const cx = w / 2, cy = h / 2;
  const pts: [number, number][] = [];

  switch (distribution) {
    case 'clustered': {
      const clusters = 3 + Math.floor(rng.random() * 3);
      const centers: [number, number][] = [];
      for (let i = 0; i < clusters; i++) {
        centers.push([margin + rng.random() * iw, margin + rng.random() * ih]);
      }
      for (let i = 0; i < count; i++) {
        const center = centers[i % clusters];
        const r = rng.gaussian(0, Math.min(iw, ih) * 0.08);
        const a = rng.random() * Math.PI * 2;
        pts.push([
          Math.max(margin, Math.min(w - margin, center[0] + Math.cos(a) * r)),
          Math.max(margin, Math.min(h - margin, center[1] + Math.sin(a) * r)),
        ]);
      }
      break;
    }
    case 'ring': {
      const R = Math.min(iw, ih) * 0.4;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng.random() * 0.2;
        const r = R + rng.gaussian(0, R * 0.05);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      break;
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const gw = iw / cols, gh = ih / rows;
      for (let r = 0; r < rows && pts.length < count; r++) {
        for (let c = 0; c < cols && pts.length < count; c++) {
          pts.push([
            margin + (c + 0.5) * gw + rng.gaussian(0, gw * 0.1),
            margin + (r + 0.5) * gh + rng.gaussian(0, gh * 0.1),
          ]);
        }
      }
      break;
    }
    case 'fibonacci': {
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const maxR = Math.min(iw, ih) * 0.45;
      for (let i = 0; i < count; i++) {
        const r = Math.sqrt((i + 0.5) / count) * maxR;
        const theta = i * goldenAngle;
        pts.push([cx + Math.cos(theta) * r, cy + Math.sin(theta) * r]);
      }
      break;
    }
    default: // random
      for (let i = 0; i < count; i++) {
        pts.push([margin + rng.random() * iw, margin + rng.random() * ih]);
      }
  }
  return pts;
}

// Assign subtree colors via BFS from root
function assignSubtreeColors(
  points: [number, number][], edges: [number, number][], numTerminals: number, numColors: number
): number[] {
  const n = points.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }

  const color = new Array(n).fill(0);
  const visited = new Uint8Array(n);
  const queue = [0];
  visited[0] = 1;
  let colorIdx = 0;

  // BFS, assign color per major branch from root
  const rootNeighbors = adj[0];
  for (const nb of rootNeighbors) {
    const branchQueue = [nb];
    visited[nb] = 1;
    color[nb] = colorIdx;
    while (branchQueue.length > 0) {
      const node = branchQueue.shift()!;
      for (const next of adj[node]) {
        if (!visited[next]) {
          visited[next] = 1;
          color[next] = colorIdx;
          branchQueue.push(next);
        }
      }
    }
    colorIdx = (colorIdx + 1) % numColors;
  }

  // Handle disconnected nodes
  for (let i = 0; i < n; i++) {
    if (!visited[i]) {
      visited[i] = 1;
      const bfs = [i];
      while (bfs.length > 0) {
        const node = bfs.shift()!;
        color[node] = colorIdx;
        for (const next of adj[node]) {
          if (!visited[next]) { visited[next] = 1; bfs.push(next); }
        }
      }
      colorIdx = (colorIdx + 1) % numColors;
    }
  }

  return color;
}

const parameterSchema: ParameterSchema = {
  terminalCount: {
    name: 'Terminal Points', type: 'number', min: 3, max: 60, step: 1, default: 12,
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['random', 'clustered', 'ring', 'grid', 'fibonacci'],
    default: 'random', group: 'Composition',
  },
  steinerIterations: {
    name: 'Optimization Steps', type: 'number', min: 0, max: 200, step: 10, default: 80,
    help: 'Steiner point refinement iterations (0 = MST only)', group: 'Geometry',
  },
  showMST: {
    name: 'Show MST', type: 'boolean', default: true,
    help: 'Show original MST as reference', group: 'Geometry',
  },
  showVoronoi: {
    name: 'Show Territory', type: 'boolean', default: false,
    help: 'Shade Voronoi cells around terminals', group: 'Texture',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 3, max: 20, step: 1, default: 8,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 1, max: 8, step: 0.5, default: 3,
    group: 'Geometry',
  },
  glowIntensity: {
    name: 'Glow', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['by-subtree', 'by-depth', 'edge-length', 'radial'],
    default: 'by-subtree', group: 'Color',
  },
  background: {
    name: 'Background', type: 'select', options: ['dark', 'blueprint', 'light'],
    default: 'dark', group: 'Color',
  },
  animMode: {
    name: 'Animation', type: 'select', options: ['none', 'grow', 'pulse', 'drift'],
    default: 'grow', group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.3,
    group: 'Flow/Motion',
  },
};

export const steinerNetworks: Generator = {
  id: 'graph-steiner-networks',
  family: 'graphs',
  styleName: 'Steiner Networks',
  definition: 'Minimum Steiner tree networks — shortest connection of terminal points with optimized junction nodes',
  algorithmNotes:
    'Generates terminal points, builds an MST via Prim\'s algorithm, then inserts Steiner junction points ' +
    'at Torricelli/Fermat points of MST triples to reduce total network length. Steiner points are refined ' +
    'iteratively using the Weiszfeld algorithm. The result shows characteristic 120-degree junction angles. ' +
    'Animation modes: grow (progressive edge reveal), pulse (energy dots along edges), drift (terminals wander).',
  parameterSchema,
  defaultParams: {
    terminalCount: 12, distribution: 'random', steinerIterations: 80, showMST: true,
    showVoronoi: false, nodeSize: 8, edgeWidth: 3, glowIntensity: 0.5,
    colorMode: 'by-subtree', background: 'dark', animMode: 'grow', speed: 0.3,
  },
  supportsVector: true, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const colors = palette.colors.map(hexToRgb);

    const termCount = params.terminalCount ?? 12;
    const distribution = params.distribution ?? 'random';
    const steinerIters = params.steinerIterations ?? 80;
    const showMST = params.showMST ?? true;
    const showVoronoi = params.showVoronoi ?? false;
    const nodeSize = params.nodeSize ?? 8;
    const edgeWidth = params.edgeWidth ?? 3;
    const glowInt = params.glowIntensity ?? 0.5;
    const colorMode = params.colorMode ?? 'by-subtree';
    const bg = params.background ?? 'dark';
    const animMode = params.animMode ?? 'none';
    const speed = params.speed ?? 0.3;

    // Generate terminals
    let terminals = generateTerminals(termCount, distribution, w, h, rng);

    // Animation drift
    if (time > 0 && animMode === 'drift') {
      terminals = terminals.map(([x, y], i) => [
        x + Math.cos(time * speed + i * 2.399) * nodeSize * 3,
        y + Math.sin(time * speed * 1.3 + i * 1.7) * nodeSize * 3,
      ] as [number, number]);
    }

    // Build Steiner tree
    const result = buildSteinerTree(terminals, steinerIters);
    const { points, edges, steinerIndices, mstEdges } = result;

    // Subtree colors
    const subtreeColors = assignSubtreeColors(points, edges, termCount, colors.length);

    // BFS depth for by-depth mode
    const depths = new Array(points.length).fill(0);
    if (colorMode === 'by-depth') {
      const adj: number[][] = Array.from({ length: points.length }, () => []);
      for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
      const visited = new Uint8Array(points.length);
      const queue = [0];
      visited[0] = 1;
      while (queue.length > 0) {
        const node = queue.shift()!;
        for (const next of adj[node]) {
          if (!visited[next]) {
            visited[next] = 1;
            depths[next] = depths[node] + 1;
            queue.push(next);
          }
        }
      }
    }
    const maxDepth = Math.max(1, ...depths);

    // Background
    if (bg === 'blueprint') {
      ctx.fillStyle = '#0a1628';
      ctx.fillRect(0, 0, w, h);
      // Grid lines
      ctx.strokeStyle = 'rgba(40,80,140,0.15)';
      ctx.lineWidth = 0.5;
      const gridStep = 40;
      for (let x = 0; x < w; x += gridStep) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    } else if (bg === 'light') {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, w, h);
    }

    // Voronoi territory shading
    if (showVoronoi && quality !== 'draft') {
      const step = quality === 'ultra' ? 2 : 4;
      for (let py = 0; py < h; py += step) {
        for (let px = 0; px < w; px += step) {
          let minD = Infinity, minI = 0;
          for (let i = 0; i < termCount; i++) {
            const d = (terminals[i][0] - px) ** 2 + (terminals[i][1] - py) ** 2;
            if (d < minD) { minD = d; minI = i; }
          }
          const c = colors[minI % colors.length];
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.08)`;
          ctx.fillRect(px, py, step, step);
        }
      }
    }

    // Grow animation progress
    let growProgress = 1;
    if (time > 0 && animMode === 'grow') {
      growProgress = (time * speed * 0.3) % 1;
    }

    // Edge color resolver
    const getEdgeColor = (ia: number, ib: number): [number, number, number] => {
      if (colorMode === 'by-subtree') {
        return colors[subtreeColors[ia] % colors.length];
      } else if (colorMode === 'by-depth') {
        const avgDepth = (depths[ia] + depths[ib]) / 2;
        return paletteSample(avgDepth / maxDepth, colors);
      } else if (colorMode === 'edge-length') {
        const d = dist(points[ia][0], points[ia][1], points[ib][0], points[ib][1]);
        const maxD = Math.max(w, h) * 0.5;
        return paletteSample(Math.min(1, d / maxD), colors);
      } else {
        // radial
        const mx = (points[ia][0] + points[ib][0]) / 2;
        const my = (points[ia][1] + points[ib][1]) / 2;
        const d = dist(mx, my, w / 2, h / 2) / (Math.max(w, h) * 0.5);
        return paletteSample(Math.min(1, d), colors);
      }
    };

    // Draw MST reference
    if (showMST && steinerIters > 0) {
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = edgeWidth * 0.4;
      for (const [ia, ib] of mstEdges) {
        const mstColor = bg === 'light' ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
        ctx.strokeStyle = mstColor;
        ctx.beginPath();
        ctx.moveTo(terminals[ia][0], terminals[ia][1]);
        ctx.lineTo(terminals[ib][0], terminals[ib][1]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Draw Steiner tree edges
    // Sort by depth for consistent drawing order
    const sortedEdges = [...edges].sort((a, b) => {
      return (depths[a[0]] + depths[a[1]]) - (depths[b[0]] + depths[b[1]]);
    });

    for (let ei = 0; ei < sortedEdges.length; ei++) {
      const [ia, ib] = sortedEdges[ei];

      // Grow animation: only draw edges up to progress
      const edgeProgress = ei / sortedEdges.length;
      if (edgeProgress > growProgress) continue;

      const pa = points[ia], pb = points[ib];
      const [cr, cg, cb] = getEdgeColor(ia, ib);

      // Partial edge for grow animation
      let endX = pb[0], endY = pb[1];
      if (animMode === 'grow' && time > 0) {
        const localProgress = Math.min(1, (growProgress - edgeProgress) * sortedEdges.length);
        endX = pa[0] + (pb[0] - pa[0]) * localProgress;
        endY = pa[1] + (pb[1] - pa[1]) * localProgress;
      }

      // Glow
      if (glowInt > 0) {
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${glowInt * 0.25})`;
        ctx.lineWidth = edgeWidth * 2.5;
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      // Main edge
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.85)`;
      ctx.lineWidth = edgeWidth;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    // Pulse animation: dots traveling along edges
    if (time > 0 && animMode === 'pulse') {
      for (const [ia, ib] of edges) {
        const pa = points[ia], pb = points[ib];
        const edgeLen = dist(pa[0], pa[1], pb[0], pb[1]);
        const [cr, cg, cb] = getEdgeColor(ia, ib);

        const pulseCount = Math.max(1, Math.floor(edgeLen / 60));
        for (let p = 0; p < pulseCount; p++) {
          const t = ((time * speed * 2 + p / pulseCount + ia * 0.1) % 1);
          const px = pa[0] + (pb[0] - pa[0]) * t;
          const py = pa[1] + (pb[1] - pa[1]) * t;

          ctx.beginPath();
          ctx.arc(px, py, edgeWidth * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,0.8)`;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(px, py, edgeWidth * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.3)`;
          ctx.fill();
        }
      }
    }

    // Draw terminal nodes
    for (let i = 0; i < termCount && i < points.length; i++) {
      const [px, py] = points[i];
      const c = colors[subtreeColors[i] % colors.length];

      // Glow halo
      if (glowInt > 0) {
        ctx.beginPath();
        ctx.arc(px, py, nodeSize * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${glowInt * 0.2})`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(px, py, nodeSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fill();

      // White outline
      ctx.strokeStyle = bg === 'light' ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw Steiner points (smaller, diamond-shaped)
    for (const si of steinerIndices) {
      if (si >= points.length) continue;
      const [px, py] = points[si];
      const s = nodeSize * 0.5;

      ctx.beginPath();
      ctx.moveTo(px, py - s);
      ctx.lineTo(px + s, py);
      ctx.lineTo(px, py + s);
      ctx.lineTo(px - s, py);
      ctx.closePath();
      ctx.fillStyle = bg === 'light' ? 'rgba(60,60,60,0.8)' : 'rgba(255,255,255,0.8)';
      ctx.fill();
    }
  },

  renderVector(params, seed, palette) {
    const builder = new SVGPathBuilder();
    const rng = new SeededRNG(seed);
    const colors = palette.colors.map(hexToRgb);
    const w = 1080, h = 1080;

    const termCount = params.terminalCount ?? 12;
    const distribution = params.distribution ?? 'random';
    const steinerIters = params.steinerIterations ?? 80;
    const nodeSize = params.nodeSize ?? 8;
    const edgeWidth = params.edgeWidth ?? 3;

    const terminals = generateTerminals(termCount, distribution, w, h, rng);
    const result = buildSteinerTree(terminals, steinerIters);
    const { points, edges, steinerIndices } = result;
    const subtreeColors = assignSubtreeColors(points, edges, termCount, colors.length);

    // Edges
    for (const [ia, ib] of edges) {
      const c = colors[subtreeColors[ia] % colors.length];
      builder.addLine(points[ia][0], points[ia][1], points[ib][0], points[ib][1],
        `rgb(${c[0]},${c[1]},${c[2]})`, edgeWidth, 0.85);
    }

    // Terminal nodes
    for (let i = 0; i < termCount && i < points.length; i++) {
      const c = colors[subtreeColors[i] % colors.length];
      builder.addCircle(points[i][0], points[i][1], nodeSize,
        `rgb(${c[0]},${c[1]},${c[2]})`, 'rgba(255,255,255,0.4)', 0.9);
    }

    // Steiner points
    for (const si of steinerIndices) {
      if (si >= points.length) continue;
      builder.addCircle(points[si][0], points[si][1], nodeSize * 0.4,
        'rgba(255,255,255,0.8)', undefined, 0.9);
    }

    return builder.getPaths();
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = params.terminalCount ?? 12;
    return Math.round(n * n + (params.steinerIterations ?? 80) * n * 3 +
      ((params.showVoronoi ?? false) ? 1080 * 1080 * 0.001 : 0));
  },
};
