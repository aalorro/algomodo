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

// Bowyer-Watson Delaunay (adapted from delaunay-mesh.ts)
type Tri = [number, number, number];

function circumcircle(p: [number, number][], a: number, b: number, c: number) {
  const ax = p[a][0], ay = p[a][1], bx = p[b][0], by = p[b][1], cx = p[c][0], cy = p[c][1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < 1e-10) return { cx: 0, cy: 0, r2: Infinity };
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  return { cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
}

function delaunay(points: [number, number][], w: number, h: number): Tri[] {
  const n = points.length;
  const all: [number, number][] = [...points];
  const M = Math.max(w, h) * 10;
  all.push([-M, -M], [3 * M, -M], [-M, 3 * M]);
  const s0 = n, s1 = n + 1, s2 = n + 2;
  let triangles: Tri[] = [[s0, s1, s2]];

  for (let i = 0; i < n; i++) {
    const bad: Tri[] = [];
    for (const t of triangles) {
      const { cx, cy, r2 } = circumcircle(all, t[0], t[1], t[2]);
      const dx = all[i][0] - cx, dy = all[i][1] - cy;
      if (dx * dx + dy * dy < r2) bad.push(t);
    }
    const edges: [number, number][] = [];
    for (const t of bad) {
      const triEdges: [number, number][] = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
      for (const e of triEdges) {
        const shared = bad.some(
          (t2: Tri) => t2 !== t && ((t2[0] === e[0] && t2[1] === e[1]) || (t2[0] === e[1] && t2[1] === e[0]) ||
                           (t2[1] === e[0] && t2[2] === e[1]) || (t2[1] === e[1] && t2[2] === e[0]) ||
                           (t2[2] === e[0] && t2[0] === e[1]) || (t2[2] === e[1] && t2[0] === e[0])),
        );
        if (!shared) edges.push(e);
      }
    }
    triangles = triangles.filter((t: Tri) => !bad.includes(t));
    for (const [a, b] of edges) triangles.push([a, b, i]);
  }
  return triangles.filter((t: Tri) => t[0] < n && t[1] < n && t[2] < n);
}

function jitteredGrid(count: number, w: number, h: number, rng: SeededRNG): [number, number][] {
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const pts: [number, number][] = [];
  for (let r = 0; r < rows && pts.length < count; r++) {
    for (let c = 0; c < cols && pts.length < count; c++) {
      pts.push([(c + 0.2 + rng.random() * 0.6) * cw, (r + 0.2 + rng.random() * 0.6) * ch]);
    }
  }
  while (pts.length < count) pts.push([rng.random() * w, rng.random() * h]);
  return pts;
}

function generatePoints(
  count: number, dist: string, w: number, h: number, rng: SeededRNG
): [number, number][] {
  switch (dist) {
    case 'random': {
      const pts: [number, number][] = [];
      for (let i = 0; i < count; i++) pts.push([rng.random() * w, rng.random() * h]);
      return pts;
    }
    case 'poisson-disc': {
      const minDist = Math.sqrt(w * h / count) * 0.7;
      const pts: [number, number][] = [];
      for (let attempt = 0; attempt < count * 30 && pts.length < count; attempt++) {
        const x = rng.random() * w, y = rng.random() * h;
        let ok = true;
        for (const p of pts) {
          if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < minDist * minDist) { ok = false; break; }
        }
        if (ok) pts.push([x, y]);
      }
      while (pts.length < count) pts.push([rng.random() * w, rng.random() * h]);
      return pts;
    }
    case 'fibonacci': {
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const cx = w / 2, cy = h / 2;
      const maxR = Math.min(w, h) * 0.48;
      const pts: [number, number][] = [];
      for (let i = 0; i < count; i++) {
        const r = Math.sqrt((i + 0.5) / count) * maxR;
        const theta = i * goldenAngle;
        pts.push([cx + Math.cos(theta) * r, cy + Math.sin(theta) * r]);
      }
      return pts;
    }
    default: return jitteredGrid(count, w, h, rng);
  }
}

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count', type: 'number', min: 20, max: 500, step: 10, default: 150,
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['jittered-grid', 'random', 'poisson-disc', 'fibonacci'],
    default: 'jittered-grid', group: 'Composition',
  },
  noiseScale: {
    name: 'Noise Scale', type: 'number', min: 0.5, max: 8, step: 0.5, default: 3,
    help: 'Spatial frequency of elevation noise', group: 'Texture',
  },
  noiseOctaves: {
    name: 'Noise Octaves', type: 'number', min: 1, max: 6, step: 1, default: 4,
    group: 'Texture',
  },
  elevationContrast: {
    name: 'Elevation Contrast', type: 'number', min: 0.5, max: 3, step: 0.25, default: 1.5,
    group: 'Texture',
  },
  lightAngle: {
    name: 'Light Angle', type: 'number', min: 0, max: 360, step: 15, default: 135,
    group: 'Texture',
  },
  lightIntensity: {
    name: 'Light Intensity', type: 'number', min: 0, max: 1, step: 0.05, default: 0.4,
    group: 'Texture',
  },
  showEdges: {
    name: 'Show Edges', type: 'boolean', default: false, group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 3, step: 0.5, default: 0.5,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['elevation', 'slope', 'aspect', 'palette-flat'],
    default: 'elevation', group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed', type: 'number', min: 0, max: 1, step: 0.05, default: 0.15,
    help: 'Speed of noise evolution (0 = static)', group: 'Flow/Motion',
  },
  vertexDrift: {
    name: 'Vertex Drift', type: 'number', min: 0, max: 0.5, step: 0.05, default: 0.15,
    group: 'Flow/Motion',
  },
};

