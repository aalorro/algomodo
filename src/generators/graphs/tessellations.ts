import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';
import { SVGPathBuilder } from '../../renderers/svg/builder';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  const s = v * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

interface Tile {
  vertices: [number, number][];
  centroid: [number, number];
  index: number;
  row: number;
  col: number;
}

// ---- Tiling generators ----

function triangularTiles(cellSize: number, w: number, h: number): Tile[] {
  const tiles: Tile[] = [];
  const s = cellSize;
  const triH = s * Math.sqrt(3) / 2;
  const cols = Math.ceil(w / s) + 1;
  const rows = Math.ceil(h / triH) + 1;
  let idx = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * s + (r % 2 === 1 ? s / 2 : 0);
      const y = r * triH;

      // Up-pointing triangle
      const v1: [number, number][] = [[x, y + triH], [x + s, y + triH], [x + s / 2, y]];
      const cx1 = (v1[0][0] + v1[1][0] + v1[2][0]) / 3;
      const cy1 = (v1[0][1] + v1[1][1] + v1[2][1]) / 3;
      tiles.push({ vertices: v1, centroid: [cx1, cy1], index: idx++, row: r, col: c * 2 });

      // Down-pointing triangle
      const v2: [number, number][] = [[x + s / 2, y], [x + s, y + triH], [x + s * 1.5, y]];
      const cx2 = (v2[0][0] + v2[1][0] + v2[2][0]) / 3;
      const cy2 = (v2[0][1] + v2[1][1] + v2[2][1]) / 3;
      tiles.push({ vertices: v2, centroid: [cx2, cy2], index: idx++, row: r, col: c * 2 + 1 });
    }
  }
  return tiles;
}

function squareTiles(cellSize: number, w: number, h: number): Tile[] {
  const tiles: Tile[] = [];
  const cols = Math.ceil(w / cellSize) + 1;
  const rows = Math.ceil(h / cellSize) + 1;
  let idx = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellSize, y = r * cellSize;
      const verts: [number, number][] = [[x, y], [x + cellSize, y], [x + cellSize, y + cellSize], [x, y + cellSize]];
      tiles.push({ vertices: verts, centroid: [x + cellSize / 2, y + cellSize / 2], index: idx++, row: r, col: c });
    }
  }
  return tiles;
}

function hexagonalTiles(cellSize: number, w: number, h: number): Tile[] {
  const tiles: Tile[] = [];
  const r = cellSize / 2;
  const hexW = r * 2;
  const hexH = r * Math.sqrt(3);
  const cols = Math.ceil(w / (hexW * 0.75)) + 2;
  const rows = Math.ceil(h / hexH) + 2;
  let idx = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * hexW * 0.75;
      const cy = row * hexH + (col % 2 === 1 ? hexH / 2 : 0);
      const verts: [number, number][] = [];
      for (let k = 0; k < 6; k++) {
        const angle = (Math.PI / 3) * k - Math.PI / 6;
        verts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
      }
      tiles.push({ vertices: verts, centroid: [cx, cy], index: idx++, row, col });
    }
  }
  return tiles;
}

function penroseTiles(cellSize: number, w: number, h: number): Tile[] {
  // Robinson triangle subdivision for Penrose P2 tiling
  const phi = (1 + Math.sqrt(5)) / 2;
  type RTri = { type: 0 | 1; a: [number, number]; b: [number, number]; c: [number, number] };

  // Start with a decagon of triangles
  let triangles: RTri[] = [];
  const cx = w / 2, cy = h / 2;
  const R = Math.max(w, h) * 0.8;
  for (let i = 0; i < 10; i++) {
    const a0 = (2 * Math.PI * i) / 10 - Math.PI / 2;
    const a1 = (2 * Math.PI * (i + 1)) / 10 - Math.PI / 2;
    const p0: [number, number] = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
    const p1: [number, number] = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
    if (i % 2 === 0) {
      triangles.push({ type: 0, a: [cx, cy], b: p0, c: p1 });
    } else {
      triangles.push({ type: 0, a: [cx, cy], b: p1, c: p0 });
    }
  }

  // Subdivide based on cellSize
  const depth = Math.max(2, Math.min(7, Math.round(Math.log(R / cellSize) / Math.log(phi) + 1)));
  for (let d = 0; d < depth; d++) {
    const next: RTri[] = [];
    for (const tri of triangles) {
      if (tri.type === 0) {
        // Acute (thin) triangle
        const p: [number, number] = [
          tri.a[0] + (tri.b[0] - tri.a[0]) / phi,
          tri.a[1] + (tri.b[1] - tri.a[1]) / phi,
        ];
        next.push({ type: 0, a: tri.c, b: p, c: tri.b });
        next.push({ type: 1, a: p, b: tri.c, c: tri.a });
      } else {
        // Obtuse (thick) triangle
        const q: [number, number] = [
          tri.b[0] + (tri.a[0] - tri.b[0]) / phi,
          tri.b[1] + (tri.a[1] - tri.b[1]) / phi,
        ];
        const r: [number, number] = [
          tri.b[0] + (tri.c[0] - tri.b[0]) / phi,
          tri.b[1] + (tri.c[1] - tri.b[1]) / phi,
        ];
        next.push({ type: 1, a: r, b: tri.c, c: tri.a });
        next.push({ type: 1, a: q, b: r, c: tri.b });
        next.push({ type: 0, a: r, b: q, c: tri.a });
      }
    }
    triangles = next;
  }

  // Convert pairs of triangles to rhombuses where possible, or just output triangles as tiles
  const tiles: Tile[] = [];
  let idx = 0;
  for (const tri of triangles) {
    const verts: [number, number][] = [tri.a, tri.b, tri.c];
    const centroid: [number, number] = [
      (tri.a[0] + tri.b[0] + tri.c[0]) / 3,
      (tri.a[1] + tri.b[1] + tri.c[1]) / 3,
    ];
    tiles.push({ vertices: verts, centroid, index: idx++, row: 0, col: idx });
  }
  return tiles;
}

