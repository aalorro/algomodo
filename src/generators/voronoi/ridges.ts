import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Jittered grid in normalised [0,1] space */
function jitteredGridNorm(count: number, rng: SeededRNG): [number, number][] {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cw = 1 / cols, ch = 1 / rows;
  const pts: [number, number][] = [];
  for (let r = 0; r < rows && pts.length < count; r++) {
    for (let c = 0; c < cols && pts.length < count; c++) {
      pts.push([(c + 0.2 + rng.random() * 0.6) * cw, (r + 0.2 + rng.random() * 0.6) * ch]);
    }
  }
  while (pts.length < count) pts.push([rng.random(), rng.random()]);
  return pts;
}

function animateSites(base: [number, number][], amp: number, speed: number, time: number): [number, number][] {
  return base.map(([bx, by], i) => {
    const ph = i * 2.39996;
    return [bx + Math.cos(time * speed + ph) * amp, by + Math.sin(time * speed * 1.3 + ph * 1.7) * amp];
  });
}

// ── Spatial grid for fast f1/f2 Voronoi lookup ──────────────────────────

interface SiteGrid {
  cells: Int32Array;   // flattened: cells[offset .. offset+len) = site indices
  offsets: Int32Array;  // offset into cells for grid cell i
  counts: Int32Array;   // number of sites in grid cell i
  size: number;         // grid dimension (size × size)
}

function buildSiteGrid(sites: [number, number][], gridSize: number): SiteGrid {
  const n = gridSize * gridSize;
  const counts = new Int32Array(n);

  for (const [sx, sy] of sites) {
    const gx = Math.min(gridSize - 1, Math.max(0, (sx * gridSize) | 0));
    const gy = Math.min(gridSize - 1, Math.max(0, (sy * gridSize) | 0));
    counts[gy * gridSize + gx]++;
  }

  const offsets = new Int32Array(n);
  for (let i = 1; i < n; i++) offsets[i] = offsets[i - 1] + counts[i - 1];

  const total = offsets[n - 1] + counts[n - 1];
  const cells = new Int32Array(total);
  const pos = new Int32Array(n);

  for (let i = 0; i < sites.length; i++) {
    const gx = Math.min(gridSize - 1, Math.max(0, (sites[i][0] * gridSize) | 0));
    const gy = Math.min(gridSize - 1, Math.max(0, (sites[i][1] * gridSize) | 0));
    const ci = gy * gridSize + gx;
    cells[offsets[ci] + pos[ci]] = i;
    pos[ci]++;
  }

  return { cells, offsets, counts, size: gridSize };
}

/**
 * Fast f2-f1 ridge noise using spatial grid lookup.
 * freq scales distances for multi-octave amplitude balance.
 */
function ridgeOctaveFast(
  nx: number, ny: number,
  sites: [number, number][],
  freq: number,
  grid: SiteGrid,
  metric: number, // 0=euclidean, 1=manhattan, 2=chebyshev
): number {
  const gx = Math.min(grid.size - 1, Math.max(0, (nx * grid.size) | 0));
  const gy = Math.min(grid.size - 1, Math.max(0, (ny * grid.size) | 0));

  let d1 = Infinity, d2 = Infinity;
  const useSquared = metric === 0;
  const searchR = Math.min(3, grid.size - 1);
  for (let dy = -searchR; dy <= searchR; dy++) {
    const cy = gy + dy;
    if (cy < 0 || cy >= grid.size) continue;
    for (let dx = -searchR; dx <= searchR; dx++) {
      const cx = gx + dx;
      if (cx < 0 || cx >= grid.size) continue;
      const ci = cy * grid.size + cx;
      const off = grid.offsets[ci];
      const cnt = grid.counts[ci];
      for (let k = 0; k < cnt; k++) {
        const si = grid.cells[off + k];
        const sdx = (nx - sites[si][0]) * freq;
        const sdy = (ny - sites[si][1]) * freq;
        let d: number;
        if (metric === 1) d = Math.abs(sdx) + Math.abs(sdy);
        else if (metric === 2) d = Math.max(Math.abs(sdx), Math.abs(sdy));
        else d = sdx * sdx + sdy * sdy;
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) { d2 = d; }
      }
    }
  }
  if (useSquared) return Math.sqrt(d2) - Math.sqrt(d1);
  return d2 - d1;
}

