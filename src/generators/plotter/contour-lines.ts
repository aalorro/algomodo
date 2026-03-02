import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const s = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

// Marching squares lookup — case index = TL*8 | TR*4 | BR*2 | BL*1
// Each entry lists [edgeA, edgeB] pairs. Edges: 0=top 1=right 2=bottom 3=left
const MS: [number, number][][] = [
  [], [[3,2]], [[2,1]], [[3,1]], [[0,1]], [[0,1],[3,2]], [[0,2]], [[3,0]],
  [[3,0]], [[0,2]], [[3,0],[2,1]], [[0,1]], [[3,1]], [[2,1]], [[3,2]], [],
];

function edgePt(
  cx: number, cy: number, cs: number, edge: number,
  vTL: number, vTR: number, vBR: number, vBL: number, thr: number,
): [number, number] {
  const lerp = (a: number, b: number) =>
    Math.abs(b - a) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (thr - a) / (b - a)));
  switch (edge) {
    case 0: return [cx + lerp(vTL, vTR) * cs, cy];
    case 1: return [cx + cs, cy + lerp(vTR, vBR) * cs];
    case 2: return [cx + lerp(vBL, vBR) * cs, cy + cs];
    case 3: return [cx, cy + lerp(vTL, vBL) * cs];
    default: return [cx + cs / 2, cy + cs / 2];
  }
}

const parameterSchema: ParameterSchema = {
  levels: {
    name: 'Levels', type: 'number', min: 3, max: 24, step: 1, default: 10,
    help: 'Number of elevation bands — each filled with a palette color',
    group: 'Composition',
  },
  scale: {
    name: 'Scale', type: 'number', min: 0.5, max: 8, step: 0.25, default: 2.5,
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 8, step: 1, default: 5,
    group: 'Composition',
  },
  fieldType: {
    name: 'Field Type', type: 'select', options: ['fbm', 'ridged', 'turbulence'], default: 'fbm',
    help: 'fbm: smooth rolling hills | ridged: sharp mountain ridges | turbulence: plasma/fire topology',
    group: 'Geometry',
  },
  cellSize: {
    name: 'Cell Size', type: 'number', min: 2, max: 12, step: 1, default: 4,
    help: 'Marching-squares grid resolution — smaller = smoother band edges',
    group: 'Geometry',
  },
  showLines: {
    name: 'Show Lines', type: 'boolean', default: true,
    help: 'Draw thin contour lines on band boundaries',
    group: 'Color',
  },
  lineWidth: {
    name: 'Line Width', type: 'number', min: 0.25, max: 3, step: 0.25, default: 0.5,
    group: 'Color',
  },
  lineColor: {
    name: 'Line Color', type: 'select', options: ['dark', 'light', 'palette'], default: 'dark',
    help: 'dark: near-black lines | light: near-white lines | palette: each contour matches its band color',
    group: 'Color',
  },
  fillOpacity: {
    name: 'Fill Opacity', type: 'number', min: 0.1, max: 1, step: 0.05, default: 1.0,
    help: 'Opacity of the filled elevation bands — reduce for a ghostly overlay effect',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['drift', 'none'], default: 'drift',
    help: 'drift: field translates over time, bands flow like a slow liquid',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.2,
    group: 'Flow/Motion',
  },
};

