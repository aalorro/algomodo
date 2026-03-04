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

/** Signed distance to a regular polygon (n sides, centred at cx,cy, radius r, rotation rot) */
function sdRegularPoly(px: number, py: number, cx: number, cy: number, r: number, n: number, rot: number): number {
  const dx = px - cx, dy = py - cy;
  // Rotate point to align with polygon
  const cosR = Math.cos(-rot), sinR = Math.sin(-rot);
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  // Angle quantization
  const angle = Math.atan2(ry, rx);
  const sector = Math.PI * 2 / n;
  const halfSector = sector / 2;
  const a = ((angle % sector) + sector) % sector - halfSector;
  const dist = Math.sqrt(rx * rx + ry * ry);
  const d = dist * Math.cos(a) - r * Math.cos(halfSector);
  return d;
}

/** Signed distance to a 5-pointed star */
function sdStar(px: number, py: number, cx: number, cy: number, outerR: number, rot: number): number {
  const innerR = outerR * 0.38;
  const dx = px - cx, dy = py - cy;
  const cosR = Math.cos(-rot), sinR = Math.sin(-rot);
  const rx = dx * cosR - dy * sinR;
  const ry = dx * sinR + dy * cosR;
  const angle = Math.atan2(ry, rx);
  const sector = Math.PI * 2 / 5;
  const halfSector = sector / 2;
  const a = ((angle % sector) + sector) % sector - halfSector;
  const dist = Math.sqrt(rx * rx + ry * ry);
  // Interpolate between inner and outer radius based on angle
  const t = Math.abs(a) / halfSector; // 0 at tip, 1 at valley
  const edgeR = outerR * (1 - t) + innerR * t;
  return dist - edgeR;
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
    options: ['circles', 'rectangles', 'mixed', 'blobs', 'triangles', 'stars'],
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
  fillBands: {
    name: 'Fill Bands',
    type: 'boolean', default: false,
    help: 'Fill the space between rings with color for a topographic map look',
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
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.1,
    help: 'Speed of wobble field drift — 0 = static',
    group: 'Flow/Motion',
  },
};

