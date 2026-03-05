import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Min-Heap for invasion percolation priority queue
// ---------------------------------------------------------------------------
class MinHeap {
  private data: Float64Array;
  private idx: Int32Array;
  private len = 0;

  constructor(capacity: number) {
    this.data = new Float64Array(capacity);
    this.idx = new Int32Array(capacity);
  }

  push(resistance: number, siteIdx: number): void {
    let i = this.len++;
    this.data[i] = resistance;
    this.idx[i] = siteIdx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p] > this.data[i]) { this._swap(p, i); i = p; }
      else break;
    }
  }

  pop(): number {
    const topIdx = this.idx[0];
    const last = --this.len;
    if (last > 0) {
      this.data[0] = this.data[last];
      this.idx[0] = this.idx[last];
      let i = 0;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < this.len && this.data[l] < this.data[s]) s = l;
        if (r < this.len && this.data[r] < this.data[s]) s = r;
        if (s !== i) { this._swap(i, s); i = s; } else break;
      }
    }
    return topIdx;
  }

  private _swap(a: number, b: number): void {
    const td = this.data[a], ti = this.idx[a];
    this.data[a] = this.data[b]; this.idx[a] = this.idx[b];
    this.data[b] = td; this.idx[b] = ti;
  }

  reset(): void { this.len = 0; }
  get size(): number { return this.len; }
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
    for (let i = 0; i < n; i++) { this.parent[i] = i; this.size[i] = 1; }
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }

  union(x: number, y: number): void {
    const px = this.find(x), py = this.find(y);
    if (px === py) return;
    if (this.size[px] < this.size[py]) { this.parent[px] = py; this.size[py] += this.size[px]; }
    else { this.parent[py] = px; this.size[px] += this.size[py]; }
  }

  getClusterSizes(): { labels: Int32Array; clusterSizes: Uint32Array; maxSize: number } {
    const cluster_map = new Map<number, number>();
    let clustering = -1;
    const labels = new Int32Array(this.parent.length);
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!cluster_map.has(root)) cluster_map.set(root, ++clustering);
      labels[i] = cluster_map.get(root)!;
    }
    const num_clusters = cluster_map.size;
    const clusterSizes = new Uint32Array(num_clusters);
    for (let i = 0; i < labels.length; i++) clusterSizes[labels[i]]++;
    let maxSize = 0;
    for (let i = 0; i < clusterSizes.length; i++) if (clusterSizes[i] > maxSize) maxSize = clusterSizes[i];
    return { labels, clusterSizes, maxSize };
  }
}

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _percAnim: {
  key: string;
  siteValues: Float32Array;
  size: number;
  // Cached scratch buffers for invasion mode
  invasionOccupied: Uint8Array;
  invasionFrontier: Uint8Array;
  invasionHeap: MinHeap;
} | null = null;

// ---------------------------------------------------------------------------
// Site value generation — blend RNG with correlated simplex noise
// ---------------------------------------------------------------------------
function generateSiteValues(seed: number, size: number, noiseMix: number, noiseScale: number): Float32Array {
  const N = size * size;
  const rng = new SeededRNG(seed);
  const vals = new Float32Array(N);
  if (noiseMix <= 0) {
    for (let i = 0; i < N; i++) vals[i] = rng.random();
    return vals;
  }
  const noise = new SimplexNoise(seed ^ 0xDEADBEEF);
  const freq = noiseScale / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rand = rng.random();
      const n = (noise.fbm(x * freq, y * freq, 4) + 1) * 0.5;
      vals[y * size + x] = rand * (1 - noiseMix) + n * noiseMix;
    }
  }
  return vals;
}