function getElevation(
  x: number, y: number, w: number, h: number, noise: SimplexNoise,
  noiseScale: number, octaves: number, contrast: number, timeOffset: number
): number {
  const raw = noise.fbm(x / w * noiseScale, y / h * noiseScale + timeOffset, octaves);
  const norm = (raw + 1) * 0.5; // [0, 1]
  return Math.pow(Math.max(0, Math.min(1, norm)), contrast);
}

export const lowPoly: Generator = {
  id: 'graph-low-poly',
  family: 'graphs',
  styleName: 'Low-Poly',
  definition: 'Delaunay triangulation with noise-based elevation coloring and simulated directional lighting',
  algorithmNotes:
    'Generates points via selected distribution, computes elevation per point using fbm noise, then ' +
    'triangulates via Bowyer-Watson Delaunay. Each triangle is shaded by average vertex elevation mapped ' +
    'through the palette, with directional lighting simulated via surface normal dot product. Animation ' +
    'evolves the noise field and drifts vertices.',
  parameterSchema,
  defaultParams: {
    pointCount: 150, distribution: 'jittered-grid', noiseScale: 3, noiseOctaves: 4,
    elevationContrast: 1.5, lightAngle: 135, lightIntensity: 0.4, showEdges: false,
    edgeWidth: 0.5, colorMode: 'elevation', animSpeed: 0.15, vertexDrift: 0.15,
  },
  supportsVector: true, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const colors = palette.colors.map(hexToRgb);

    const pointCount = params.pointCount ?? 150;
    const distribution = params.distribution ?? 'jittered-grid';
    const noiseScale = params.noiseScale ?? 3;
    const octaves = params.noiseOctaves ?? 4;
    const contrast = params.elevationContrast ?? 1.5;
    const lightAngle = (params.lightAngle ?? 135) * Math.PI / 180;
    const lightInt = params.lightIntensity ?? 0.4;
    const showEdges = params.showEdges ?? false;
    const edgeWidth = params.edgeWidth ?? 0.5;
    const colorMode = params.colorMode ?? 'elevation';
    const animSpeed = params.animSpeed ?? 0.15;
    const vertexDrift = params.vertexDrift ?? 0.15;

    // Generate base points
    const basePts = generatePoints(pointCount, distribution, w, h, rng);

    // Animate: drift vertices
    const timeOffset = time * animSpeed * 0.1;
    const avgCell = Math.sqrt(w * h / pointCount);
    const amp = vertexDrift * avgCell;
    const pts: [number, number][] = basePts.map(([bx, by], i) => {
      if (time <= 0 || amp <= 0) return [bx, by] as [number, number];
      return [
        bx + Math.cos(time * animSpeed + i * 2.399) * amp,
        by + Math.sin(time * animSpeed * 1.3 + i * 3.7) * amp,
      ] as [number, number];
    });

    // Compute elevation per point
    const elev = pts.map(([x, y]) => getElevation(x, y, w, h, noise, noiseScale, octaves, contrast, timeOffset));

    // Triangulate
    const tris = delaunay(pts, w, h);

    // Light direction
    const lx = Math.cos(lightAngle), ly = Math.sin(lightAngle), lz = 0.7;
    const lLen = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const lightDir = [lx / lLen, ly / lLen, lz / lLen];

    // Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    // Render triangles
    for (const [ia, ib, ic] of tris) {
      const pa = pts[ia], pb = pts[ib], pc = pts[ic];
      const ea = elev[ia], eb = elev[ib], ec = elev[ic];
      const avgElev = (ea + eb + ec) / 3;

      // Surface normal (3D with z = elevation * scale)
      const elevScale = avgCell * 0.5;
      const abx = pb[0] - pa[0], aby = pb[1] - pa[1], abz = (eb - ea) * elevScale;
      const acx = pc[0] - pa[0], acy = pc[1] - pa[1], acz = (ec - ea) * elevScale;
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nLen; ny /= nLen; nz /= nLen;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }

      // Lighting
      const dot = nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2];
      const shade = Math.max(0.2, Math.min(1, 0.5 + dot * 0.5));
      const finalShade = 1 - lightInt + lightInt * shade;

      // Color
      let baseColor: [number, number, number];
      if (colorMode === 'slope') {
        const slope = Math.sqrt(nx * nx + ny * ny);
        baseColor = paletteSample(slope, colors);
      } else if (colorMode === 'aspect') {
        const aspect = (Math.atan2(ny, nx) / (Math.PI * 2) + 1) % 1;
        baseColor = paletteSample(aspect, colors);
      } else if (colorMode === 'palette-flat') {
        baseColor = colors[((ia + ib + ic) / 3 | 0) % colors.length];
      } else {
        baseColor = paletteSample(avgElev, colors);
      }

      const r = Math.min(255, (baseColor[0] * finalShade) | 0);
      const g = Math.min(255, (baseColor[1] * finalShade) | 0);
      const b = Math.min(255, (baseColor[2] * finalShade) | 0);

      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.lineTo(pc[0], pc[1]);
      ctx.closePath();
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fill();

      if (showEdges) {
        ctx.strokeStyle = `rgba(0,0,0,0.2)`;
        ctx.lineWidth = edgeWidth;
        ctx.stroke();
      }
    }
  },

  renderVector(params, seed, palette) {
    const builder = new SVGPathBuilder();
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const colors = palette.colors.map(hexToRgb);
    const w = 1080, h = 1080;

    const pointCount = params.pointCount ?? 150;
    const distribution = params.distribution ?? 'jittered-grid';
    const noiseScale = params.noiseScale ?? 3;
    const octaves = params.noiseOctaves ?? 4;
    const contrast = params.elevationContrast ?? 1.5;
    const colorMode = params.colorMode ?? 'elevation';

    const pts = generatePoints(pointCount, distribution, w, h, rng);
    const elev = pts.map(([x, y]) => getElevation(x, y, w, h, noise, noiseScale, octaves, contrast, 0));
    const tris = delaunay(pts, w, h);

    for (const [ia, ib, ic] of tris) {
      const avgElev = (elev[ia] + elev[ib] + elev[ic]) / 3;
      let baseColor: [number, number, number];
      if (colorMode === 'palette-flat') {
        baseColor = colors[((ia + ib + ic) / 3 | 0) % colors.length];
      } else {
        baseColor = paletteSample(avgElev, colors);
      }
      const fill = `rgb(${baseColor[0]},${baseColor[1]},${baseColor[2]})`;
      builder.addPolygon([pts[ia], pts[ib], pts[ic]], fill, undefined, 0);
    }

    return builder.getPaths();
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = params.pointCount ?? 150;
    return Math.round(n * n * 0.05 + n * (params.noiseOctaves ?? 4) * 2);
  },
};
