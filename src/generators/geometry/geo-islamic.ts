import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Draw a regular star polygon {n/k}: vertices of an n-gon, connected every k-th */
function starPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, R: number,
  n: number, k: number,
  phase: number
): void {
  const outer = R;
  const inner = R * Math.sin((Math.PI / n) * (k - 1)) / Math.sin((Math.PI / n) * k);
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const theta = phase + (i * Math.PI) / n;
    pts.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Hexagonal tiling: axial coords → pixel centers */
function hexCenter(q: number, r: number, size: number): [number, number] {
  const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const y = size * (3 / 2 * r);
  return [x, y];
}

const parameterSchema: ParameterSchema = {
  starPoints: {
    name: 'Star Points (n)', type: 'number', min: 4, max: 16, step: 1, default: 8,
    help: 'Vertices of the primary star polygon — 6 = hexagram, 8 = octagram, 12 = dodecagram',
    group: 'Geometry',
  },
  starSkip: {
    name: 'Skip (k)', type: 'number', min: 2, max: 7, step: 1, default: 3,
    help: 'Every k-th vertex is connected. Must be < n/2. Star {n/k}: {6/2}=hexagram, {8/3}=octagram',
    group: 'Geometry',
  },
  tiling: {
    name: 'Tiling', type: 'select', options: ['square', 'hexagonal', 'triangular'], default: 'square',
    help: 'Grid symmetry used to tile stars across the canvas',
    group: 'Composition',
  },
  layers: {
    name: 'Layers', type: 'number', min: 1, max: 3, step: 1, default: 2,
    help: 'Number of concentric star rings per tile cell',
    group: 'Composition',
  },
  strokeWidth: {
    name: 'Stroke Width', type: 'number', min: 0.5, max: 5, step: 0.5, default: 1.5,
    group: 'Texture',
  },
  fill: {
    name: 'Fill Alternating', type: 'boolean', default: true,
    help: 'Fill star interiors with alternating palette colors',
    group: 'Color',
  },
  showGrid: {
    name: 'Show Grid', type: 'boolean', default: false,
    help: 'Draw the underlying tiling grid lines',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['spin', 'kaleidoscope', 'none'], default: 'spin',
    help: 'spin: rotate all stars in place | kaleidoscope: alternate rows spin opposite directions',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.2,
    group: 'Flow/Motion',
  },
  cellSize: {
    name: 'Cell Size', type: 'number', min: 40, max: 300, step: 10, default: 100,
    help: 'Pixel size of each tiling cell',
    group: 'Geometry',
  },
};

export const geoIslamic: Generator = {
  id: 'geo-islamic',
  family: 'geometry',
  styleName: 'Islamic Patterns',
  definition: 'Star polygon tilings inspired by classical Islamic geometric art — regular stars arrayed on square, hexagonal, or triangular grids with interlocking girih-style bands',
  algorithmNotes:
    'Each tile cell contains a regular star polygon {n/k} constructed by connecting every k-th vertex of a regular n-gon. The inner radius of the star is set so that adjacent stars interlock at cell boundaries: r_inner = R·sin(π(k-1)/n)/sin(πk/n). Square tiling places stars at integer multiples of cell size; hexagonal tiling uses axial coordinates (flat-top hex). Multiple concentric layers per cell fill the cell interior with decreasing-size stars. The phase angle is advanced by time for smooth rotation animation; alternating rows can spin opposite directions for a kaleidoscope effect.',
  parameterSchema,
  defaultParams: {
    starPoints: 8, starSkip: 3, tiling: 'square', layers: 2,
    strokeWidth: 1.5, fill: true, showGrid: false,
    animMode: 'spin', speed: 0.2, cellSize: 100,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const n         = Math.max(3, Math.min(16, (params.starPoints ?? 8) | 0));
    const k         = Math.max(2, Math.min(Math.floor(n/2) - 1, (params.starSkip ?? 3) | 0));
    const tiling    = params.tiling    ?? 'square';
    const layers    = Math.max(1, Math.min(3, (params.layers ?? 2) | 0));
    const sw        = params.strokeWidth ?? 1.5;
    const doFill    = params.fill ?? true;
    const showGrid  = params.showGrid ?? false;
    const animMode  = params.animMode ?? 'spin';
    const speed     = params.speed ?? 0.2;
    const cellSize  = Math.max(20, (params.cellSize ?? 100) | 0);
    const t         = time * speed;

    const colors = palette.colors.map(hexToRgb);

    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    // Collect tile centers
    const centers: { x: number; y: number; col: number; row: number }[] = [];

    if (tiling === 'hexagonal') {
      const hexR = cellSize;
      // Hex grid bounds
      const qRange = Math.ceil(w / (hexR * Math.sqrt(3))) + 2;
      const rRange = Math.ceil(h / (hexR * 1.5)) + 2;
      for (let r = -rRange; r <= rRange; r++) {
        for (let q = -qRange; q <= qRange; q++) {
          const [hx, hy] = hexCenter(q, r, hexR);
          const px = hx + w / 2;
          const py = hy + h / 2;
          if (px > -hexR * 2 && px < w + hexR * 2 && py > -hexR * 2 && py < h + hexR * 2)
            centers.push({ x: px, y: py, col: q, row: r });
        }
      }
    } else if (tiling === 'triangular') {
      const step = cellSize;
      const rowH = step * Math.sqrt(3) / 2;
      for (let row = -2; row <= Math.ceil(h / rowH) + 2; row++) {
        for (let col = -2; col <= Math.ceil(w / step) + 2; col++) {
          const px = col * step + (row % 2 ? step * 0.5 : 0);
          const py = row * rowH;
          centers.push({ x: px, y: py, col, row });
        }
      }
    } else { // square
      for (let row = -2; row <= Math.ceil(h / cellSize) + 2; row++) {
        for (let col = -2; col <= Math.ceil(w / cellSize) + 2; col++) {
          centers.push({ x: col * cellSize + cellSize / 2, y: row * cellSize + cellSize / 2, col, row });
        }
      }
    }

    // Optional grid
    if (showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      if (tiling === 'square') {
        for (let x = 0; x < w; x += cellSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = 0; y < h; y += cellSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      }
    }

    // Draw stars
    for (const { x, y, col, row } of centers) {
      for (let L = 0; L < layers; L++) {
        const starR = cellSize * 0.48 * (1 - L * 0.3);
        const ci    = (col + row + L) % colors.length;
        const [cr, cg, cb] = colors[Math.abs(ci) % colors.length];

        // Phase for animation
        let phase = -Math.PI / 2; // point up by default
        if (animMode === 'spin') {
          phase += t;
        } else if (animMode === 'kaleidoscope') {
          // Alternate cells spin opposite directions
          const sign = ((col + row) % 2 === 0) ? 1 : -1;
          phase += t * sign;
        }
        // Add layer rotation offset
        phase += L * (Math.PI / n);

        starPolygon(ctx, x, y, starR, n, k, phase);

        if (doFill && L === 0) {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.18)`;
          ctx.fill();
        }
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.9)`;
        ctx.lineWidth = sw;
        ctx.stroke();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const cells = Math.ceil(800 / (params.cellSize ?? 100)) ** 2;
    return (cells * (params.layers ?? 2) * 10) | 0;
  },
};