// ---------------------------------------------------------------------------
// Cluster detection with spanning
// ---------------------------------------------------------------------------
function detectClusters(occupied: Uint8Array, size: number, showSpanning: boolean): {
  labels: Int32Array; clusterSizes: Uint32Array; maxSize: number; spanningLabels: Set<number>;
} {
  const N = size * size;
  const uf = new UnionFind(N);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!occupied[idx]) continue;
      if (x < size - 1 && occupied[y * size + x + 1]) uf.union(idx, y * size + x + 1);
      if (y < size - 1 && occupied[(y + 1) * size + x]) uf.union(idx, (y + 1) * size + x);
    }
  }
  const { labels, clusterSizes, maxSize } = uf.getClusterSizes();
  const spanningLabels = new Set<number>();
  if (showSpanning) {
    const topSet = new Set<number>(), botSet = new Set<number>();
    for (let x = 0; x < size; x++) {
      if (occupied[x]) topSet.add(labels[x]);
      if (occupied[(size - 1) * size + x]) botSet.add(labels[(size - 1) * size + x]);
    }
    for (const lb of topSet) if (botSet.has(lb)) spanningLabels.add(lb);
  }
  return { labels, clusterSizes, maxSize, spanningLabels };
}

// ---------------------------------------------------------------------------
// Invasion percolation helpers
// ---------------------------------------------------------------------------
function addNeighbors(
  idx: number, size: number,
  occupied: Uint8Array, inFrontier: Uint8Array,
  heap: MinHeap, siteValues: Float32Array,
): void {
  const x = idx % size, y = (idx / size) | 0;
  const ns = [
    y * size + (x + 1) % size,
    y * size + (x - 1 + size) % size,
    ((y + 1) % size) * size + x,
    ((y - 1 + size) % size) * size + x,
  ];
  for (const ni of ns) {
    if (!occupied[ni] && !inFrontier[ni]) {
      heap.push(siteValues[ni], ni);
      inFrontier[ni] = 1;
    }
  }
}

