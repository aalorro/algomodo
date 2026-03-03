import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(colors: [number, number, number][], t: number): string {
  const ci = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
  const f  = ci - i0;
  const r  = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
  const g  = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
  const b  = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count',
    type: 'number', min: 10, max: 600, step: 10, default: 400,
    group: 'Composition',
  },
  prunePercent: {
    name: 'Prune %',
    type: 'number', min: 0, max: 70, step: 5, default: 0,
    help: 'Remove the longest X% of MST edges — breaks the tree into isolated organic subtree clusters; low values thin the web, high values fragment it into archipelagos',
    group: 'Composition',
  },
  nodeSize: {
    name: 'Node Size',
    type: 'number', min: 0, max: 30, step: 1, default: 8,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width',
    type: 'number', min: 1, max: 8, step: 0.5, default: 4,
    group: 'Geometry',
  },
  distribution: {
    name: 'Distribution',
    type: 'select',
    options: ['uniform', 'gaussian', 'clustered', 'ring', 'fibonacci'],
    default: 'uniform',
    help: 'uniform: random scatter | gaussian: centre-weighted density | clustered: tight local groups | ring: annular band | fibonacci: phyllotaxis golden-angle spiral — the most organic and evenly-spaced distribution',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-cycle', 'edge-length', 'depth', 'radial'],
    default: 'palette-cycle',
    help: 'palette-cycle: edge colour by node indices | edge-length: short→long mapped to palette | depth: MST growth order | radial: edge midpoint distance from centre → palette gradient — reveals the radial structure of the spanning tree',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['dark', 'light'],
    default: 'dark',
    group: 'Color',
  },
  drift: {
    name: 'Drift',
    type: 'number', min: 0, max: 40, step: 1, default: 12,
    help: 'Node drift amplitude in pixels (animated only)',
    group: 'Flow/Motion',
  },
  driftSpeed: {
    name: 'Drift Speed',
    type: 'number', min: 0.02, max: 0.5, step: 0.02, default: 0.1,
    group: 'Flow/Motion',
  },
};

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
}