function cairoTiles(cellSize: number, w: number, h: number): Tile[] {
  const tiles: Tile[] = [];
  const s = cellSize;
  const cols = Math.ceil(w / s) + 1;
  const rows = Math.ceil(h / s) + 1;
  let idx = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * s, y = r * s;
      const cx = x + s / 2, cy = y + s / 2;
      const m = s * 0.25;

      // 4 pentagons per cell
      const quads: [number, number][][] = [
        [[x, y], [x + s / 2, y], [cx + m, cy - m], [cx, cy], [x, y + s / 2]],
        [[x + s / 2, y], [x + s, y], [x + s, y + s / 2], [cx + m, cy - m + m * 2], [cx + m, cy - m]],
        [[x + s, y + s / 2], [x + s, y + s], [x + s / 2, y + s], [cx - m, cy + m], [cx + m, cy + m]],
        [[x + s / 2, y + s], [x, y + s], [x, y + s / 2], [cx - m, cy - m + m * 2], [cx - m, cy + m]],
      ];

      for (const verts of quads) {
        const pcx = verts.reduce((a, v) => a + v[0], 0) / verts.length;
        const pcy = verts.reduce((a, v) => a + v[1], 0) / verts.length;
        tiles.push({ vertices: verts as [number, number][], centroid: [pcx, pcy], index: idx++, row: r, col: c });
      }
    }
  }
  return tiles;
}

function applyJitter(tiles: Tile[], jitter: number, cellSize: number, rng: SeededRNG): void {
  if (jitter <= 0) return;
  // Shared vertex jitter: use coordinate key to ensure same displacement
  const cache = new Map<string, [number, number]>();
  const getDisp = (x: number, y: number): [number, number] => {
    const key = `${Math.round(x * 10)}:${Math.round(y * 10)}`;
    let d = cache.get(key);
    if (!d) {
      d = [rng.gaussian(0, jitter * cellSize * 0.5), rng.gaussian(0, jitter * cellSize * 0.5)];
      cache.set(key, d);
    }
    return d;
  };

  for (const tile of tiles) {
    for (let i = 0; i < tile.vertices.length; i++) {
      const [dx, dy] = getDisp(tile.vertices[i][0], tile.vertices[i][1]);
      tile.vertices[i] = [tile.vertices[i][0] + dx, tile.vertices[i][1] + dy];
    }
    // Recompute centroid
    const n = tile.vertices.length;
    tile.centroid = [
      tile.vertices.reduce((a, v) => a + v[0], 0) / n,
      tile.vertices.reduce((a, v) => a + v[1], 0) / n,
    ];
  }
}

