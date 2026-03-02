import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * One octave of Voronoi ridge noise.
 * All coordinates are normalised to [0, 1]. freq scales the distance so higher
 * octaves produce finer patterns without needing separate site arrays.
 */
function ridgeOctave(nx: number, ny: number, sites: [number, number][], freq: number): number {
  let d1 = Infinity, d2 = Infinity;
  for (const [sx, sy] of sites) {
    const dx = (nx - sx) * freq, dy = (ny - sy) * freq;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return d2 - d1;
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

const parameterSchema: ParameterSchema = {
  cellCount: {
    name: 'Cell Count',
    type: 'number', min: 5, max: 200, step: 5, default: 50,
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves',
    type: 'number', min: 1, max: 5, step: 1, default: 3,
    help: 'Layers of Voronoi stacked at increasing frequencies',
    group: 'Composition',
  },
  lacunarity: {
    name: 'Lacunarity',
    type: 'number', min: 1.2, max: 4, step: 0.1, default: 2.0,
    help: 'Frequency multiplier per octave',
    group: 'Geometry',
  },
  gain: {
    name: 'Gain',
    type: 'number', min: 0.2, max: 0.8, step: 0.05, default: 0.5,
    help: 'Amplitude multiplier per octave',
    group: 'Geometry',
  },
  ridgeSharpness: {
    name: 'Ridge Sharpness',
    type: 'number', min: 0.5, max: 4, step: 0.1, default: 1.5,
    help: 'Power curve applied to ridge values — higher = sharper peaks',
    group: 'Texture',
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
  definition: 'Stacks multiple octaves of Voronoi f₂−f₁ noise to produce mountain-ridge-like terrain patterns',
  algorithmNotes: 'Each octave uses a fresh jittered-grid set of sites in normalised [0,1] coordinates. Frequency scaling is applied to the distance computation per octave. Contributions are summed with gain decay and power-curved for sharper ridges.',
  parameterSchema,
  defaultParams: {
    cellCount: 50, octaves: 3, lacunarity: 2.0, gain: 0.5, ridgeSharpness: 1.5,
    colorMode: 'palette', animSpeed: 0.3, animAmp: 0.15,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const oct = Math.max(1, (params.octaves ?? 3) | 0);
    const count = Math.max(5, (params.cellCount ?? 50) | 0);
    const lac = params.lacunarity ?? 2.0;
    const g = params.gain ?? 0.5;
    const sharpness = params.ridgeSharpness ?? 1.5;
    const colorMode = params.colorMode || 'palette';

    // Sites in normalised [0,1] space — one set per octave
    const baseSitesPerOctave: [number, number][][] = [];
    for (let o = 0; o < oct; o++) {
      baseSitesPerOctave.push(jitteredGridNorm(count, rng));
    }

    // Animation amplitude in normalised space (avgCellSize_norm = sqrt(1/count))
    const avgCellNorm = Math.sqrt(1.0 / count);
    const animAmpNorm = (params.animAmp ?? 0.15) * avgCellNorm;
    const animSpeed = params.animSpeed ?? 0.3;

    const sitesPerOctave = baseSitesPerOctave.map(base =>
      time > 0 && animAmpNorm > 0
        ? animateSites(base, animAmpNorm, animSpeed, time)
        : base
    );

    const colors = palette.colors.map(hexToRgb);
    const step = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Pass 1: compute raw ridge values and find actual maximum for auto-scaling
    const sw = Math.ceil(w / step), sh = Math.ceil(h / step);
    const raw = new Float32Array(sw * sh);
    let rawMax = 0;

    for (let yi = 0; yi < sh; yi++) {
      for (let xi = 0; xi < sw; xi++) {
        const nx = (xi * step) / w, ny = (yi * step) / h;
        let value = 0, amplitude = 1.0, freq = 1.0;
        for (let o = 0; o < oct; o++) {
          value += ridgeOctave(nx, ny, sitesPerOctave[o], freq) * amplitude;
          amplitude *= g;
          freq *= lac;
        }
        raw[yi * sw + xi] = value;
        if (value > rawMax) rawMax = value;
      }
    }

    rawMax = Math.max(rawMax, 1e-6);

    // Pass 2: normalize against actual max, apply sharpness, map to color
    for (let yi = 0; yi < sh; yi++) {
      for (let xi = 0; xi < sw; xi++) {
        let t = raw[yi * sw + xi] / rawMax;
        t = Math.pow(t, sharpness);

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