export const contourLines: Generator = {
  id: 'plotter-contour-lines',
  family: 'plotter',
  styleName: 'Contour Lines',
  definition: 'Filled topographic map — a noise height field is quantized into coloured elevation bands with optional contour outlines, giving the look of a colour-printed geographic map',
  algorithmNotes:
    'A scalar noise field (fBm, ridged multifractal, or turbulence) is evaluated on a uniform marching-squares grid. Each pixel is bucketed into one of N elevation bands and filled with the corresponding palette colour. Contour lines are then drawn at each iso-level using marching squares with linear interpolation along cell edges for smooth boundaries. The filled-band approach is visually distinct from pen-plotter contour styles: the focus is on the coloured regions rather than the lines, producing a result closer to printed topographic maps or geological survey charts.',
  parameterSchema,
  defaultParams: {
    levels: 10, scale: 2.5, octaves: 5, fieldType: 'fbm', cellSize: 4,
    showLines: true, lineWidth: 0.5, lineColor: 'dark', fillOpacity: 1.0,
    animMode: 'drift', speed: 0.2,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;

    const levels     = Math.max(2, (params.levels   ?? 10) | 0);
    const scale      = params.scale     ?? 2.5;
    const octaves    = Math.max(1, Math.min(8, (params.octaves ?? 5) | 0));
    const fieldType  = params.fieldType ?? 'fbm';
    const cs         = Math.max(2, Math.min(12, (params.cellSize ?? 4) | 0));
    const showLines  = params.showLines ?? true;
    const lw         = params.lineWidth ?? 0.5;
    const lineColor  = params.lineColor ?? 'dark';
    const fillOp     = Math.max(0, Math.min(1, params.fillOpacity ?? 1.0));
    const animMode   = params.animMode  ?? 'drift';
    const t          = time * (params.speed ?? 0.2);

    const noise = new SimplexNoise(seed);
    const colors = palette.colors.map(hexToRgb);

    // Draft: coarser grid
    const step = quality === 'draft' ? cs * 2 : cs;

    const cols = Math.ceil(w / step) + 1;
    const rows = Math.ceil(h / step) + 1;

    const tOff = animMode === 'drift' ? t * 0.06 : 0;

    // ── Evaluate the scalar field ──────────────────────────────────────────
    function sampleField(nx: number, ny: number): number {
      if (fieldType === 'ridged') {
        const gain = 0.5, lac = 2.0, offset = 1.0;
        let value = 0, weight = 1, amp = 1, freq = 1;
        for (let oct = 0; oct < octaves; oct++) {
          let s = Math.abs(noise.noise2D(nx * freq, ny * freq));
          s = Math.max(0, offset - s); s *= s; s *= weight;
          weight = Math.min(1, s * gain); value += s * amp;
          freq *= lac; amp *= gain;
        }
        return Math.min(1, value * (1 - gain));
      } else if (fieldType === 'turbulence') {
        let value = 0, amp = 1, freq = 1, maxV = 0;
        for (let oct = 0; oct < octaves; oct++) {
          value += amp * Math.abs(noise.noise2D(nx * freq, ny * freq));
          maxV += amp; amp *= 0.5; freq *= 2;
        }
        return Math.min(1, (value / maxV) / 0.65);
      } else {
        // fBm: map [-1,1] → [0,1]
        return (noise.fbm(nx, ny, octaves, 2.0, 0.5) + 1) * 0.5;
      }
    }

    // Build field grid
    const field: Float32Array = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const nx = (c / (cols - 1) - 0.5) * scale * 4 + tOff;
        const ny = (r / (rows - 1) - 0.5) * scale * 4 + tOff * 0.67;
        field[r * cols + c] = sampleField(nx, ny);
      }
    }

    // ── Filled bands via pixel loop (fast, no path needed) ─────────────────
    const img = ctx.createImageData(w, h);
    const d   = img.data;
    const bandSize = 1 / levels;

    // Bilinear sample of field at pixel position
    function fieldAt(px: number, py: number): number {
      const fc = (px / w) * (cols - 1);
      const fr = (py / h) * (rows - 1);
      const c0 = Math.floor(fc), c1 = Math.min(cols - 1, c0 + 1);
      const r0 = Math.floor(fr), r1 = Math.min(rows - 1, r0 + 1);
      const tf = fc - c0, tr = fr - r0;
      const v00 = field[r0 * cols + c0], v10 = field[r0 * cols + c1];
      const v01 = field[r1 * cols + c0], v11 = field[r1 * cols + c1];
      return v00 * (1-tf)*(1-tr) + v10 * tf*(1-tr) + v01 * (1-tf)*tr + v11 * tf*tr;
    }

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const v   = fieldAt(px, py);
        const band = Math.min(levels - 1, Math.floor(v / bandSize));
        const t_p  = band / (levels - 1);
        const [r, g, b] = paletteSample(t_p, colors);
        const a = (fillOp * 255) | 0;
        const i = (py * w + px) * 4;
        d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);

    // ── Contour lines via marching squares ─────────────────────────────────
    if (showLines) {
      ctx.lineWidth = lw;

      for (let level = 0; level < levels - 1; level++) {
        const thr = (level + 1) * bandSize; // iso-value at band boundary

        const [lr, lg, lb] = lineColor === 'palette'
          ? paletteSample(thr, colors)
          : lineColor === 'light'
            ? [220, 220, 220]
            : [20, 20, 20];
        ctx.strokeStyle = `rgba(${lr},${lg},${lb},0.7)`;

        for (let r = 0; r < rows - 1; r++) {
          for (let c = 0; c < cols - 1; c++) {
            const vTL = field[r * cols + c];
            const vTR = field[r * cols + (c+1)];
            const vBL = field[(r+1) * cols + c];
            const vBR = field[(r+1) * cols + (c+1)];

            const mask = (vTL >= thr ? 8 : 0) | (vTR >= thr ? 4 : 0)
                       | (vBR >= thr ? 2 : 0) | (vBL >= thr ? 1 : 0);
            const segs = MS[mask];
            if (segs.length === 0) continue;

            const cx = c * step, cy = r * step;

            for (const [eA, eB] of segs) {
              const [ax, ay] = edgePt(cx, cy, step, eA, vTL, vTR, vBR, vBL, thr);
              const [bx, by] = edgePt(cx, cy, step, eB, vTL, vTR, vBR, vBL, thr);
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
            }
          }
        }
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const cells = (800 / (params.cellSize ?? 4)) ** 2;
    return (cells * (params.levels ?? 10) / 500) | 0;
  },
};
