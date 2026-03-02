import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count',
    type: 'number', min: 10, max: 600, step: 10, default: 400,
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
    options: ['uniform', 'gaussian', 'clustered', 'ring'],
    default: 'uniform',
    help: 'Spatial distribution of nodes',
    group: 'Composition',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-cycle', 'edge-length', 'depth'],
    default: 'palette-cycle',
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

  const inMST = new Uint8Array(n);
  const minDist = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  minDist[0] = 0;

  const edges: [number, number, number][] = []; // [from, to, dist]

  for (let step = 0; step < n; step++) {
    // Pick cheapest non-MST node
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inMST[i] && (u === -1 || minDist[i] < minDist[u])) u = i;
    }
    if (u === -1) break;
    inMST[u] = 1;

    if (parent[u] !== -1) {
      edges.push([parent[u], u, dist(pts[parent[u]][0], pts[parent[u]][1], pts[u][0], pts[u][1])]);
    }

    // Update distances
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
  definition: 'Connects a field of nodes with the minimum-length spanning tree, forming elegant organic web structures',
  algorithmNotes: "Uses Prim's algorithm to build the MST over a set of seed-distributed points. Edges colored by palette cycle, length, or spanning depth.",
  parameterSchema,
  defaultParams: { pointCount: 400, nodeSize: 8, edgeWidth: 4, distribution: 'uniform', colorMode: 'palette-cycle', background: 'dark', drift: 12, driftSpeed: 0.1 },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const pointCount = params.pointCount ?? 400;
    const nodeSize = params.nodeSize ?? 8;
    const edgeWidth = params.edgeWidth ?? 4;
    const distribution = params.distribution ?? 'uniform';
    const colorMode = params.colorMode ?? 'palette-cycle';
    const background = params.background ?? 'dark';
    const drift = params.drift ?? 12;
    const driftSpeed = params.driftSpeed ?? 0.1;
    const rng = new SeededRNG(seed);

    ctx.fillStyle = background === 'dark' ? '#0a0a0a' : '#f5f5f0';
    ctx.fillRect(0, 0, w, h);

    const margin = Math.min(w, h) * 0.01;
    const iw = w - margin * 2;
    const ih = h - margin * 2;

    // Generate seed positions (deterministic from seed)
    const origPts: [number, number][] = [];
    for (let i = 0; i < pointCount; i++) {
      let px: number, py: number;
      if (distribution === 'gaussian') {
        // Centre the distribution at canvas centre; gaussian(0.5,0.18)-0.5 has mean=0, std=0.18
        px = Math.max(margin, Math.min(w - margin, w / 2 + (rng.gaussian(0.5, 0.18) - 0.5) * iw));
        py = Math.max(margin, Math.min(h - margin, h / 2 + (rng.gaussian(0.5, 0.18) - 0.5) * ih));
      } else if (distribution === 'clustered') {
        const cx = margin + rng.random() * iw;
        const cy = margin + rng.random() * ih;
        const angle = rng.random() * Math.PI * 2;
        const radius = rng.random() * iw * 0.12;
        px = cx + Math.cos(angle) * radius;
        py = cy + Math.sin(angle) * radius;
        px = Math.max(margin, Math.min(w - margin, px));
        py = Math.max(margin, Math.min(h - margin, py));
      } else if (distribution === 'ring') {
        const angle = (i / pointCount) * Math.PI * 2 + rng.random() * 0.3;
        const r = (0.35 + rng.random() * 0.07) * Math.min(iw, ih);
        px = w / 2 + Math.cos(angle) * r;
        py = h / 2 + Math.sin(angle) * r;
      } else {
        px = margin + rng.random() * iw;
        py = margin + rng.random() * ih;
      }
      origPts.push([px, py]);
    }

    // MST on original positions (stable topology)
    const edges = buildMST(origPts);
    const maxEdgeDist = edges.reduce((m, e) => Math.max(m, e[2]), 0) || 1;

    // Apply noise drift for animation (zero displacement at time=0)
    const driftAmt = drift ?? 12;
    const driftSpd = driftSpeed ?? 0.1;
    const noiseInst = new SimplexNoise(seed);
    const pts: [number, number][] = driftAmt > 0 && time > 0
      ? origPts.map(([px, py], i) => [
          px + (noiseInst.noise2D(i * 0.4, time * driftSpd) - noiseInst.noise2D(i * 0.4, 0)) * driftAmt,
          py + (noiseInst.noise2D(i * 0.4 + 77, time * driftSpd) - noiseInst.noise2D(i * 0.4 + 77, 0)) * driftAmt,
        ])
      : origPts;

    // Draw edges
    ctx.lineWidth = edgeWidth;
    edges.forEach(([from, to, d], i) => {
      const [ax, ay] = pts[from];
      const [bx, by] = pts[to];

      let color: string;
      if (colorMode === 'edge-length') {
        const t = d / maxEdgeDist;
        const ci = t * (palette.colors.length - 1);
        const c0 = Math.floor(ci), c1 = Math.min(c0 + 1, palette.colors.length - 1);
        const frac = ci - c0;
        const [r0, g0, b0] = hexToRgb(palette.colors[c0]);
        const [r1, g1, b1] = hexToRgb(palette.colors[c1]);
        color = `rgb(${(r0 + (r1 - r0) * frac) | 0},${(g0 + (g1 - g0) * frac) | 0},${(b0 + (b1 - b0) * frac) | 0})`;
      } else if (colorMode === 'depth') {
        const t = i / edges.length;
        const ci = t * (palette.colors.length - 1);
        const c0 = Math.floor(ci), c1 = Math.min(c0 + 1, palette.colors.length - 1);
        const frac = ci - c0;
        const [r0, g0, b0] = hexToRgb(palette.colors[c0]);
        const [r1, g1, b1] = hexToRgb(palette.colors[c1]);
        color = `rgb(${(r0 + (r1 - r0) * frac) | 0},${(g0 + (g1 - g0) * frac) | 0},${(b0 + (b1 - b0) * frac) | 0})`;
      } else {
        color = palette.colors[(from + to) % palette.colors.length];
      }

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    });

    // Draw nodes
    if (nodeSize > 0) {
      pts.forEach(([px, py], i) => {
        const col = palette.colors[i % palette.colors.length];
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, py, nodeSize, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.04, 0.04, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(params.pointCount ** 2 / 100); },
};