function runInvasion(
  siteValues: Float32Array, size: number, numSeeds: number, seed: number, targetOpen: number,
  occupied: Uint8Array, inFrontier: Uint8Array, heap: MinHeap,
): void {
  occupied.fill(0);
  inFrontier.fill(0);
  heap.reset();
  const rng = new SeededRNG(seed ^ 0xBEEF5EED);
  let openCount = 0;
  for (let i = 0; i < numSeeds; i++) {
    const x = (rng.random() * size) | 0;
    const y = (rng.random() * size) | 0;
    const idx = y * size + x;
    if (!occupied[idx]) {
      occupied[idx] = 1;
      openCount++;
      addNeighbors(idx, size, occupied, inFrontier, heap, siteValues);
    }
  }
  while (openCount < targetOpen && heap.size > 0) {
    const ni = heap.pop();
    if (!occupied[ni]) {
      occupied[ni] = 1;
      openCount++;
      addNeighbors(ni, size, occupied, inFrontier, heap, siteValues);
    }
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderPercolation(
  ctx: CanvasRenderingContext2D,
  occupied: Uint8Array,
  labels: Int32Array,
  clusterSizes: Uint32Array,
  maxSize: number,
  spanningLabels: Set<number>,
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
        // Spanning cluster rendered white
        if (spanningLabels.size > 0 && spanningLabels.has(lb)) {
          r = 255; g = 255; b = 255;
        } else {
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
            [r, g, b] = colors[lb % colors.length];
          } else {
            [r, g, b] = colors[colors.length - 1];
          }
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

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  gridSize: {
    name: 'Grid Size',
    type: 'number', min: 32, max: 256, step: 16, default: 128,
    group: 'Composition',
  },
  percolationMode: {
    name: 'Mode',
    type: 'select',
    options: ['site', 'invasion'],
    default: 'site',
    help: 'site: each cell independently open with probability p | invasion: fractal BFS flooding from seeds in resistance order — creates branching drainage networks',
    group: 'Composition',
  },
  occupancyP: {
    name: 'Occupancy p',
    type: 'number', min: 0, max: 1, step: 0.01, default: 0.593,
    help: 'Open probability / swept fraction — critical threshold p_c ≈ 0.593 for square lattice; invasion mode opens exactly p·N cells',
    group: 'Composition',
  },
  invasionSeeds: {
    name: 'Invasion Seeds',
    type: 'number', min: 1, max: 12, step: 1, default: 4,
    help: 'Number of seed points from which invasion floods outward (invasion mode only)',
    group: 'Composition',
  },
  noiseMix: {
    name: 'Noise Mix',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    help: '0 = purely random site values → standard fractal percolation | 1 = fully correlated noise → geologic / organic blob shapes',
    group: 'Texture',
  },
  noiseScale: {
    name: 'Noise Scale',
    type: 'number', min: 1, max: 20, step: 1, default: 6,
    help: 'Spatial frequency of correlated noise — lower = large geologic blobs, higher = fine-grained texture',
    group: 'Texture',
  },
  showSpanning: {
    name: 'Show Spanning',
    type: 'select',
    options: ['on', 'off'],
    default: 'on',
    help: 'Highlight in white the cluster that bridges top edge to bottom edge — marks the percolating backbone',
    group: 'Color',
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
  definition: 'Site and invasion percolation on a square lattice — noise-correlated site values create organic cluster shapes, invasion mode produces fractal drainage networks, and the spanning cluster is highlighted as it snaps in at the critical threshold p_c ≈ 0.593',
  algorithmNotes:
    'Site mode: each cell is independently open with probability p, optionally blended with spatially correlated FBM simplex noise (noiseMix) to produce geologic/organic shapes rather than purely random clusters. Invasion mode: cells are flooded from random seeds via min-heap BFS always opening the lowest-resistance adjacent cell — this produces fractal, tree-like drainage networks characteristic of invasion percolation. Clusters identified via Union-Find with path compression. Spanning detection checks for any cluster bridging the top and bottom rows (highlighted white). In animation mode p sweeps sinusoidally through p_c ≈ 0.593 so the giant cluster appears and vanishes.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, occupancyP: 0.593,
    percolationMode: 'site', invasionSeeds: 4,
    noiseMix: 0.3, noiseScale: 6,
    showSpanning: 'on',
    sweepSpeed: 0.5, sweepAmp: 0.2, colorMode: 'cluster-size',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const colorMode = params.colorMode || 'cluster-size';
    const N = size * size;
    const percolationMode = params.percolationMode ?? 'site';
    const noiseMix = Math.max(0, Math.min(1, params.noiseMix ?? 0.3));
    const noiseScale = Math.max(1, params.noiseScale ?? 6);
    const showSpanning = (params.showSpanning ?? 'on') === 'on';
    const invasionSeeds = Math.max(1, (params.invasionSeeds ?? 4) | 0);
    const baseP = Math.max(0, Math.min(1, params.occupancyP ?? 0.593));

    const key = `${seed}|${size}|${noiseMix}|${noiseScale}|${params._renderKey ?? 0}`;
    if (!_percAnim || _percAnim.key !== key) {
      _percAnim = {
        key,
        siteValues: generateSiteValues(seed, size, noiseMix, noiseScale),
        size,
        invasionOccupied: new Uint8Array(N),
        invasionFrontier: new Uint8Array(N),
        invasionHeap: new MinHeap(N * 4),
      };
    }

    const siteValues = _percAnim.siteValues;
    const p = time === 0
      ? baseP
      : Math.max(0, Math.min(1, baseP + (params.sweepAmp ?? 0.2) * Math.sin(time * (params.sweepSpeed ?? 0.5))));

    let occupied: Uint8Array;
    if (percolationMode === 'invasion') {
      runInvasion(siteValues, size, invasionSeeds, seed, Math.floor(p * N),
        _percAnim.invasionOccupied, _percAnim.invasionFrontier, _percAnim.invasionHeap);
      occupied = _percAnim.invasionOccupied;
    } else {
      occupied = new Uint8Array(N);
      for (let i = 0; i < N; i++) occupied[i] = siteValues[i] < p ? 1 : 0;
    }

    const { labels, clusterSizes, maxSize, spanningLabels } = detectClusters(occupied, size, showSpanning);
    renderPercolation(ctx, occupied, labels, clusterSizes, maxSize, spanningLabels, size, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const N = (params.gridSize ?? 128) ** 2;
    const modeScale = params.percolationMode === 'invasion' ? 3 : 1;
    return (N * 0.005 * modeScale) | 0;
  },
};