export const offsetPaths: Generator = {
  id: 'plotter-offset-paths',
  family: 'plotter',
  styleName: 'Offset Paths',
  definition: 'Draws concentric iso-distance rings around randomly placed seed shapes, using a per-pixel signed-distance field to locate ring boundaries',
  algorithmNotes: 'Seed shapes (circles, rectangles, triangles, stars, or noise-warped blobs) are placed with a jittered grid. For every pixel the global SDF is evaluated as the union of all shape SDFs, then perturbed with FBM noise for a hand-drawn look. Ring boundaries are detected where the perturbed SDF crosses multiples of the spacing value, and drawn as a single marching scanline pass with sub-pixel anti-aliasing. Fill bands option colors the space between rings for a topographic map effect.',
  parameterSchema,
  defaultParams: {
    ringCount: 16, ringSpacing: 14, shapeCount: 4,
    shapeType: 'circles', lineWidth: 0.8, wobble: 1.0, wobbleScale: 2.0,
    fillBands: false, colorMode: 'palette-rings', background: 'cream',
    animSpeed: 0.1,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
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
    const fillBands = params.fillBands ?? false;
    const isDark = params.background === 'dark';
    const animSpeed = params.animSpeed ?? 0.1;
    const tOff = time * animSpeed * 0.3;

    // Place seed shapes with jittered grid
    const cols = Math.ceil(Math.sqrt(shapeCount * (w / h)));
    const rows = Math.ceil(shapeCount / cols);
    const cw = w / cols, ch = h / rows;

    type Shape = { type: string; cx: number; cy: number; r: number; hw: number; hh: number; rot: number };
    const shapes: Shape[] = [];
    const minDim = Math.min(w, h);

    for (let r = 0; r < rows && shapes.length < shapeCount; r++) {
      for (let c = 0; c < cols && shapes.length < shapeCount; c++) {
        const cx = (c + 0.2 + rng.random() * 0.6) * cw;
        const cy = (r + 0.2 + rng.random() * 0.6) * ch;
        const baseR = (0.12 + rng.random() * 0.14) * minDim;
        const rot = rng.random() * Math.PI * 2;

        let type: string;
        if (shapeType === 'circles') type = 'circle';
        else if (shapeType === 'rectangles') type = 'rect';
        else if (shapeType === 'triangles') type = 'triangle';
        else if (shapeType === 'stars') type = 'star';
        else if (shapeType === 'blobs') type = 'circle'; // blobs use circle SDF + extra wobble
        else {
          // mixed
          const pick = rng.random();
          if (pick < 0.25) type = 'circle';
          else if (pick < 0.45) type = 'rect';
          else if (pick < 0.65) type = 'triangle';
          else if (pick < 0.85) type = 'star';
          else type = 'circle';
        }

        const aspect = 0.6 + rng.random() * 0.8;
        shapes.push({ type, cx, cy, r: baseR, hw: baseR * aspect, hh: baseR / aspect, rot });
      }
    }

    /** Combined SDF with optional noise wobble */
    const sdf = (px: number, py: number): number => {
      let d = Infinity;
      for (const s of shapes) {
        let raw: number;
        if (s.type === 'rect') {
          raw = sdRect(px, py, s.cx, s.cy, s.hw, s.hh);
        } else if (s.type === 'triangle') {
          raw = sdRegularPoly(px, py, s.cx, s.cy, s.r, 3, s.rot);
        } else if (s.type === 'star') {
          raw = sdStar(px, py, s.cx, s.cy, s.r, s.rot);
        } else {
          raw = sdCircle(px, py, s.cx, s.cy, s.r);
        }
        d = sdUnion(d, raw);
      }
      if (wobble > 0) {
        const wn = noise.fbm(px / w * wobbleScale + tOff, py / h * wobbleScale + tOff * 0.7, 3, 2, 0.5);
        // Blobs get extra wobble for organic shapes
        const wobbleMult = shapeType === 'blobs' ? 0.7 : 0.35;
        d += wn * wobble * spacing * wobbleMult;
      }
      return d;
    };

    const colors = palette.colors.map(hexToRgb);

    const colorMode = params.colorMode || 'palette-rings';

    const getRingColor = (ringIdx: number): [number, number, number] => {
      if (colorMode === 'alternating') {
        return ringIdx % 2 === 0 ? colors[0] : colors[colors.length - 1];
      } else if (colorMode === 'elevation') {
        const t = ringIdx / Math.max(1, ringCount - 1);
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        return [
          (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
          (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
          (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
        ];
      } else {
        return colors[ringIdx % colors.length];
      }
    };

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    const halfLW = (params.lineWidth ?? 0.8) * 0.5;
    const bg = hexToRgb(BG[params.background] ?? BG.cream);
    const globalAlpha = isDark ? 0.88 : 0.82;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const d = sdf(px, py);
        if (d < 0 || d >= ringCount * spacing) continue;

        const ringIdx = Math.floor(d / spacing) | 0;
        const frac = (d % spacing) / spacing;
        const distFromEdge = Math.min(frac, 1 - frac) * spacing;

        const [cr, cg, cb] = getRingColor(ringIdx);
        const idx = (py * w + px) * 4;

        if (fillBands) {
          // Fill entire band with color, draw line borders on top
          const bandAlpha = globalAlpha * 0.5;
          let a01 = bandAlpha;

          // Add stronger border at ring boundaries
          if (distFromEdge < halfLW + 1) {
            const lineAlpha = Math.max(0, Math.min(1, (halfLW + 1 - distFromEdge)));
            a01 = bandAlpha + (globalAlpha - bandAlpha) * lineAlpha;
          }

          data[idx]     = (bg[0] * (1 - a01) + cr * a01) | 0;
          data[idx + 1] = (bg[1] * (1 - a01) + cg * a01) | 0;
          data[idx + 2] = (bg[2] * (1 - a01) + cb * a01) | 0;
          data[idx + 3] = 255;
        } else {
          // Lines only
          if (distFromEdge > halfLW + 1) continue;
          const alpha = Math.max(0, Math.min(1, (halfLW + 1 - distFromEdge)));
          const finalAlpha = (alpha * globalAlpha * 255) | 0;
          const a01 = finalAlpha / 255;
          data[idx]     = (bg[0] * (1 - a01) + cr * a01) | 0;
          data[idx + 1] = (bg[1] * (1 - a01) + cg * a01) | 0;
          data[idx + 2] = (bg[2] * (1 - a01) + cb * a01) | 0;
          data[idx + 3] = 255;
        }
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
