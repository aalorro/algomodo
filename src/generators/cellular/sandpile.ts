import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TOPPLE_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// Persistent animation state
// ---------------------------------------------------------------------------
let _sandAnim: {
  key: string;
  grains: Int32Array;
  toppleCount: Uint32Array;
  lastToppleStep: Uint32Array;  // frame index of last topple (for avalanche vis)
  pendingStack: number[];       // unstable cells carried across frames
  size: number;
  totalDropped: number;
  frameIndex: number;
} | null = null;

function initSandpile(size: number) {
  const N = size * size;
  return {
    grains: new Int32Array(N),
    toppleCount: new Uint32Array(N),
    lastToppleStep: new Uint32Array(N),
    pendingStack: [] as number[],
  };
}

// Drop `amount` grains at the given drop sites, then topple to stability.
// pendingStack is shared across calls to avoid O(N) re-scan on next call.
function addAndTopple(
  grains: Int32Array, toppleCount: Uint32Array, lastToppleStep: Uint32Array,
  pendingStack: number[],
  size: number, dropSites: [number, number][],
  amount: number, maxTopples: number, frameIndex: number,
): number {
  for (const [dx, dy] of dropSites) {
    for (let g = 0; g < amount; g++) {
      const idx = dy * size + dx;
      grains[idx]++;
      if (grains[idx] >= TOPPLE_THRESHOLD) {
        pendingStack.push(idx); // duplicates are fine: the topple loop guards with grains[i] < THRESHOLD
      }
    }
  }

  let topples = 0;
  while (pendingStack.length > 0 && topples < maxTopples) {
    const i = pendingStack.pop()!;
    if (grains[i] < TOPPLE_THRESHOLD) continue;
    const x = i % size, y = (i / size) | 0;
    const fall = (grains[i] / TOPPLE_THRESHOLD) | 0;
    grains[i] -= fall * TOPPLE_THRESHOLD;
    toppleCount[i] += fall;
    lastToppleStep[i] = frameIndex;
    topples += fall;

    const nbrs = [
      y > 0        ? (y - 1) * size + x : -1,
      y < size - 1 ? (y + 1) * size + x : -1,
      x > 0        ? y * size + (x - 1) : -1,
      x < size - 1 ? y * size + (x + 1) : -1,
    ];
    for (const ni of nbrs) {
      if (ni < 0) continue; // grains lost off edge
      grains[ni] += fall;
      if (grains[ni] >= TOPPLE_THRESHOLD) pendingStack.push(ni);
    }
  }
  return topples;
}