// Prim's MST — O(N²), fine up to ~600 nodes
function buildMST(pts: [number, number][]): [number, number, number][] {
  const n = pts.length;
  if (n < 2) return [];

  const inMST   = new Uint8Array(n);
  const minDist = new Float32Array(n).fill(Infinity);
  const parent  = new Int32Array(n).fill(-1);
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

export const mstWeb: Generator = {
  id: 'mst-web',
  family: 'geometry',
  styleName: 'Minimum Spanning Tree Web',
  definition: "Connects a field of nodes with Prim's minimum spanning tree — five point distributions including phyllotaxis fibonacci spiral, edge pruning to fragment the tree into organic subtree clusters, and four colour modes including radial distance gradient",
  algorithmNotes:
    "Prim's algorithm O(N²): start from one node, greedily add the cheapest edge crossing the MST boundary until all nodes are connected. Produces a tree with N−1 edges and no cycles. Pruning: edges are sorted by length and the longest prunePercent% are removed, breaking the single spanning tree into a forest of smaller subtrees — each cluster is still an MST of its local region. Fibonacci distribution uses phyllotaxis: r = sqrt(i/N) * maxRadius, θ = i * π*(3−√5), placing each point at the golden-angle increment, giving the most spatially uniform distribution without any symmetry. Radial colour mode maps the Euclidean distance of each edge's midpoint from the canvas centre to the palette gradient, making the concentric ring structure of the MST visible. Noise drift displaces each node by simplex noise offset from its time=0 position, preserving the stable MST topology while animating positions.",
  parameterSchema,
  defaultParams: {
    pointCount: 400, prunePercent: 0,
    nodeSize: 8, edgeWidth: 4,
    distribution: 'uniform', colorMode: 'palette-cycle',
    background: 'dark', drift: 12, driftSpeed: 0.1,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const pointCount   = Math.max(2, (params.pointCount   ?? 400) | 0);
    const prunePercent = Math.max(0, Math.min(70, params.prunePercent ?? 0));
    const nodeSize     = params.nodeSize   ?? 8;
    const edgeWidth    = params.edgeWidth  ?? 4;
    const distribution = (params.distribution ?? 'uniform') as string;
    const colorMode    = (params.colorMode    ?? 'palette-cycle') as string;
    const background   = (params.background   ?? 'dark') as string;
    const drift        = params.drift      ?? 12;
    const driftSpeed   = params.driftSpeed ?? 0.1;
    const rng = new SeededRNG(seed);

    ctx.fillStyle = background === 'dark' ? '#0a0a0a' : '#f5f5f0';
    ctx.fillRect(0, 0, w, h);

    const margin = Math.min(w, h) * 0.04;
    const iw = w - margin * 2;
    const ih = h - margin * 2;
    const cx = w / 2, cy = h / 2;
    const maxRadius = Math.min(iw, ih) * 0.45;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    // Generate seed positions (deterministic from seed)
    const origPts: [number, number][] = [];
    for (let i = 0; i < pointCount; i++) {
      let px: number, py: number;
      if (distribution === 'gaussian') {
        px = Math.max(margin, Math.min(w - margin, cx + (rng.gaussian(0.5, 0.18) - 0.5) * iw));
        py = Math.max(margin, Math.min(h - margin, cy + (rng.gaussian(0.5, 0.18) - 0.5) * ih));
      } else if (distribution === 'clustered') {
        const ox = margin + rng.random() * iw;
        const oy = margin + rng.random() * ih;
        const angle = rng.random() * Math.PI * 2;
        const radius = rng.random() * iw * 0.12;
        px = Math.max(margin, Math.min(w - margin, ox + Math.cos(angle) * radius));
        py = Math.max(margin, Math.min(h - margin, oy + Math.sin(angle) * radius));
      } else if (distribution === 'ring') {
        const angle = (i / pointCount) * Math.PI * 2 + rng.random() * 0.3;
        const r = (0.35 + rng.random() * 0.07) * Math.min(iw, ih);
        px = cx + Math.cos(angle) * r;
        py = cy + Math.sin(angle) * r;
      } else if (distribution === 'fibonacci') {
        // Phyllotaxis: golden-angle spiral, uniform-density disk
        const r     = Math.sqrt((i + 0.5) / pointCount) * maxRadius;
        const theta = i * goldenAngle;
        px = cx + Math.cos(theta) * r;
        py = cy + Math.sin(theta) * r;
      } else {
        px = margin + rng.random() * iw;
        py = margin + rng.random() * ih;
      }
      origPts.push([px, py]);
    }

    // MST on original positions (stable topology)
    let edges = buildMST(origPts);

    // Prune longest edges to create subtree clusters
    if (prunePercent > 0 && edges.length > 1) {
      const sorted = edges.slice().sort((a, b) => b[2] - a[2]);
      const cutCount = Math.max(1, Math.floor(edges.length * prunePercent / 100));
      const threshold = sorted[cutCount - 1][2];
      edges = edges.filter(e => e[2] < threshold);
    }

    const maxEdgeDist = edges.reduce((m, e) => Math.max(m, e[2]), 0) || 1;
    const diagLen     = Math.sqrt(cx * cx + cy * cy);
    const rgbColors   = palette.colors.map(hexToRgb);

    // Apply noise drift for animation (zero displacement at time=0)
    const noiseInst = new SimplexNoise(seed);
    const pts: [number, number][] = drift > 0 && time > 0
      ? origPts.map(([px, py], i) => [
          px + (noiseInst.noise2D(i * 0.4, time * driftSpeed) - noiseInst.noise2D(i * 0.4, 0)) * drift,
          py + (noiseInst.noise2D(i * 0.4 + 77, time * driftSpeed) - noiseInst.noise2D(i * 0.4 + 77, 0)) * drift,
        ])
      : origPts;

    // Draw edges
    ctx.lineWidth = edgeWidth;
    ctx.lineCap = 'round';
    for (let i = 0; i < edges.length; i++) {
      const [from, to, d] = edges[i];
      const [ax, ay] = pts[from];
      const [bx, by] = pts[to];

      let color: string;
      if (colorMode === 'edge-length') {
        color = lerpColor(rgbColors, d / maxEdgeDist);
      } else if (colorMode === 'depth') {
        color = lerpColor(rgbColors, i / (edges.length - 1 || 1));
      } else if (colorMode === 'radial') {
        // Distance of edge midpoint from canvas centre → palette
        const mx = (ax + bx) / 2 - cx;
        const my = (ay + by) / 2 - cy;
        color = lerpColor(rgbColors, Math.sqrt(mx * mx + my * my) / (diagLen || 1));
      } else {
        // palette-cycle
        color = palette.colors[(from + to) % palette.colors.length];
      }

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Draw nodes
    if (nodeSize > 0) {
      for (let i = 0; i < pts.length; i++) {
        ctx.fillStyle = palette.colors[i % palette.colors.length];
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], nodeSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.04, 0.04, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round((params.pointCount ?? 400) ** 2 / 100); },
};
