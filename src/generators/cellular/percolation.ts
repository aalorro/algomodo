import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Union-Find (Disjoint Set Union) for fast cluster detection
// ---------------------------------------------------------------------------
class UnionFind {
  parent: Int32Array;
  size: Int32Array;

  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.size[i] = 1;
    }
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px === py) return;

    if (this.size[px] < this.size[py]) {
      this.parent[px] = py;
      this.size[py] += this.size[px];
    } else {
      this.parent[py] = px;
      this.size[px] += this.size[py];
    }
  }

  getClusterSizes(): { labels: Int32Array; clusterSizes: Uint32Array; maxSize: number } {
    const cluster_map = new Map<number, number>();
    let clustering = -1;
    const labels = new Int32Array(this.parent.length);

    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!cluster_map.has(root)) {
        cluster_map.set(root, ++clustering);
      }
      labels[i] = cluster_map.get(root)!;
    }

    const num_clusters = cluster_map.size;
    const clusterSizes = new Uint32Array(num_clusters);
    for (let i = 0; i < labels.length; i++) {
      clusterSizes[labels[i]]++;
    }

    let maxSize = 0;
    for (let i = 0; i < clusterSizes.length; i++) {
      if (clusterSizes[i] > maxSize) maxSize = clusterSizes[i];
    }

    return { labels, clusterSizes, maxSize };
  }
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _percAnim: {
  key: string;
  siteValues: Float32Array;   // uniform [0,1) per site — fixed for this seed/size
  size: number;
  p: number;                  // current threshold
  direction: number;          // +1 or -1
} | null = null;

function renderPercolation(
  ctx: CanvasRenderingContext2D,
  occupied: Uint8Array,
  labels: Int32Array,
  clusterSizes: Uint32Array,
  maxSize: number,
  size: number,
  colorMode: string,
  palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cEmpty: [number, number, number] = [10, 10, 10];
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;
  const logMax = maxSize > 1 ? Math.log(maxSize) : 1;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      let r: number, g: number, b: number;

      if (!occupied[idx]) {
        [r, g, b] = cEmpty;
      } else {
        const lb = labels[idx];
        const sz = lb >= 0 ? clusterSizes[lb] : 1;

        if (colorMode === 'cluster-size') {
          const t = logMax > 0 ? Math.log(sz) / logMax : 0;
          const scaled = t * (colors.length - 1);
          const i0 = Math.floor(scaled);
          const i1 = Math.min(colors.length - 1, i0 + 1);
          const frac = scaled - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
        } else if (colorMode === 'cluster-id') {
          // Each cluster gets a repeating palette color
          [r, g, b] = colors[lb % colors.length];
        } else {
          // monochrome: last palette color
          [r, g, b] = colors[colors.length - 1];
        }
      }

      const x0 = Math.floor(cx * cw), x1 = Math.floor((cx + 1) * cw);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * w + px) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Fast cluster detection using Union-Find
function detectClusters(occupied: Uint8Array, size: number): {
  labels: Int32Array;
  clusterSizes: Uint32Array;
  maxSize: number;
} {
  const N = size * size;
  const uf = new UnionFind(N);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!occupied[idx]) continue;

      // Union with right neighbor
      if (x < size - 1) {
        const ri = y * size + (x + 1);
        if (occupied[ri]) uf.union(idx, ri);
      }

      // Union with bottom neighbor
      if (y < size - 1) {
        const bi = (y + 1) * size + x;
        if (occupied[bi]) uf.union(idx, bi);
      }
    }
  }

  return uf.getClusterSizes();
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  gridSize: {
    name: 'Grid Size',
    type: 'number', min: 32, max: 256, step: 16, default: 128,
    group: 'Composition',
  },
  occupancyP: {
    name: 'Occupancy p',
    type: 'number', min: 0, max: 1, step: 0.01, default: 0.593,
    help: 'Site occupancy probability — critical threshold p_c ≈ 0.593 for 2D square lattice',
    group: 'Composition',
  },
  sweepSpeed: {
    name: 'Sweep Speed',
    type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'How fast p oscillates across the critical threshold in animation mode',
    group: 'Flow/Motion',
  },
  sweepAmp: {
    name: 'Sweep Amplitude',
    type: 'number', min: 0.05, max: 0.4, step: 0.05, default: 0.2,
    help: 'How far p swings above and below the base value in animation mode',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['cluster-size', 'cluster-id', 'monochrome'],
    default: 'cluster-size',
    help: 'cluster-size: log-scaled palette by cluster area | cluster-id: each cluster a distinct palette color | monochrome: flat',
    group: 'Color',
  },
};

export const percolation: Generator = {
  id: 'cellular-percolation',
  family: 'cellular',
  styleName: 'Percolation',
  definition: 'Site percolation on a square lattice with Union-Find cluster detection — giant connected cluster emerges at the critical threshold p_c ≈ 0.593',
  algorithmNotes:
    'Each site is independently occupied with probability p. Connected clusters are identified via Union-Find with path compression (O(N·α(N)) for N sites). Below p_c all clusters are finite; at p_c cluster sizes follow a power-law; above p_c a system-spanning "giant" cluster appears. In animation mode p sweeps sinusoidally through the critical point so you can watch the phase transition live — the giant cluster snaps in and out of existence.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, occupancyP: 0.593, sweepSpeed: 0.5, sweepAmp: 0.2, colorMode: 'cluster-size',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const colorMode = params.colorMode || 'cluster-size';
    const N = size * size;

    if (time === 0) {
      const p = Math.max(0, Math.min(1, params.occupancyP ?? 0.593));
      const rng = new SeededRNG(seed);
      const occupied = new Uint8Array(N);
      for (let i = 0; i < N; i++) occupied[i] = rng.random() < p ? 1 : 0;
      const { labels, clusterSizes, maxSize } = detectClusters(occupied, size);
      renderPercolation(ctx, occupied, labels, clusterSizes, maxSize, size, colorMode, palette);
      return;
    }

    // Animation: fixed site values, sweep p
    const key = `${seed}|${size}`;
    if (!_percAnim || _percAnim.key !== key) {
      const rng = new SeededRNG(seed);
      const siteValues = new Float32Array(N);
      for (let i = 0; i < N; i++) siteValues[i] = rng.random();
      _percAnim = { key, siteValues, size, p: params.occupancyP ?? 0.593, direction: 1 };
    }

    const baseP = params.occupancyP ?? 0.593;
    const amp = params.sweepAmp ?? 0.2;
    const speed = params.sweepSpeed ?? 0.5;
    const p = Math.max(0, Math.min(1, baseP + amp * Math.sin(time * speed)));

    const occupied = new Uint8Array(N);
    for (let i = 0; i < N; i++) occupied[i] = _percAnim.siteValues[i] < p ? 1 : 0;
    const { labels, clusterSizes, maxSize } = detectClusters(occupied, size);
    renderPercolation(ctx, occupied, labels, clusterSizes, maxSize, size, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 128) ** 2 * 0.005) | 0; },
};