function renderSandpile(
  ctx: CanvasRenderingContext2D,
  grains: Int32Array, toppleCount: Uint32Array, lastToppleStep: Uint32Array,
  size: number, maxTopple: number,
  colorMode: string, palette: { colors: string[] },
  frameIndex: number,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cw = w / size, ch = h / size;
  const logMax = maxTopple > 1 ? Math.log(maxTopple) : 1;

  // fractal mode: grains 0-3 → full palette gradient
  const fractalColors: [number, number, number][] = [0, 1, 2, 3].map(gc => {
    const t = gc / 3;
    const scaled = t * (colors.length - 1);
    const i0 = Math.floor(scaled);
    const i1 = Math.min(colors.length - 1, i0 + 1);
    const frac = scaled - i0;
    return [
      (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0,
      (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0,
      (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0,
    ];
  });

  // Fixed grain-count colors (palette-anchored)
  const grainColors: [number, number, number][] = [
    [10, 10, 14],
    colors[0] || [60, 30, 120],
    colors[Math.floor(colors.length / 2)] || [180, 90, 20],
    colors[colors.length - 1] || [240, 230, 80],
  ];

  // Avalanche decay window: ~60 frames
  const avalancheWindow = 60;

  for (let cy = 0; cy < size; cy++) {
    const y0 = Math.floor(cy * ch), y1 = Math.floor((cy + 1) * ch);
    for (let cx = 0; cx < size; cx++) {
      const idx = cy * size + cx;
      let r: number, g: number, b: number;

      if (colorMode === 'topple-count') {
        const tc = toppleCount[idx];
        if (tc === 0) {
          r = 10; g = 10; b = 14;
        } else {
          const t = Math.log(tc) / logMax;
          const scaled = Math.min(1, t) * (colors.length - 1);
          const i0 = Math.floor(scaled);
          const i1 = Math.min(colors.length - 1, i0 + 1);
          const frac = scaled - i0;
          r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
          g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
          b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
        }
      } else if (colorMode === 'fractal') {
        const gc = Math.min(3, grains[idx]);
        [r, g, b] = fractalColors[gc];
      } else if (colorMode === 'avalanche') {
        const age = frameIndex - lastToppleStep[idx];
        const glow = age < avalancheWindow ? Math.max(0, 1 - age / avalancheWindow) : 0;
        const gc = Math.min(3, grains[idx]);
        const base = grainColors[gc];
        r = Math.min(255, (base[0] + (255 - base[0]) * glow * 0.9)) | 0;
        g = Math.min(255, (base[1] + (255 - base[1]) * glow * 0.7)) | 0;
        b = Math.min(255, (base[2] + (255 - base[2]) * glow * 0.3)) | 0;
      } else {
        // grain-count: 0,1,2,3 → 4 palette-anchored colors
        const gc = Math.min(3, grains[idx]);
        [r, g, b] = grainColors[gc];
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
// Drop site helpers
// ---------------------------------------------------------------------------
function resolveDropSites(dropSite: string, size: number, frameIndex: number): [number, number][] {
  const cx = (size / 2) | 0, cy = (size / 2) | 0;
  if (dropSite === 'multi') {
    return [
      [(size * 0.3) | 0, (size * 0.3) | 0],
      [(size * 0.7) | 0, (size * 0.3) | 0],
      [(size * 0.3) | 0, (size * 0.7) | 0],
      [(size * 0.7) | 0, (size * 0.7) | 0],
    ];
  } else if (dropSite === 'drift') {
    const angle = frameIndex * 0.03;
    const r = size * 0.18;
    return [[
      Math.round(cx + Math.cos(angle) * r),
      Math.round(cy + Math.sin(angle) * r),
    ]];
  }
  return [[cx, cy]]; // 'center' (default)
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
  totalGrains: {
    name: 'Total Grains (static)',
    type: 'number', min: 1000, max: 500000, step: 1000, default: 100000,
    help: 'Grains dropped before static render',
    group: 'Composition',
  },
  grainsPerFrame: {
    name: 'Grains / Frame',
    type: 'number', min: 1, max: 200, step: 5, default: 20,
    help: 'Grains added per animation frame',
    group: 'Flow/Motion',
  },
  maxTopples: {
    name: 'Max Topples / Frame',
    type: 'number', min: 100, max: 100000, step: 100, default: 5000,
    help: 'Cap on toppling per frame — prevents frame drops; pattern will catch up over time',
    group: 'Flow/Motion',
  },
  dropSite: {
    name: 'Drop Site',
    type: 'select',
    options: ['center', 'multi', 'drift'],
    default: 'center',
    help: 'center: classic self-similar pattern | multi: 4 sites at quarter positions | drift: drop site orbits slowly',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['grain-count', 'fractal', 'topple-count', 'avalanche'],
    default: 'grain-count',
    help: 'grain-count: 4-level by grains | fractal: full palette across grain levels | topple-count: log-scale by topple history | avalanche: recently toppled cells glow',
    group: 'Color',
  },
};

export const sandpile: Generator = {
  id: 'cellular-sandpile',
  family: 'cellular',
  styleName: 'Sandpile',
  definition: 'Abelian BTW sandpile model — grains dropped at one or more sites topple outward producing self-similar fractal patterns with power-law avalanche statistics',
  algorithmNotes:
    'Any cell with ≥4 grains fires: it loses 4 grains and each cardinal neighbour gains 1 (boundary grains are lost). The toppling stack is maintained across animation frames to avoid O(N) re-scans. "multi" drop places grains at four quarter-grid sites simultaneously, breaking the four-fold symmetry and producing overlapping interference patterns. "drift" slowly orbits the drop point, carving a trail. The "avalanche" colour mode highlights recently toppled cells with a warm glow, revealing the instantaneous wavefront of each sand avalanche.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, totalGrains: 100000, grainsPerFrame: 20,
    maxTopples: 5000, dropSite: 'center', colorMode: 'grain-count',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const size = Math.max(16, (params.gridSize ?? 128) | 0);
    const colorMode = params.colorMode || 'grain-count';
    const dropSite = params.dropSite || 'center';

    if (time === 0) {
      const { grains, toppleCount, lastToppleStep, pendingStack } = initSandpile(size);
      const total = Math.max(1, (params.totalGrains ?? 100000) | 0);
      const sites = resolveDropSites(dropSite, size, 0);
      // Drop in batches to stay responsive
      const batchSize = 1000;
      let dropped = 0;
      while (dropped < total) {
        const batch = Math.min(batchSize, total - dropped);
        addAndTopple(grains, toppleCount, lastToppleStep, pendingStack, size, sites, batch, 100_000_000, 0);
        dropped += batch;
      }
      const maxTopple = toppleCount.reduce((a, b) => Math.max(a, b), 0);
      renderSandpile(ctx, grains, toppleCount, lastToppleStep, size, maxTopple, colorMode, palette, 0);
      return;
    }

    const key = `${seed}|${size}|${dropSite}|${params._renderKey ?? 0}`;
    if (!_sandAnim || _sandAnim.key !== key) {
      const { grains, toppleCount, lastToppleStep, pendingStack } = initSandpile(size);
      _sandAnim = { key, grains, toppleCount, lastToppleStep, pendingStack, size, totalDropped: 0, frameIndex: 0 };
    }

    _sandAnim.frameIndex++;
    const gpf = Math.max(1, (params.grainsPerFrame ?? 20) | 0);
    const maxT = Math.max(100, (params.maxTopples ?? 5000) | 0);
    const sites = resolveDropSites(dropSite, _sandAnim.size, _sandAnim.frameIndex);
    addAndTopple(
      _sandAnim.grains, _sandAnim.toppleCount, _sandAnim.lastToppleStep,
      _sandAnim.pendingStack, _sandAnim.size, sites,
      gpf, maxT, _sandAnim.frameIndex,
    );
    _sandAnim.totalDropped += gpf * sites.length;

    const maxTopple = _sandAnim.toppleCount.reduce((a, b) => Math.max(a, b), 0);
    renderSandpile(ctx, _sandAnim.grains, _sandAnim.toppleCount, _sandAnim.lastToppleStep, _sandAnim.size, maxTopple, colorMode, palette, _sandAnim.frameIndex);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.totalGrains ?? 100000) * 0.001) | 0; },
};
