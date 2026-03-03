import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpRgb(
  colors: [number, number, number][], t: number,
): [number, number, number] {
  const ci = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
  const f  = ci - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

const parameterSchema: ParameterSchema = {
  cellSize: {
    name: 'Cell Size', type: 'number', min: 10, max: 200, step: 5, default: 60,
    help: 'Pixel size of each square tile',
    group: 'Geometry',
  },
  variant: {
    name: 'Variant', type: 'select',
    options: ['arc', 'diagonal', 'quarter', 'weave'],
    default: 'arc',
    help: 'arc: quarter-circle arcs from opposing corners (classic Truchet 1704) | diagonal: straight ±45° lines | quarter: filled quarter-circle wedges | weave: every cell draws both arc orientations simultaneously, with alternating row+col parity controlling which arc passes over — Celtic knot / basket-weave appearance',
    group: 'Geometry',
  },
  strokeWidth: {
    name: 'Stroke Width', type: 'number', min: 0.5, max: 10, step: 0.5, default: 2,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['mono', 'two-tone', 'depth', 'noise'],
    default: 'two-tone',
    help: 'mono: single color | two-tone: alternating palette colors per orientation | depth: diagonal position (col+row) mapped to palette gradient — diagonal rainbow wash across the tiling | noise: smooth palette gradient driven by the underlying continuous noise field, ignoring the binary orientation',
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select', options: ['dark', 'light', 'mid'], default: 'dark',
    group: 'Color',
  },
  bias: {
    name: 'Bias',
    type: 'number', min: 0.1, max: 0.9, step: 0.05, default: 0.5,
    help: 'Orientation distribution bias — 0.5 = 50/50 split; lower values tilt most cells toward orientation 0; higher values toward orientation 1; creates directional flow across the tiling',
    group: 'Composition',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['none', 'wave', 'flow'], default: 'wave',
    help: 'none: static seed-based | wave: diagonal noise wavefront sweeps through, flipping tile orientations | flow: per-cell slow smooth phase evolution',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.3,
    group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { dark: '#080808', light: '#f5f5f0', mid: '#1e1e22' };

// ---------------------------------------------------------------------------
// Arc helpers
// ---------------------------------------------------------------------------
function drawArcOrientation(
  ctx: CanvasRenderingContext2D,
  ori: number, cx: number, cy: number, s: number,
): void {
  if (ori === 0) {
    ctx.beginPath(); ctx.arc(cx,     cy,     s / 2, 0,           Math.PI / 2);   ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + s, cy + s, s / 2, Math.PI,     3 * Math.PI / 2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(cx + s, cy,     s / 2, Math.PI / 2, Math.PI);       ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,     cy + s, s / 2, -Math.PI / 2, 0);            ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const geoTruchet: Generator = {
  id: 'geo-truchet',
  family: 'geometry',
  styleName: 'Truchet Tiles',
  definition: 'Square tiles each assigned one of two orientations — four variants including a weave mode where every cell draws both arc sets with alternating over-under parity for a Celtic knot aesthetic; noise colorMode paints a smooth gradient field over the tiling',
  algorithmNotes:
    'Classic Truchet (1704): each cell has two quarter-circle arcs from opposing corners, connecting midpoints of adjacent sides; two orientations (0°/90°) are randomly assigned. Weave variant: every cell draws BOTH arc orientations simultaneously; parity = (row+col)%2 controls which set is drawn last (on top) — the alternating over/under creates a continuous woven appearance without needing to track arc connectivity. The "under" arc is first drawn with a background-colored gap wider than sw, then redrawn in color, then the "over" arc is drawn on top. Bias: orientation threshold shifts from 0 to (2·bias−1)·0.9 ∈ [−0.9, 0.9] — tilts the noise zero-crossing, creating directional structural flow across the tiling. Depth colorMode: maps (col+row)/(cols+rows−2) → palette for a diagonal rainbow. Noise colorMode: uses the raw floating-point noise value (not just its sign) lerped to the full palette — reveals the continuous noise field under the tiled pattern. Wave animation: noise field translates diagonally (dx = t·0.15, dy = t·0.09) to sweep orientation-flip boundaries across the canvas.',
  parameterSchema,
  defaultParams: {
    cellSize: 60, variant: 'arc', strokeWidth: 2,
    colorMode: 'two-tone', background: 'dark', bias: 0.5,
    animMode: 'wave', speed: 0.3,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const s       = Math.max(5, (params.cellSize ?? 60) | 0);
    const variant = (params.variant   ?? 'arc') as string;
    const sw      = params.strokeWidth ?? 2;
    const cm      = (params.colorMode ?? 'two-tone') as string;
    const bg      = (params.background ?? 'dark') as string;
    const bias    = Math.max(0.1, Math.min(0.9, params.bias ?? 0.5));
    const anim    = (params.animMode  ?? 'wave') as string;
    const t       = time * (params.speed ?? 0.3);

    // Bias threshold in noise space: 0.5→0 (balanced), 0.1→−0.72, 0.9→+0.72
    const biasThreshold = (2 * bias - 1) * 0.9;

    const bgCol   = BG[bg] ?? BG.dark;
    const isLight = bg === 'light';

    ctx.fillStyle = bgCol;
    ctx.fillRect(0, 0, w, h);

    const rng   = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const cols  = Math.ceil(w / s) + 1;
    const rows  = Math.ceil(h / s) + 1;

    const rgbPalette = palette.colors.map(hexToRgb);
    const c0 = rgbPalette[0];
    const c1 = rgbPalette[Math.min(1, rgbPalette.length - 1)];

    ctx.lineWidth = sw;
    ctx.lineCap   = 'round';

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = col * s;
        const cy = row * s;

        // Noise value (floats used for both orientation and 'noise' colorMode)
        let noiseVal = 0;
        if (anim === 'wave' && time > 0) {
          noiseVal = noise.fbm(col * 0.18 + t * 0.15, row * 0.18 + t * 0.09, 2, 2, 0.5);
        } else if (anim === 'flow' && time > 0) {
          noiseVal = noise.fbm(col * 0.12, row * 0.12 + t * 0.2, 3, 2, 0.5);
        } else {
          noiseVal = rng.random() * 2 - 1; // [-1, 1]
        }

        const orientation = noiseVal > biasThreshold ? 0 : 1;

        // Depth colorMode: diagonal position → palette
        const diagT = (col + row) / Math.max(1, cols + rows - 2);

        // Pick colors
        const getColor = (ori: number): [number, number, number] => {
          if (cm === 'noise') {
            return lerpRgb(rgbPalette, noiseVal * 0.5 + 0.5);
          }
          if (cm === 'depth') {
            return lerpRgb(rgbPalette, diagT);
          }
          return ori === 0 ? c0 : c1;
        };

        const [fr, fg, fb] = getColor(orientation);
        const [br, bgg, bb] = getColor(1 - orientation);

        // -----------------------------------------------------------------
        // WEAVE variant — draw both arc orientations with over/under parity
        // -----------------------------------------------------------------
        if (variant === 'weave') {
          const parity    = (row + col) % 2;
          const underOri  = parity;
          const overOri   = 1 - parity;

          const [ur, ug, ub] = getColor(underOri);
          const [or2, og, ob] = getColor(overOri);

          // Parse bg color for gap drawing
          const bgRgb = bg === 'light' ? [245, 245, 240] : bg === 'mid' ? [30, 30, 34] : [8, 8, 8];

          // Under arc: draw with bg-colored gap first, then in color
          ctx.strokeStyle = `rgb(${bgRgb[0]},${bgRgb[1]},${bgRgb[2]})`;
          ctx.lineWidth = sw + 4;
          drawArcOrientation(ctx, underOri, cx, cy, s);
          ctx.strokeStyle = `rgb(${ur},${ug},${ub})`;
          ctx.lineWidth = sw;
          drawArcOrientation(ctx, underOri, cx, cy, s);

          // Over arc: on top, no gap
          ctx.strokeStyle = `rgb(${or2},${og},${ob})`;
          ctx.lineWidth = sw;
          drawArcOrientation(ctx, overOri, cx, cy, s);

          continue;
        }

        // -----------------------------------------------------------------
        // ARC variant
        // -----------------------------------------------------------------
        if (variant === 'arc') {
          if (cm === 'two-tone') {
            // Fill cell background, then cut corner wedges
            ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
            ctx.fillRect(cx, cy, s, s);
            ctx.fillStyle = `rgb(${br},${bgg},${bb})`;
            if (orientation === 0) {
              ctx.beginPath(); ctx.moveTo(cx, cy);
              ctx.arc(cx, cy, s, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
              ctx.beginPath(); ctx.moveTo(cx + s, cy + s);
              ctx.arc(cx + s, cy + s, s, Math.PI, 3 * Math.PI / 2); ctx.closePath(); ctx.fill();
            } else {
              ctx.beginPath(); ctx.moveTo(cx + s, cy);
              ctx.arc(cx + s, cy, s, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill();
              ctx.beginPath(); ctx.moveTo(cx, cy + s);
              ctx.arc(cx, cy + s, s, 3 * Math.PI / 2, 2 * Math.PI); ctx.closePath(); ctx.fill();
            }
          }

          const strokeCol = (cm === 'mono' || cm === 'noise' || cm === 'depth')
            ? `rgb(${fr},${fg},${fb})`
            : isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.35)';
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = sw;
          drawArcOrientation(ctx, orientation, cx, cy, s);
          continue;
        }

        // -----------------------------------------------------------------
        // DIAGONAL variant
        // -----------------------------------------------------------------
        if (variant === 'diagonal') {
          if (cm === 'two-tone') {
            ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
            ctx.beginPath();
            if (orientation === 0) {
              ctx.moveTo(cx, cy); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s);
            } else {
              ctx.moveTo(cx, cy); ctx.lineTo(cx + s, cy); ctx.lineTo(cx + s, cy + s);
            }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = `rgb(${br},${bgg},${bb})`;
            ctx.beginPath();
            if (orientation === 0) {
              ctx.moveTo(cx + s, cy); ctx.lineTo(cx + s, cy + s); ctx.lineTo(cx, cy + s);
            } else {
              ctx.moveTo(cx, cy); ctx.lineTo(cx + s, cy + s); ctx.lineTo(cx, cy + s);
            }
            ctx.closePath(); ctx.fill();
          }

          ctx.strokeStyle = `rgb(${fr},${fg},${fb})`;
          ctx.lineWidth = sw;
          ctx.beginPath();
          if (orientation === 0) {
            ctx.moveTo(cx, cy + s); ctx.lineTo(cx + s, cy);   // ↗
          } else {
            ctx.moveTo(cx, cy);     ctx.lineTo(cx + s, cy + s); // ↘
          }
          ctx.stroke();
          continue;
        }

        // -----------------------------------------------------------------
        // QUARTER variant — filled wedge
        // -----------------------------------------------------------------
        ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
        ctx.beginPath();
        if (orientation === 0) {
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, s * 0.9, 0, Math.PI / 2);
        } else {
          ctx.moveTo(cx + s, cy);
          ctx.arc(cx + s, cy, s * 0.9, Math.PI / 2, Math.PI);
        }
        ctx.closePath(); ctx.fill();

        ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },

  estimateCost(params) {
    const cells = (800 / (params.cellSize ?? 60)) ** 2;
    return (cells * (params.variant === 'weave' ? 10 : 5)) | 0;
  },
};
