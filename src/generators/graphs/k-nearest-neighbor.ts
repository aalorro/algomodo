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
  if (dist === 'clusters') {
    const pts: [number, number][] = [];
    const nClusters = Math.max(3, Math.ceil(count / 20));
    const centers: [number, number][] = [];
    for (let i = 0; i < nClusters; i++) centers.push([rng.random() * w, rng.random() * h]);
    for (let i = 0; i < count; i++) {
      const c = centers[i % nClusters];
      const spread = Math.min(w, h) * 0.12;
      pts.push([c[0] + rng.gaussian(0, spread), c[1] + rng.gaussian(0, spread)]);
    }
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
    name: 'Point Count', type: 'number', min: 20, max: 400, step: 10, default: 120,
    group: 'Composition',
  },
  k: {
    name: 'K Neighbors', type: 'number', min: 1, max: 12, step: 1, default: 4,
    help: 'Number of nearest neighbors each node connects to',
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['jittered-grid', 'random', 'poisson-disc', 'clusters'],
    default: 'jittered-grid', group: 'Composition',
  },
  edgeStyle: {
    name: 'Edge Style', type: 'select',
    options: ['straight', 'curved', 'tapered'],
    default: 'straight',
    help: 'straight: lines · curved: arced connections · tapered: thick→thin edges',
    group: 'Geometry',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 0, max: 8, step: 0.5, default: 3,
    help: '0 = no nodes drawn',
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 4, step: 0.5, default: 1,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['degree', 'distance', 'cluster', 'noise'],
    default: 'degree',
    help: 'degree: by connection count · distance: by edge length · cluster: by neighborhood · noise: by FBM',
    group: 'Color',
  },
  edgeColor: {
    name: 'Edge Color', type: 'select',
    options: ['gradient', 'source', 'uniform'],
    default: 'gradient',
    help: 'gradient: blend between endpoint colors · source: match source node · uniform: single color',
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['dark', 'white', 'cream'],
    default: 'dark', group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed', type: 'number', min: 0, max: 1, step: 0.05, default: 0.15,
    help: 'Vertex drift speed (0 = static)', group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0a0a0f' };

export const kNearestNeighbor: Generator = {
  id: 'graph-k-nearest-neighbor',
  family: 'graphs',
  styleName: 'k-Nearest Neighbor',
  definition: 'k-NN graph — each node connects to its k closest neighbors, revealing local structure and cluster boundaries',
  algorithmNotes:
    'Generates N points via the chosen distribution, then for each point finds its k nearest neighbors by ' +
    'Euclidean distance and draws directed edges. Color encodes structural properties: node degree, average ' +
    'edge distance, neighborhood clustering, or noise-based. Supports curved and tapered edge rendering.',
  parameterSchema,
  defaultParams: {
    pointCount: 120, k: 4, distribution: 'jittered-grid',
    edgeStyle: 'straight', nodeSize: 3, edgeWidth: 1,
    colorMode: 'degree', edgeColor: 'gradient', background: 'dark', animSpeed: 0.15,
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

    const pointCount = params.pointCount ?? 120;
    const k = Math.max(1, Math.min(pointCount - 1, params.k ?? 4));
    const edgeStyle = params.edgeStyle ?? 'straight';
    const nodeSize = params.nodeSize ?? 3;
    const edgeWidth = params.edgeWidth ?? 1;
    const colorMode = params.colorMode ?? 'degree';
    const edgeColor = params.edgeColor ?? 'gradient';
    const animSpeed = params.animSpeed ?? 0.15;

    // Generate and animate points
    const basePts = generatePoints(pointCount, params.distribution ?? 'jittered-grid', w, h, rng);
    const avgCell = Math.sqrt(w * h / pointCount);
    const amp = animSpeed > 0 ? avgCell * 0.2 : 0;
    const pts: [number, number][] = basePts.map(([bx, by], i) => {
      if (time <= 0 || amp <= 0) return [bx, by];
      return [
        bx + Math.cos(time * animSpeed + i * 2.399) * amp,
        by + Math.sin(time * animSpeed * 1.3 + i * 3.7) * amp,
      ];
    });

    // Build k-NN adjacency: for each point, find k nearest neighbors
    const neighbors: number[][] = new Array(pointCount);
    const degree: number[] = new Array(pointCount).fill(0);

    for (let i = 0; i < pointCount; i++) {
      // Compute distances to all other points
      const dists: { idx: number; dist: number }[] = [];
      for (let j = 0; j < pointCount; j++) {
        if (j === i) continue;
        const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
        dists.push({ idx: j, dist: Math.sqrt(dx * dx + dy * dy) });
      }
      dists.sort((a, b) => a.dist - b.dist);
      neighbors[i] = dists.slice(0, k).map(d => d.idx);
    }

    // Compute degree (count of edges touching each node)
    const edges: Set<string> = new Set();
    for (let i = 0; i < pointCount; i++) {
      for (const j of neighbors[i]) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!edges.has(key)) {
          edges.add(key);
          degree[i]++;
          degree[j]++;
        }
      }
    }

    const maxDegree = Math.max(1, ...degree);

    // Compute node colors based on mode
    const nodeColors: [number, number, number][] = new Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      if (colorMode === 'degree') {
        nodeColors[i] = paletteSample(degree[i] / maxDegree, colors);
      } else if (colorMode === 'distance') {
        // Average edge distance
        let totalDist = 0;
        for (const j of neighbors[i]) {
          const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
          totalDist += Math.sqrt(dx * dx + dy * dy);
        }
        const avgDist = totalDist / Math.max(1, neighbors[i].length);
        nodeColors[i] = paletteSample(Math.min(1, avgDist / (avgCell * 2)), colors);
      } else if (colorMode === 'cluster') {
        // Use spatial position hashed through palette
        const cx = pts[i][0] / w, cy = pts[i][1] / h;
        const ct = (cx * 0.6 + cy * 0.4) % 1;
        nodeColors[i] = paletteSample(ct, colors);
      } else {
        // noise
        const nv = noise.fbm(pts[i][0] / w * 3 + 5, pts[i][1] / h * 3 + 5, 3, 2, 0.5);
        nodeColors[i] = paletteSample(nv * 0.5 + 0.5, colors);
      }
    }

    // Draw edges
    ctx.lineWidth = edgeWidth;
    ctx.lineCap = 'round';

    for (const edgeKey of edges) {
      const [si, sj] = edgeKey.split('-').map(Number);
      const [x0, y0] = pts[si];
      const [x1, y1] = pts[sj];
      const [cr0, cg0, cb0] = nodeColors[si];
      const [cr1, cg1, cb1] = nodeColors[sj];
      const edgeAlpha = isDark ? 0.5 : 0.4;

      if (edgeColor === 'gradient') {
        const grad = ctx.createLinearGradient(x0, y0, x1, y1);
        grad.addColorStop(0, `rgba(${cr0},${cg0},${cb0},${edgeAlpha})`);
        grad.addColorStop(1, `rgba(${cr1},${cg1},${cb1},${edgeAlpha})`);
        ctx.strokeStyle = grad;
      } else if (edgeColor === 'source') {
        ctx.strokeStyle = `rgba(${cr0},${cg0},${cb0},${edgeAlpha})`;
      } else {
        const [ur, ug, ub] = colors[0];
        ctx.strokeStyle = `rgba(${ur},${ug},${ub},${edgeAlpha})`;
      }

      if (edgeStyle === 'curved') {
        // Arc: perpendicular offset at midpoint
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        const bulge = len * 0.15;
        const cpx = mx + (-dy / len) * bulge;
        const cpy = my + (dx / len) * bulge;
        ctx.lineWidth = edgeWidth;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(cpx, cpy, x1, y1);
        ctx.stroke();
      } else if (edgeStyle === 'tapered') {
        // Draw as a thin triangle
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const tw = edgeWidth * 1.5;
        ctx.beginPath();
        ctx.moveTo(x0 + nx * tw, y0 + ny * tw);
        ctx.lineTo(x0 - nx * tw, y0 - ny * tw);
        ctx.lineTo(x1, y1);
        ctx.closePath();
        // Use fill for tapered
        if (edgeColor === 'gradient') {
          const grad = ctx.createLinearGradient(x0, y0, x1, y1);
          grad.addColorStop(0, `rgba(${cr0},${cg0},${cb0},${edgeAlpha})`);
          grad.addColorStop(1, `rgba(${cr1},${cg1},${cb1},${edgeAlpha * 0.3})`);
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = ctx.strokeStyle;
        }
        ctx.fill();
      } else {
        ctx.lineWidth = edgeWidth;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }

    // Draw nodes
    if (nodeSize > 0) {
      for (let i = 0; i < pointCount; i++) {
        const [cr, cg, cb] = nodeColors[i];
        // Glow
        if (isDark) {
          const grad = ctx.createRadialGradient(pts[i][0], pts[i][1], 0, pts[i][0], pts[i][1], nodeSize * 2.5);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.25)`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pts[i][0], pts[i][1], nodeSize * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Solid node
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], nodeSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = params.pointCount ?? 120;
    return Math.round(n * n * 0.1);
  },
};
