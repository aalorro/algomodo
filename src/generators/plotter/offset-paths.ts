import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

/** Signed distance to a circle */
function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  const dx = px - cx, dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy) - r;
}

/** Signed distance to an axis-aligned rectangle (half-extents hw, hh, centred at cx,cy) */
function sdRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number): number {
  const qx = Math.abs(px - cx) - hw;
  const qy = Math.abs(py - cy) - hh;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0);
}

/** Union of two SDFs */
function sdUnion(a: number, b: number): number { return Math.min(a, b); }

const parameterSchema: ParameterSchema = {
  ringCount: {
    name: 'Ring Count',
    type: 'number', min: 4, max: 40, step: 1, default: 16,
    help: 'Number of concentric offset rings around each seed shape',
    group: 'Composition',
  },
  ringSpacing: {
    name: 'Ring Spacing',
    type: 'number', min: 4, max: 40, step: 1, default: 14,
    help: 'Pixel gap between successive rings',
    group: 'Geometry',
  },
  shapeCount: {
    name: 'Shape Count',
    type: 'number', min: 1, max: 12, step: 1, default: 4,
    help: 'Number of seed shapes to offset around',
    group: 'Composition',
  },
  shapeType: {
    name: 'Shape Type',
    type: 'select',
    options: ['circles', 'rectangles', 'mixed', 'blobs'],
    default: 'circles',
    group: 'Composition',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.25, max: 3, step: 0.25, default: 0.8,
    group: 'Geometry',
  },
  wobble: {
    name: 'Wobble',
    type: 'number', min: 0, max: 6, step: 0.25, default: 1.0,
    help: 'Noise-based perturbation of the SDF surface — gives hand-drawn character',
    group: 'Texture',
  },
  wobbleScale: {
    name: 'Wobble Scale',
    type: 'number', min: 0.5, max: 6, step: 0.25, default: 2.0,
    help: 'Spatial frequency of the wobble noise',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-rings', 'elevation', 'alternating'],
    default: 'palette-rings',
    help: 'palette-rings: each ring cycles through palette | elevation: ramps by ring depth | alternating: two-color flip',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
};

export const offsetPaths: Generator = {
  id: 'plotter-offset-paths',
  family: 'plotter',
  styleName: 'Offset Paths',
  definition: 'Draws concentric iso-distance rings around randomly placed seed shapes, using a per-pixel signed-distance field to locate ring boundaries',
  algorithmNotes: 'Seed shapes (circles, rectangles, or noise-warped blobs) are placed with a jittered grid. For every pixel the global SDF is evaluated as the union of all shape SDFs, then perturbed with FBM noise for a hand-drawn look. Ring boundaries are detected where the perturbed SDF crosses multiples of the spacing value, and drawn as a single marching scanline pass with sub-pixel anti-aliasing.',
  parameterSchema,
  defaultParams: {
    ringCount: 16, ringSpacing: 14, shapeCount: 4,
    shapeType: 'circles', lineWidth: 0.8, wobble: 1.0, wobbleScale: 2.0,
    colorMode: 'palette-rings', background: 'cream',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: false,

  renderCanvas2D(ctx, params, seed, palette) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const ringCount = Math.max(1, params.ringCount ?? 16) | 0;
    const spacing = Math.max(2, params.ringSpacing ?? 14);
    const shapeCount = Math.max(1, params.shapeCount ?? 4) | 0;
    const shapeType = params.shapeType || 'circles';
    const wobble = params.wobble ?? 1.0;
    const wobbleScale = params.wobbleScale ?? 2.0;
    const isDark = params.background === 'dark';

    // Place seed shapes with jittered grid
    const cols = Math.ceil(Math.sqrt(shapeCount * (w / h)));
    const rows = Math.ceil(shapeCount / cols);
    const cw = w / cols, ch = h / rows;

    type Shape = { type: 'circle' | 'rect'; cx: number; cy: number; r: number; hw: number; hh: number };
    const shapes: Shape[] = [];
    const minDim = Math.min(w, h);

    for (let r = 0; r < rows && shapes.length < shapeCount; r++) {
      for (let c = 0; c < cols && shapes.length < shapeCount; c++) {
        const cx = (c + 0.2 + rng.random() * 0.6) * cw;
        const cy = (r + 0.2 + rng.random() * 0.6) * ch;
        const baseR = (0.12 + rng.random() * 0.14) * minDim;
        let type: 'circle' | 'rect';
        if (shapeType === 'circles') type = 'circle';
        else if (shapeType === 'rectangles') type = 'rect';
        else type = rng.random() > 0.5 ? 'circle' : 'rect'; // mixed + blobs both use these SDFs
        const aspect = 0.6 + rng.random() * 0.8;
        shapes.push({ type, cx, cy, r: baseR, hw: baseR * aspect, hh: baseR / aspect });
      }
    }

    /** Combined SDF with optional noise wobble */
    const sdf = (px: number, py: number): number => {
      let d = Infinity;
      for (const s of shapes) {
        const raw = s.type === 'circle'
          ? sdCircle(px, py, s.cx, s.cy, s.r)
          : sdRect(px, py, s.cx, s.cy, s.hw, s.hh);
        d = sdUnion(d, raw);
      }
      if (wobble > 0) {
        const wn = noise.fbm(px / w * wobbleScale, py / h * wobbleScale, 3, 2, 0.5);
        d += wn * wobble * spacing * 0.35;
      }
      return d;
    };

    const colors = palette.colors.map(hexToRgb);
    ctx.lineWidth = params.lineWidth ?? 0.8;
    ctx.lineCap = 'round';

    const colorMode = params.colorMode || 'palette-rings';

    // Draw rings 0..ringCount-1 by scanning for sign changes of (sdf - ring * spacing)
    // Process each ring level separately: draw contour where sdf ≈ ring * spacing
    // We use the imageData approach to detect ring crossings efficiently.

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // For anti-aliased ring lines we draw per-pixel by checking sdf modulo spacing
    // A pixel belongs to ring r if floor(sdf/spacing) == r AND 0 <= sdf < ringCount*spacing
    // We soften edges by alpha based on distance from the ring boundary

    const halfLW = (params.lineWidth ?? 0.8) * 0.5;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const d = sdf(px, py);
        if (d < 0 || d >= ringCount * spacing) continue;

        const ringIdx = Math.floor(d / spacing) | 0;
        const frac = (d % spacing) / spacing; // 0→1 within ring band
        // Distance from nearest ring boundary (0 = on boundary, 0.5 = midpoint)
        const distFromEdge = Math.min(frac, 1 - frac) * spacing;
        if (distFromEdge > halfLW + 1) continue; // outside line footprint

        const alpha = Math.max(0, Math.min(1, (halfLW + 1 - distFromEdge)));

        let cr: number, cg: number, cb: number;
        if (colorMode === 'alternating') {
          const col = ringIdx % 2 === 0 ? colors[0] : colors[colors.length - 1];
          [cr, cg, cb] = col;
        } else if (colorMode === 'elevation') {
          const t = ringIdx / Math.max(1, ringCount - 1);
          const ci = t * (colors.length - 1);
          const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
          const f = ci - i0;
          cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
          cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
          cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
        } else {
          // palette-rings: cycle
          [cr, cg, cb] = colors[ringIdx % colors.length];
        }

        const globalAlpha = isDark ? 0.88 : 0.82;
        const finalAlpha = (alpha * globalAlpha * 255) | 0;

        const idx = (py * w + px) * 4;
        // Alpha-blend over background
        const bg = hexToRgb(BG[params.background] ?? BG.cream);
        const a01 = finalAlpha / 255;
        data[idx]     = (bg[0] * (1 - a01) + cr * a01) | 0;
        data[idx + 1] = (bg[1] * (1 - a01) + cg * a01) | 0;
        data[idx + 2] = (bg[2] * (1 - a01) + cb * a01) | 0;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round(1080 * 1080 * (params.shapeCount ?? 4) * 0.003);
  },
};
