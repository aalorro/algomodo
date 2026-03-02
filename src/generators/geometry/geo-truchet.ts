import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  cellSize: {
    name: 'Cell Size', type: 'number', min: 10, max: 200, step: 5, default: 60,
    help: 'Pixel size of each square tile cell',
    group: 'Geometry',
  },
  variant: {
    name: 'Variant', type: 'select', options: ['arc', 'diagonal', 'quarter'], default: 'arc',
    help: 'arc: quarter-circle arcs (classic Truchet) | diagonal: straight diagonal lines | quarter: filled quarter-circle wedges',
    group: 'Geometry',
  },
  strokeWidth: {
    name: 'Stroke Width', type: 'number', min: 0.5, max: 10, step: 0.5, default: 2,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['mono', 'two-tone', 'depth'], default: 'two-tone',
    help: 'mono: single palette color on dark | two-tone: fill half-cells with two palette colors | depth: orientation mapped to palette gradient',
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select', options: ['dark', 'light', 'mid'], default: 'dark',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['none', 'wave', 'flow'], default: 'wave',
    help: 'none: static seed-based | wave: a slow noise wave sweeps through, flipping tile orientations | flow: continuous smooth morphing per cell',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.3,
    group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { dark: '#080808', light: '#f5f5f0', mid: '#1e1e22' };

export const geoTruchet: Generator = {
  id: 'geo-truchet',
  family: 'geometry',
  styleName: 'Truchet Tiles',
  definition: 'Each square cell receives one of two orientations — quarter-circle arcs, diagonals, or wedges — tiled across the canvas to produce interlocking organic flow patterns from pure randomness',
  algorithmNotes:
    'In the classic Truchet tiling (Sébastien Truchet, 1704) each cell contains two quarter-circle arcs connecting midpoints of adjacent sides; the cell is rotated 0° or 90°. Variant 0: arcs centered at the TL and BR corners trace smooth flowing curves across cells. Variant 1 (Smith, 1987): diagonal lines at ±45°. Variant 2 (quarter): a filled quarter-circle wedge in one corner. Orientation is drawn from a seeded RNG per cell for static renders. In "wave" mode a slow noise field advances over time, computing orientation as sign(fBm(col,row,t)) so tile-flip boundaries sweep through the canvas. In "flow" mode orientation is a continuous function of fBm, giving a smoothly morphing liquid appearance.',
  parameterSchema,
  defaultParams: {
    cellSize: 60, variant: 'arc', strokeWidth: 2,
    colorMode: 'two-tone', background: 'dark',
    animMode: 'wave', speed: 0.3,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const s       = Math.max(5, (params.cellSize ?? 60) | 0);
    const variant = params.variant   ?? 'arc';
    const sw      = params.strokeWidth ?? 2;
    const cm      = params.colorMode ?? 'two-tone';
    const bg      = params.background ?? 'dark';
    const anim    = params.animMode  ?? 'wave';
    const t       = time * (params.speed ?? 0.3);

    const bgCol  = BG[bg] ?? BG.dark;
    const isLight = bg === 'light';

    ctx.fillStyle = bgCol;
    ctx.fillRect(0, 0, w, h);

    const rng   = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const cols  = Math.ceil(w / s) + 1;
    const rows  = Math.ceil(h / s) + 1;

    const c0 = hexToRgb(palette.colors[0]);
    const c1 = hexToRgb(palette.colors[Math.min(1, palette.colors.length - 1)]);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = col * s;
        const cy = row * s;

        // Determine orientation (0 or 1) per cell
        let orientation: number;
        if (anim === 'none' || time === 0) {
          orientation = rng.integer(0, 1);
        } else if (anim === 'wave') {
          // Noise field advances with time → flipping wavefront sweeps through
          const v = noise.fbm(col * 0.18 + t * 0.15, row * 0.18 + t * 0.09, 2, 2, 0.5);
          orientation = v > 0 ? 0 : 1;
        } else { // flow: continuous, each cell has a slow smooth phase
          const v = noise.fbm(col * 0.12, row * 0.12 + t * 0.2, 3, 2, 0.5);
          orientation = v > 0 ? 0 : 1;
        }

        // Pick colors
        const [fr, fg, fb] = orientation === 0 ? c0 : c1;
        const [br2, bg2, bb2] = orientation === 0 ? c1 : c0;

        if (variant === 'arc') {
          // Two-tone fill: fill cell bg, then cut two arc wedges
          if (cm === 'two-tone') {
            ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
            ctx.fillRect(cx, cy, s, s);
            ctx.fillStyle = `rgb(${br2},${bg2},${bb2})`;
            if (orientation === 0) {
              // Corner fills at TL and BR
              ctx.beginPath(); ctx.moveTo(cx, cy);
              ctx.arc(cx, cy, s, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
              ctx.beginPath(); ctx.moveTo(cx + s, cy + s);
              ctx.arc(cx + s, cy + s, s, Math.PI, 3 * Math.PI / 2); ctx.closePath(); ctx.fill();
            } else {
              // Corner fills at TR and BL
              ctx.beginPath(); ctx.moveTo(cx + s, cy);
              ctx.arc(cx + s, cy, s, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill();
              ctx.beginPath(); ctx.moveTo(cx, cy + s);
              ctx.arc(cx, cy + s, s, 3 * Math.PI / 2, 2 * Math.PI); ctx.closePath(); ctx.fill();
            }
          }

          // Draw arc strokes (always)
          const strokeCol = cm === 'mono'
            ? `rgb(${fr},${fg},${fb})`
            : isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.35)';
          ctx.strokeStyle = strokeCol;
          ctx.lineWidth = sw;

          if (orientation === 0) {
            ctx.beginPath(); ctx.arc(cx,     cy,     s / 2, 0,           Math.PI / 2);   ctx.stroke();
            ctx.beginPath(); ctx.arc(cx + s, cy + s, s / 2, Math.PI,     3 * Math.PI / 2); ctx.stroke();
          } else {
            ctx.beginPath(); ctx.arc(cx + s, cy,     s / 2, Math.PI / 2, Math.PI);       ctx.stroke();
            ctx.beginPath(); ctx.arc(cx,     cy + s, s / 2, -Math.PI / 2, 0);             ctx.stroke();
          }

        } else if (variant === 'diagonal') {
          const [lr, lg, lb] = cm === 'depth'
            ? hexToRgb(palette.colors[Math.round(orientation * (palette.colors.length - 1))])
            : (cm === 'mono' ? c0 : (orientation === 0 ? c0 : c1));

          if (cm === 'two-tone') {
            // Fill two triangles
            ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
            ctx.beginPath();
            if (orientation === 0) {
              ctx.moveTo(cx, cy); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s);
            } else {
              ctx.moveTo(cx, cy); ctx.lineTo(cx + s, cy); ctx.lineTo(cx + s, cy + s);
            }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = `rgb(${br2},${bg2},${bb2})`;
            ctx.beginPath();
            if (orientation === 0) {
              ctx.moveTo(cx + s, cy); ctx.lineTo(cx + s, cy + s); ctx.lineTo(cx, cy + s);
            } else {
              ctx.moveTo(cx, cy); ctx.lineTo(cx + s, cy + s); ctx.lineTo(cx, cy + s);
            }
            ctx.closePath(); ctx.fill();
          }

          ctx.strokeStyle = `rgb(${lr},${lg},${lb})`;
          ctx.lineWidth = sw;
          ctx.beginPath();
          if (orientation === 0) {
            ctx.moveTo(cx, cy + s); ctx.lineTo(cx + s, cy);       // ↗
          } else {
            ctx.moveTo(cx, cy);     ctx.lineTo(cx + s, cy + s);   // ↘
          }
          ctx.stroke();

        } else { // quarter — filled wedge
          const wedgeColor = cm === 'depth'
            ? hexToRgb(palette.colors[Math.round(orientation * (palette.colors.length - 1))])
            : (orientation === 0 ? c0 : c1);
          const [wr, wg, wb] = wedgeColor;

          ctx.fillStyle = `rgb(${wr},${wg},${wb})`;
          ctx.beginPath();
          if (orientation === 0) {
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, s * 0.9, 0, Math.PI / 2);
          } else {
            ctx.moveTo(cx + s, cy);
            ctx.arc(cx + s, cy, s * 0.9, Math.PI / 2, Math.PI);
          }
          ctx.closePath(); ctx.fill();

          if (cm !== 'depth') {
            ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const cells = (800 / (params.cellSize ?? 60)) ** 2;
    return (cells * 5) | 0;
  },
};