const parameterSchema: ParameterSchema = {
  tilingType: {
    name: 'Tiling Type', type: 'select',
    options: ['triangular', 'square', 'hexagonal', 'penrose', 'cairo'],
    default: 'hexagonal', help: 'Type of tessellation pattern', group: 'Composition',
  },
  cellSize: {
    name: 'Cell Size', type: 'number', min: 15, max: 200, step: 5, default: 50,
    help: 'Approximate tile size in pixels', group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0, max: 5, step: 0.5, default: 1.5,
    group: 'Geometry',
  },
  edgeStyle: {
    name: 'Edge Style', type: 'select', options: ['dark', 'light', 'palette', 'none'],
    default: 'dark', group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['checkerboard', 'palette-cycle', 'radial-gradient', 'noise-field', 'monochrome'],
    default: 'palette-cycle', group: 'Color',
  },
  fillOpacity: {
    name: 'Fill Opacity', type: 'number', min: 0.1, max: 1, step: 0.05, default: 0.85,
    group: 'Color',
  },
  innerDetail: {
    name: 'Inner Detail', type: 'select',
    options: ['none', 'centroid-dot', 'subdivision', 'inscribed-circle'],
    default: 'none', group: 'Texture',
  },
  jitter: {
    name: 'Vertex Jitter', type: 'number', min: 0, max: 0.4, step: 0.02, default: 0,
    help: 'Random vertex displacement for organic look', group: 'Texture',
  },
  animMode: {
    name: 'Animation', type: 'select', options: ['none', 'breathe', 'wave', 'color-cycle'],
    default: 'wave', group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 1.5, step: 0.05, default: 0.3,
    group: 'Flow/Motion',
  },
};

function resolveColor(
  tile: Tile, colorMode: string, paletteIdx: number, colors: [number, number, number][],
  w: number, h: number, noise: SimplexNoise, time: number, speed: number
): [number, number, number] {
  const ci = (c: number) => colors[((c % colors.length) + colors.length) % colors.length];

  switch (colorMode) {
    case 'checkerboard':
      return ci((tile.row + tile.col) % 2 === 0 ? 0 : Math.min(1, colors.length - 1));
    case 'radial-gradient': {
      const dx = tile.centroid[0] - w / 2, dy = tile.centroid[1] - h / 2;
      const dist = Math.sqrt(dx * dx + dy * dy) / (Math.max(w, h) * 0.5);
      return paletteSample(Math.min(1, dist), colors);
    }
    case 'noise-field': {
      const nv = (noise.noise2D(tile.centroid[0] * 0.005, tile.centroid[1] * 0.005) + 1) * 0.5;
      return paletteSample(nv, colors);
    }
    case 'monochrome':
      return colors[0];
    default: { // palette-cycle
      const offset = time > 0 ? Math.floor(time * speed * 2) : 0;
      return ci(paletteIdx + offset);
    }
  }
}

