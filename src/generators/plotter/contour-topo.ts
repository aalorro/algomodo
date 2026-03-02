import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

// Marching squares lookup: case index = TL*8|TR*4|BR*2|BL*1
// Each entry is a list of [edgeA, edgeB] pairs to connect.
// Edges: 0=top, 1=right, 2=bottom, 3=left
const MS: [number, number][][] = [
  [],              // 0000
  [[3, 2]],        // 0001 BL
  [[2, 1]],        // 0010 BR
  [[3, 1]],        // 0011 BL+BR
  [[0, 1]],        // 0100 TR
  [[0,1],[3,2]],   // 0101 TR+BL saddle
  [[0, 2]],        // 0110 TR+BR
  [[3, 0]],        // 0111 (not TL)
  [[3, 0]],        // 1000 TL
  [[0, 2]],        // 1001 TL+BL
  [[3,0],[2,1]],   // 1010 TL+BR saddle
  [[0, 1]],        // 1011 (not TR)
  [[3, 1]],        // 1100 TL+TR
  [[2, 1]],        // 1101 (not BR)
  [[3, 2]],        // 1110 (not BL)
  [],              // 1111
];

/** Linearly interpolated position along a cell edge. */
function edgePt(
  cx: number, cy: number, cs: number,
  edge: number,
  vTL: number, vTR: number, vBR: number, vBL: number,
  thr: number,
): [number, number] {
  const t = (a: number, b: number) =>
    Math.abs(b - a) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (thr - a) / (b - a)));
  switch (edge) {
    case 0: return [cx + t(vTL, vTR) * cs, cy];
    case 1: return [cx + cs, cy + t(vTR, vBR) * cs];
    case 2: return [cx + t(vBL, vBR) * cs, cy + cs];
    case 3: return [cx, cy + t(vTL, vBL) * cs];
    default: return [cx + cs / 2, cy + cs / 2];
  }
}

const parameterSchema: ParameterSchema = {
  contourCount: {
    name: 'Contour Count',
    type: 'number', min: 4, max: 30, step: 1, default: 14,
    help: 'Number of evenly-spaced iso-level lines',
    group: 'Composition',
  },
  noiseScale: {
    name: 'Terrain Scale',
    type: 'number', min: 0.5, max: 6, step: 0.1, default: 2.5,
    help: 'Spatial scale of the height field',
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves',
    type: 'number', min: 1, max: 7, step: 1, default: 5,
    group: 'Composition',
  },
  cellSize: {
    name: 'Cell Size',
    type: 'number', min: 2, max: 14, step: 1, default: 4,
    help: 'Marching-squares grid resolution — smaller = finer lines, slower',
    group: 'Geometry',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.25, max: 3, step: 0.25, default: 0.7,
    group: 'Geometry',
  },
  wobble: {
    name: 'Wobble',
    type: 'number', min: 0, max: 4, step: 0.25, default: 0.4,
    help: 'Hand-drawn jitter applied to contour endpoints',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['elevation-palette', 'alternating', 'monochrome'],
    default: 'elevation-palette',
    help: 'elevation-palette: color ramps with altitude | alternating: toggles palette ends',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.1,
    help: 'Speed at which the terrain drifts over time (0 = static)',
    group: 'Flow/Motion',
  },
};

export const contourTopo: Generator = {
  id: 'plotter-contour-topo',
  family: 'plotter',
  styleName: 'Topographic Contours',
  definition: 'Extracts elevation iso-contours from an FBM noise height field using Marching Squares, producing clean topographic map line art',
  algorithmNotes: 'A multi-octave SimplexNoise FBM field is sampled on a uniform grid. Marching Squares walks each cell to produce linearly-interpolated contour segments at each iso-level. Optional wobble displaces endpoints for a hand-drawn plotter aesthetic.',
  parameterSchema,
  defaultParams: {
    contourCount: 14, noiseScale: 2.5, octaves: 5, cellSize: 4,
    lineWidth: 0.7, wobble: 0.4, colorMode: 'elevation-palette', background: 'cream', animSpeed: 0.1,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const noise = new SimplexNoise(seed);
    const rng = new SeededRNG(seed);
    const cs = Math.max(2, params.cellSize | 0);
    const nLevels = Math.max(2, params.contourCount | 0);
    const scale = params.noiseScale ?? 2.5;
    const oct = params.octaves ?? 5;
    const wobble = params.wobble ?? 0.4;
    const isDark = params.background === 'dark';
    const animSpeed = params.animSpeed ?? 0.1;
    const tOff = time * animSpeed * 0.25;

    const cols = Math.ceil(w / cs) + 1;
    const rows = Math.ceil(h / cs) + 1;

    // Sample height field (centered + time-translated for animation)
    const field: number[][] = [];
    for (let r = 0; r < rows; r++) {
      field[r] = [];
      for (let c = 0; c < cols; c++) {
        field[r][c] = noise.fbm(
          (c / (cols - 1) - 0.5) * scale + tOff,
          (r / (rows - 1) - 0.5) * scale + tOff * 0.6,
          oct, 2, 0.5,
        );
      }
    }

    // Global min/max for normalisation
    let fMin = Infinity, fMax = -Infinity;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (field[r][c] < fMin) fMin = field[r][c];
        if (field[r][c] > fMax) fMax = field[r][c];
      }
    const fRange = Math.max(fMax - fMin, 1e-6);

    const colors = palette.colors.map(hexToRgb);
    ctx.lineWidth = params.lineWidth ?? 0.7;
    ctx.lineCap = 'round';

    for (let lvl = 0; lvl < nLevels; lvl++) {
      const t = (lvl + 0.5) / nLevels; // 0→1 across all levels
      const threshold = fMin + t * fRange;

      // Line color for this level
      let r: number, g: number, b: number;
      if (params.colorMode === 'monochrome') {
        const v = isDark ? (220 - lvl * 8) : (40 + lvl * 8);
        [r, g, b] = [v, v, v];
      } else if (params.colorMode === 'alternating') {
        const col = colors[lvl % 2 === 0 ? 0 : colors.length - 1];
        [r, g, b] = col;
      } else {
        // elevation-palette: interpolate across palette
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      }

      ctx.strokeStyle = `rgba(${r},${g},${b},${isDark ? 0.85 : 0.8})`;
      ctx.beginPath();

      for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols - 1; col++) {
          const vTL = field[row][col];
          const vTR = field[row][col + 1];
          const vBR = field[row + 1][col + 1];
          const vBL = field[row + 1][col];

          const caseIdx =
            (vTL >= threshold ? 8 : 0) |
            (vTR >= threshold ? 4 : 0) |
            (vBR >= threshold ? 2 : 0) |
            (vBL >= threshold ? 1 : 0);

          const cx = col * cs, cy = row * cs;

          for (const [eA, eB] of MS[caseIdx]) {
            const [ax, ay] = edgePt(cx, cy, cs, eA, vTL, vTR, vBR, vBL, threshold);
            const [bx, by] = edgePt(cx, cy, cs, eB, vTL, vTR, vBR, vBL, threshold);
            const wx = (rng.random() - 0.5) * wobble;
            const wy = (rng.random() - 0.5) * wobble;
            ctx.moveTo(ax + wx, ay + wy);
            ctx.lineTo(bx + wx, by + wy);
          }
        }
      }
      ctx.stroke();
    }
  },

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const c = gl.canvas as HTMLCanvasElement;
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    this.renderCanvas2D!(tmp.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost(params) {
    const cs = params.cellSize ?? 4;
    return Math.round(params.contourCount * (1080 / cs) * (1080 / cs) * 0.002);
  },
};
