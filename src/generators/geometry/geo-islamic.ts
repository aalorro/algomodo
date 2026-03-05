import type { Generator, ParameterSchema } from '../../types';
import { SVGPathBuilder } from '../../renderers/svg/builder';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpRgb(colors: [number, number, number][], t: number): [number, number, number] {
  if (colors.length === 0) return [128, 128, 128];
  if (colors.length === 1) return colors[0];
  const ci = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1), f = ci - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

/** Return vertices of a star polygon {n/k} centered at (cx, cy) with outer radius R */
function starPolygonPoints(
  cx: number, cy: number, R: number,
  n: number, k: number, phase: number,
): [number, number][] {
  const outer = R;
  const inner = R * Math.sin((Math.PI / n) * (k - 1)) / Math.sin((Math.PI / n) * k);
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const theta = phase + (i * Math.PI) / n;
    pts.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
  }
  return pts;
}

/** Draw a closed Canvas2D path from a vertex array */
function drawStarPath(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** Return vertices of a regular n-gon */
function regularPolygonPoints(
  cx: number, cy: number, r: number, n: number, phase: number,
): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const theta = phase + (i * 2 * Math.PI) / n;
    pts.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
  }
  return pts;
}

/** Hexagonal tiling: axial coords → pixel centers */
function hexCenter(q: number, r: number, size: number): [number, number] {
  const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const y = size * (3 / 2 * r);
  return [x, y];
}

interface TileCenter { x: number; y: number; col: number; row: number }