function renderTiles(
  ctx: CanvasRenderingContext2D, tiles: Tile[], params: Record<string, any>,
  colors: [number, number, number][], palette: { colors: string[] },
  w: number, h: number, noise: SimplexNoise, time: number
): void {
  const edgeWidth = params.edgeWidth ?? 1.5;
  const edgeStyle = params.edgeStyle ?? 'dark';
  const colorMode = params.colorMode ?? 'palette-cycle';
  const fillOpacity = params.fillOpacity ?? 0.85;
  const innerDetail = params.innerDetail ?? 'none';
  const animMode = params.animMode ?? 'none';
  const speed = params.speed ?? 0.3;

  for (const tile of tiles) {
    let verts = tile.vertices;

    // Animation deformation
    if (time > 0 && animMode === 'breathe') {
      const scale = 1 + 0.08 * Math.sin(time * speed * 2);
      const [cx, cy] = tile.centroid;
      verts = verts.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale] as [number, number]);
    } else if (time > 0 && animMode === 'wave') {
      const [cx, cy] = tile.centroid;
      const dist = Math.sqrt((cx - w / 2) ** 2 + (cy - h / 2) ** 2);
      const offset = Math.sin(dist * 0.03 - time * speed) * (params.cellSize ?? 50) * 0.08;
      const angle = Math.atan2(cy - h / 2, cx - w / 2);
      verts = verts.map(([x, y]) => [x + Math.cos(angle) * offset, y + Math.sin(angle) * offset] as [number, number]);
    }

    // Color
    const [r, g, b] = resolveColor(tile, colorMode, tile.index, colors, w, h, noise, time, speed);

    // Fill
    ctx.beginPath();
    ctx.moveTo(verts[0][0], verts[0][1]);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i][0], verts[i][1]);
    ctx.closePath();
    ctx.fillStyle = `rgba(${r},${g},${b},${fillOpacity})`;
    ctx.fill();

    // Edges
    if (edgeStyle !== 'none' && edgeWidth > 0) {
      ctx.lineWidth = edgeWidth;
      if (edgeStyle === 'dark') ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      else if (edgeStyle === 'light') ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      else ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
      ctx.stroke();
    }

    // Inner detail
    if (innerDetail === 'centroid-dot') {
      const [cx, cy] = tile.centroid;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, (params.cellSize ?? 50) * 0.06), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${255 - r},${255 - g},${255 - b},0.5)`;
      ctx.fill();
    } else if (innerDetail === 'inscribed-circle') {
      const [cx, cy] = tile.centroid;
      // Approximate inscribed circle as fraction of cellSize
      const ir = (params.cellSize ?? 50) * 0.2;
      ctx.beginPath();
      ctx.arc(cx, cy, ir, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    } else if (innerDetail === 'subdivision' && verts.length >= 3) {
      const [cx, cy] = tile.centroid;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
      ctx.lineWidth = 0.5;
      for (const v of verts) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(v[0], v[1]);
        ctx.stroke();
      }
    }
  }
}

export const tessellations: Generator = {
  id: 'graph-tessellations',
  family: 'graphs',
  styleName: 'Tessellations',
  definition: 'Regular and semi-regular tilings — triangular, square, hexagonal, Penrose, and Cairo',
  algorithmNotes:
    'Generates tile vertices per tiling type: grid math for triangular/square/hexagonal, Robinson triangle ' +
    'recursive subdivision for Penrose P2, and quadrant pentagons for Cairo. Vertices can be jittered for ' +
    'organic look. Tiles are filled with palette colors via multiple color modes and optionally decorated ' +
    'with inner details. Animation modes: breathe (scale pulse), wave (radial ripple), color-cycle (palette shift).',
  parameterSchema,
  defaultParams: {
    tilingType: 'hexagonal', cellSize: 50, edgeWidth: 1.5, edgeStyle: 'dark',
    colorMode: 'palette-cycle', fillOpacity: 0.85, innerDetail: 'none', jitter: 0,
    animMode: 'wave', speed: 0.3,
  },
  supportsVector: true, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const colors = palette.colors.map(hexToRgb);

    const tilingType = params.tilingType ?? 'hexagonal';
    const cellSize = params.cellSize ?? 50;
    const jitter = params.jitter ?? 0;

    // Generate tiles
    let tiles: Tile[];
    switch (tilingType) {
      case 'triangular': tiles = triangularTiles(cellSize, w, h); break;
      case 'square': tiles = squareTiles(cellSize, w, h); break;
      case 'penrose': tiles = penroseTiles(cellSize, w, h); break;
      case 'cairo': tiles = cairoTiles(cellSize, w, h); break;
      default: tiles = hexagonalTiles(cellSize, w, h); break;
    }

    applyJitter(tiles, jitter, cellSize, rng);

    // Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    renderTiles(ctx, tiles, params, colors, palette, w, h, noise, time);
  },

  renderVector(params, seed, palette) {
    const builder = new SVGPathBuilder();
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const w = 1080, h = 1080;
    const colors = palette.colors.map(hexToRgb);

    const tilingType = params.tilingType ?? 'hexagonal';
    const cellSize = params.cellSize ?? 50;
    const jitter = params.jitter ?? 0;
    const colorMode = params.colorMode ?? 'palette-cycle';
    const edgeWidth = params.edgeWidth ?? 1.5;
    const edgeStyle = params.edgeStyle ?? 'dark';
    const fillOpacity = params.fillOpacity ?? 0.85;

    let tiles: Tile[];
    switch (tilingType) {
      case 'triangular': tiles = triangularTiles(cellSize, w, h); break;
      case 'square': tiles = squareTiles(cellSize, w, h); break;
      case 'penrose': tiles = penroseTiles(cellSize, w, h); break;
      case 'cairo': tiles = cairoTiles(cellSize, w, h); break;
      default: tiles = hexagonalTiles(cellSize, w, h); break;
    }

    applyJitter(tiles, jitter, cellSize, rng);

    for (const tile of tiles) {
      const [r, g, b] = resolveColor(tile, colorMode, tile.index, colors, w, h, noise, 0, 0);
      const fill = `rgba(${r},${g},${b},${fillOpacity})`;
      const stroke = edgeStyle === 'none' ? undefined
        : edgeStyle === 'dark' ? 'rgba(0,0,0,0.6)'
        : edgeStyle === 'light' ? 'rgba(255,255,255,0.6)'
        : `rgba(${r},${g},${b},0.8)`;
      builder.addPolygon(tile.vertices, fill, stroke, edgeWidth);
    }

    return builder.getPaths();
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const s = params.cellSize ?? 50;
    const tiles = Math.ceil(1080 / s) ** 2;
    return Math.round(tiles * (params.tilingType === 'penrose' ? 4 : 1) * 3);
  },
};