const parameterSchema: ParameterSchema = {
  cellCount: {
    name: 'Cell Count',
    type: 'number', min: 10, max: 500, step: 5, default: 80,
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves',
    type: 'number', min: 1, max: 5, step: 1, default: 3,
    help: 'Layers of Voronoi at increasing density — each adds finer ridge detail',
    group: 'Composition',
  },
  lacunarity: {
    name: 'Lacunarity',
    type: 'number', min: 1.2, max: 4, step: 0.1, default: 2.0,
    help: 'Site density multiplier per octave',
    group: 'Geometry',
  },
  gain: {
    name: 'Gain',
    type: 'number', min: 0.2, max: 0.8, step: 0.05, default: 0.5,
    help: 'Amplitude multiplier per octave',
    group: 'Geometry',
  },
  style: {
    name: 'Style',
    type: 'select',
    options: ['crisp', 'smooth'],
    default: 'crisp',
    help: 'crisp: thin bright ridges on dark background | smooth: gradient from ridges to cell centres',
    group: 'Texture',
  },
  ridgeSharpness: {
    name: 'Ridge Sharpness',
    type: 'number', min: 0.5, max: 5, step: 0.1, default: 2.0,
    help: 'Higher = thinner, sharper ridge lines',
    group: 'Texture',
  },
  contrast: {
    name: 'Contrast',
    type: 'number', min: 0.3, max: 3, step: 0.1, default: 1.0,
    help: 'Tonal range — higher compresses mid-tones and boosts separation',
    group: 'Texture',
  },
  distanceMetric: {
    name: 'Distance Metric',
    type: 'select',
    options: ['euclidean', 'manhattan', 'chebyshev'],
    default: 'euclidean',
    help: 'euclidean: round ridges | manhattan: diamond facets | chebyshev: square crystalline',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'greyscale', 'inverted'],
    default: 'palette',
    group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 2, step: 0.05, default: 0.3,
    group: 'Flow/Motion',
  },
  animAmp: {
    name: 'Anim Amplitude',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.15,
    help: 'Drift distance as a fraction of average cell size',
    group: 'Flow/Motion',
  },
};