function buildCenters(tiling: string, cellSize: number, w: number, h: number): TileCenter[] {
  const centers: TileCenter[] = [];
  if (tiling === 'hexagonal') {
    const hexR = cellSize;
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
  return centers;
}

/** Resolve color for a tile cell based on color mode */
function resolveColor(
  colorMode: string, colors: [number, number, number][],
  col: number, row: number, layer: number,
  x: number, y: number, cx: number, cy: number, maxDist: number,
): [number, number, number] {
  if (colorMode === 'radial') {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return lerpRgb(colors, Math.min(1, dist / maxDist));
  }
  if (colorMode === 'layered') {
    return colors[layer % colors.length];
  }
  if (colorMode === 'monochrome') {
    return colors[0];
  }
  // 'classic': alternating palette fills
  const ci = (col + row + layer) % colors.length;
  return colors[Math.abs(ci) % colors.length];
}

/** Compute animation phase for a cell */
function computePhase(
  animMode: string, t: number, col: number, row: number,
  layer: number, n: number, x: number, y: number, cx: number, cy: number,
): number {
  let phase = -Math.PI / 2; // point up by default
  if (animMode === 'spin') {
    phase += t;
  } else if (animMode === 'kaleidoscope') {
    const sign = ((col + row) % 2 === 0) ? 1 : -1;
    phase += t * sign;
  } else if (animMode === 'wave') {
    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    phase += Math.sin(dist * 0.02 - t) * 0.3;
  }
  // breathe doesn't affect phase — it affects starR externally
  // Layer rotation offset
  phase += layer * (Math.PI / n);
  return phase;
}

/** Neighbor offsets per tiling for girih line computation */
function getNeighborOffsets(tiling: string): [number, number][] {
  if (tiling === 'square') return [[1, 0], [0, 1], [-1, 0], [0, -1]];
  // hex & triangular use same axial-like neighbor set
  return [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
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
  cellSize: {
    name: 'Cell Size', type: 'number', min: 40, max: 300, step: 10, default: 100,
    help: 'Pixel size of each tiling cell',
    group: 'Geometry',
  },
  strokeWidth: {
    name: 'Stroke Width', type: 'number', min: 0.5, max: 5, step: 0.5, default: 1.5,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['classic', 'radial', 'layered', 'monochrome'], default: 'classic',
    help: 'classic: alternating palette fills | radial: distance gradient | layered: per-ring color | monochrome: single stroke color',
    group: 'Color',
  },
  girihLines: {
    name: 'Girih Lines', type: 'boolean', default: true,
    help: 'Draw connecting lines between adjacent star tips — the characteristic interlocking web',
    group: 'Geometry',
  },
  doubleLine: {
    name: 'Double Line', type: 'boolean', default: false,
    help: 'Two parallel strokes per edge, creating a band/ribbon effect',
    group: 'Texture',
  },
  innerDetail: {
    name: 'Inner Detail', type: 'boolean', default: true,
    help: 'Draw a small regular polygon at each star center (rosette look)',
    group: 'Geometry',
  },
  animMode: {
    name: 'Anim Mode', type: 'select',
    options: ['spin', 'kaleidoscope', 'breathe', 'wave', 'none'], default: 'spin',
    help: 'spin: rotate stars | kaleidoscope: alternate directions | breathe: pulse size | wave: ripple from center',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.2,
    group: 'Flow/Motion',
  },
};

export const geoIslamic: Generator = {
  id: 'geo-islamic',
  family: 'geometry',
  styleName: 'Islamic Patterns',
  definition: 'Star polygon tilings inspired by classical Islamic geometric art — regular stars on square, hexagonal, or triangular grids with girih connecting lines, inner rosette details, and multiple coloring modes',
  algorithmNotes:
    'Each tile cell contains a regular star polygon {n/k} with inner radius set for interlocking at boundaries. ' +
    'Girih lines connect adjacent star tips to create the characteristic interlocking web. Inner rosette polygons ' +
    'add detail at each star center. Color modes include classic alternating, radial gradient, per-layer, and monochrome. ' +
    'Double-line mode strokes each edge as a band/ribbon. Animation modes: spin, kaleidoscope, breathe (pulsing), wave (ripple).',
  parameterSchema,
  defaultParams: {
    starPoints: 8, starSkip: 3, tiling: 'square', layers: 2, cellSize: 100,
    strokeWidth: 1.5, colorMode: 'classic', girihLines: true, doubleLine: false,
    innerDetail: true, animMode: 'spin', speed: 0.2,
  },
  supportsVector: true,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const n         = Math.max(3, Math.min(16, (params.starPoints ?? 8) | 0));
    const k         = Math.max(2, Math.min(Math.floor(n / 2) - 1, (params.starSkip ?? 3) | 0));
    const tiling    = params.tiling ?? 'square';
    const layers    = Math.max(1, Math.min(3, (params.layers ?? 2) | 0));
    const sw        = params.strokeWidth ?? 1.5;
    const colorMode = params.colorMode ?? 'classic';
    const girih     = params.girihLines ?? true;
    const dbl       = params.doubleLine ?? false;
    const innerDtl  = params.innerDetail ?? true;
    const animMode  = params.animMode ?? 'spin';
    const speed     = params.speed ?? 0.2;
    const cellSize  = Math.max(20, (params.cellSize ?? 100) | 0);
    const t         = time * speed;

    const colors = palette.colors.map(hexToRgb);
    const midX = w / 2, midY = h / 2;
    const maxDist = Math.sqrt(midX * midX + midY * midY);

    // Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    const centers = buildCenters(tiling, cellSize, w, h);

    // ── Pass 1: Girih connecting lines ──
    if (girih) {
      const centerMap = new Map<string, TileCenter>();
      for (const c of centers) centerMap.set(`${c.col},${c.row}`, c);
      const offsets = getNeighborOffsets(tiling);

      ctx.lineCap = 'round';
      ctx.lineWidth = sw * 0.5;

      for (const center of centers) {
        const phase = computePhase(animMode, t, center.col, center.row, 0, n, center.x, center.y, midX, midY);
        let starR = cellSize * 0.48;
        if (animMode === 'breathe') starR *= 0.85 + 0.15 * Math.sin(t * 2);
        const pts = starPolygonPoints(center.x, center.y, starR, n, k, phase);
        // Outer tips are at even indices
        const outerTips = pts.filter((_, i) => i % 2 === 0);

        for (const [dq, dr] of offsets) {
          const nKey = `${center.col + dq},${center.row + dr}`;
          const neighbor = centerMap.get(nKey);
          if (!neighbor) continue;
          // Only draw each pair once
          if (nKey <= `${center.col},${center.row}`) continue;

          const nPhase = computePhase(animMode, t, neighbor.col, neighbor.row, 0, n, neighbor.x, neighbor.y, midX, midY);
          let nStarR = cellSize * 0.48;
          if (animMode === 'breathe') nStarR *= 0.85 + 0.15 * Math.sin(t * 2);
          const nPts = starPolygonPoints(neighbor.x, neighbor.y, nStarR, n, k, nPhase);
          const nOuterTips = nPts.filter((_, i) => i % 2 === 0);

          // Find closest pair of tips
          let minD = Infinity, bestA = outerTips[0], bestB = nOuterTips[0];
          for (const a of outerTips) {
            for (const b of nOuterTips) {
              const d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
              if (d2 < minD) { minD = d2; bestA = a; bestB = b; }
            }
          }

          const [cr, cg, cb] = resolveColor(colorMode, colors, center.col, center.row, 0, center.x, center.y, midX, midY, maxDist);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.4)`;
          ctx.beginPath();
          ctx.moveTo(bestA[0], bestA[1]);
          ctx.lineTo(bestB[0], bestB[1]);
          ctx.stroke();
        }
      }
    }

    // ── Pass 2: Stars, fills, strokes, inner detail ──
    for (const { x, y, col, row } of centers) {
      for (let L = 0; L < layers; L++) {
        let starR = cellSize * 0.48 * (1 - L * 0.3);
        if (animMode === 'breathe') starR *= 0.85 + 0.15 * Math.sin(t * 2 + L * 0.5);
        const phase = computePhase(animMode, t, col, row, L, n, x, y, midX, midY);
        const pts = starPolygonPoints(x, y, starR, n, k, phase);
        const [cr, cg, cb] = resolveColor(colorMode, colors, col, row, L, x, y, midX, midY, maxDist);

        // Fill
        drawStarPath(ctx, pts);
        if (colorMode === 'classic') {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.85)`;
          ctx.fill();
        } else if (colorMode === 'monochrome') {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.08)`;
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(${cr},${cg},${cb},0.6)`;
          ctx.fill();
        }

        // Stroke
        if (dbl && sw >= 1) {
          // Double-line: wide color stroke + narrow background stroke
          drawStarPath(ctx, pts);
          ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
          ctx.lineWidth = sw * 1.8;
          ctx.lineJoin = 'round';
          ctx.stroke();

          drawStarPath(ctx, pts);
          ctx.strokeStyle = '#050505';
          ctx.lineWidth = Math.max(0.5, sw * 0.8);
          ctx.stroke();
        } else {
          drawStarPath(ctx, pts);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.9)`;
          ctx.lineWidth = sw;
          ctx.lineJoin = 'miter';
          ctx.stroke();
        }

        // Inner detail: rosette polygon at center
        if (innerDtl && L === 0) {
          const innerR = starR * 0.25;
          const innerPts = regularPolygonPoints(x, y, innerR, n, phase);
          ctx.beginPath();
          ctx.moveTo(innerPts[0][0], innerPts[0][1]);
          for (let i = 1; i < innerPts.length; i++) ctx.lineTo(innerPts[i][0], innerPts[i][1]);
          ctx.closePath();
          if (colorMode !== 'monochrome') {
            ctx.fillStyle = `rgba(${cr},${cg},${cb},0.3)`;
            ctx.fill();
          }
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.7)`;
          ctx.lineWidth = sw * 0.7;
          ctx.stroke();
        }
      }
    }
  },

  renderVector(params, seed, palette) {
    const builder = new SVGPathBuilder();
    const w = 1080, h = 1080;

    const n         = Math.max(3, Math.min(16, (params.starPoints ?? 8) | 0));
    const k         = Math.max(2, Math.min(Math.floor(n / 2) - 1, (params.starSkip ?? 3) | 0));
    const tiling    = params.tiling ?? 'square';
    const layers    = Math.max(1, Math.min(3, (params.layers ?? 2) | 0));
    const sw        = params.strokeWidth ?? 1.5;
    const colorMode = params.colorMode ?? 'classic';
    const girih     = params.girihLines ?? true;
    const innerDtl  = params.innerDetail ?? true;
    const cellSize  = Math.max(20, (params.cellSize ?? 100) | 0);

    const colors = palette.colors.map(hexToRgb);
    const midX = w / 2, midY = h / 2;
    const maxDist = Math.sqrt(midX * midX + midY * midY);

    const centers = buildCenters(tiling, cellSize, w, h);

    // Girih lines
    if (girih) {
      const centerMap = new Map<string, TileCenter>();
      for (const c of centers) centerMap.set(`${c.col},${c.row}`, c);
      const offsets = getNeighborOffsets(tiling);

      for (const center of centers) {
        const phase = -Math.PI / 2;
        const starR = cellSize * 0.48;
        const pts = starPolygonPoints(center.x, center.y, starR, n, k, phase);
        const outerTips = pts.filter((_, i) => i % 2 === 0);

        for (const [dq, dr] of offsets) {
          const nKey = `${center.col + dq},${center.row + dr}`;
          const neighbor = centerMap.get(nKey);
          if (!neighbor) continue;
          if (nKey <= `${center.col},${center.row}`) continue;

          const nPts = starPolygonPoints(neighbor.x, neighbor.y, starR, n, k, phase);
          const nOuterTips = nPts.filter((_, i) => i % 2 === 0);

          let minD = Infinity, bestA = outerTips[0], bestB = nOuterTips[0];
          for (const a of outerTips) {
            for (const b of nOuterTips) {
              const d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
              if (d2 < minD) { minD = d2; bestA = a; bestB = b; }
            }
          }

          const [cr, cg, cb] = resolveColor(colorMode, colors, center.col, center.row, 0, center.x, center.y, midX, midY, maxDist);
          builder.addLine(bestA[0], bestA[1], bestB[0], bestB[1], `rgb(${cr},${cg},${cb})`, sw * 0.5, 0.4);
        }
      }
    }

    // Stars and inner details
    for (const { x, y, col, row } of centers) {
      for (let L = 0; L < layers; L++) {
        const starR = cellSize * 0.48 * (1 - L * 0.3);
        const phase = -Math.PI / 2 + L * (Math.PI / n);
        const pts = starPolygonPoints(x, y, starR, n, k, phase);
        const [cr, cg, cb] = resolveColor(colorMode, colors, col, row, L, x, y, midX, midY, maxDist);
        const hexColor = `rgb(${cr},${cg},${cb})`;

        const fillOpacity = colorMode === 'classic' ? 0.85 : colorMode === 'monochrome' ? 0.08 : 0.6;
        const fillColor = colorMode === 'monochrome' ? undefined : hexColor;
        builder.addPolygon(pts, fillColor, hexColor, sw, fillOpacity);

        if (innerDtl && L === 0) {
          const innerPts = regularPolygonPoints(x, y, starR * 0.25, n, phase);
          const innerFill = colorMode !== 'monochrome' ? hexColor : undefined;
          builder.addPolygon(innerPts, innerFill, hexColor, sw * 0.7, 0.5);
        }
      }
    }

    return builder.getPaths();
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const cells = Math.ceil(800 / (params.cellSize ?? 100)) ** 2;
    const baseCost = cells * (params.layers ?? 2) * 10;
    const girihCost = (params.girihLines ?? true) ? cells * 4 : 0;
    const detailCost = (params.innerDetail ?? true) ? cells * 2 : 0;
    return (baseCost + girihCost + detailCost) | 0;
  },
};