export const ridges: Generator = {
  id: 'voronoi-ridges',
  family: 'voronoi',
  styleName: 'Ridges',
  definition: 'Stacks multiple octaves of Voronoi f2-f1 noise to produce mountain-ridge-like terrain patterns with crisp cell boundaries',
  algorithmNotes: 'Each octave generates an independent jittered-grid site set at increasing density (count × lacunarity^o), providing genuine multi-scale detail. Higher octaves add finer ridge structure rather than just scaling distances. Spatial hash grids enable O(1) nearest-neighbor lookups for full-resolution rendering. Crisp mode inverts the f2-f1 field and applies steep power falloff for thin bright ridge lines.',
  parameterSchema,
  defaultParams: {
    cellCount: 80, octaves: 3, lacunarity: 2.0, gain: 0.5,
    style: 'crisp', ridgeSharpness: 2.0, contrast: 1.0,
    distanceMetric: 'euclidean', colorMode: 'palette', animSpeed: 0.3, animAmp: 0.15,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const oct = Math.max(1, (params.octaves ?? 3) | 0);
    const baseCount = Math.max(10, (params.cellCount ?? 80) | 0);
    const lac = params.lacunarity ?? 2.0;
    const gainVal = params.gain ?? 0.5;
    const sharpness = params.ridgeSharpness ?? 2.0;
    const contrast = params.contrast ?? 1.0;
    const style = params.style || 'crisp';
    const colorMode = params.colorMode || 'palette';
    const metricName = params.distanceMetric || 'euclidean';
    const metric = metricName === 'manhattan' ? 1 : metricName === 'chebyshev' ? 2 : 0;

    // Per-octave: independent site sets with increasing density for genuine fine detail
    const sitesPerOctave: [number, number][][] = [];
    const gridsPerOctave: SiteGrid[] = [];

    for (let o = 0; o < oct; o++) {
      const octCount = Math.min(1200, Math.round(baseCount * Math.pow(lac, o)));
      const baseSites = jitteredGridNorm(octCount, rng);

      // Animation: scale amplitude relative to this octave's cell spacing
      const avgCell = Math.sqrt(1.0 / octCount);
      const amp = (params.animAmp ?? 0.15) * avgCell;
      const spd = params.animSpeed ?? 0.3;
      const sites = time > 0 && amp > 0 ? animateSites(baseSites, amp, spd, time) : baseSites;

      sitesPerOctave.push(sites);
      // Grid size proportional to sqrt(sites) for balanced cell occupancy
      const gs = Math.max(4, Math.ceil(Math.sqrt(octCount) * 0.8));
      gridsPerOctave.push(buildSiteGrid(sites, gs));
    }

    const colors = palette.colors.map(hexToRgb);
    const step = quality === 'draft' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Pass 1: compute raw ridge values
    const sw = Math.ceil(w / step), sh = Math.ceil(h / step);
    const raw = new Float32Array(sw * sh);
    let rawSum = 0, rawMax = 0;

    for (let yi = 0; yi < sh; yi++) {
      const ny = (yi * step) / h;
      for (let xi = 0; xi < sw; xi++) {
        const nx = (xi * step) / w;
        let value = 0, amplitude = 1.0, freq = 1.0;
        for (let o = 0; o < oct; o++) {
          value += ridgeOctaveFast(nx, ny, sitesPerOctave[o], freq, gridsPerOctave[o], metric) * amplitude;
          amplitude *= gainVal;
          freq *= lac;
        }
        const v = isFinite(value) ? Math.max(0, value) : 0;
        const idx = yi * sw + xi;
        raw[idx] = v;
        rawSum += v;
        if (v > rawMax) rawMax = v;
      }
    }

    // Mean-based normalization: much better contrast than rawMax
    const rawMean = rawSum / (sw * sh);
    const normTarget = rawMean > 1e-8
      ? rawMean * (3.0 / Math.max(0.3, contrast))
      : Math.max(rawMax, 1e-6);

    // Pass 2: normalize, apply style + sharpness, map to color
    for (let yi = 0; yi < sh; yi++) {
      for (let xi = 0; xi < sw; xi++) {
        let t = Math.min(1, raw[yi * sw + xi] / normTarget);

        if (style === 'crisp') {
          // Invert: ridges (f2-f1 ≈ 0) become bright, cell centres dark
          t = 1 - t;
          // Steep power falloff: only thin ridge areas stay bright
          t = Math.pow(t, sharpness);
        } else {
          // Smooth: cell centres bright, ridges dark (original style, improved)
          t = Math.pow(t, sharpness);
        }

        let r: number, g2: number, b: number;
        if (colorMode === 'greyscale') {
          const v = (t * 255) | 0; r = g2 = b = v;
        } else if (colorMode === 'inverted') {
          const v = ((1 - t) * 255) | 0; r = g2 = b = v;
        } else {
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          r  = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          g2 = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          b  = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        }

        const x = xi * step, y = yi * step;
        for (let sy = 0; sy < step && y + sy < h; sy++) {
          for (let sx = 0; sx < step && x + sx < w; sx++) {
            const idx = ((y + sy) * w + (x + sx)) * 4;
            data[idx] = r; data[idx + 1] = g2; data[idx + 2] = b; data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const c = gl.canvas as HTMLCanvasElement;
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    this.renderCanvas2D!(tmp.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost: (p) => p.cellCount * (p.octaves ?? 3) * 300,
};
