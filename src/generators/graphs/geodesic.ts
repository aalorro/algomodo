import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

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

const parameterSchema: ParameterSchema = {
  subdivisions: {
    name: 'Subdivisions', type: 'number', min: 1, max: 5, step: 1, default: 3,
    help: 'Icosahedron subdivision depth — higher = more triangles',
    group: 'Composition',
  },
  projection: {
    name: 'Projection', type: 'select',
    options: ['orthographic', 'stereographic', 'equirectangular'],
    default: 'orthographic',
    help: 'How the 3D sphere is projected onto the 2D canvas',
    group: 'Composition',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 0, max: 6, step: 0.5, default: 2,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 3, step: 0.5, default: 1,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['latitude', 'depth', 'noise', 'face-area'],
    default: 'latitude',
    help: 'latitude: by Y position · depth: by Z (front/back) · noise: FBM on sphere · face-area: triangle size',
    group: 'Color',
  },
  fillFaces: {
    name: 'Fill Faces', type: 'boolean', default: true,
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['dark', 'white', 'cream'],
    default: 'dark', group: 'Color',
  },
  rotateSpeed: {
    name: 'Rotate Speed', type: 'number', min: 0, max: 1, step: 0.05, default: 0.2,
    group: 'Flow/Motion',
  },
  tilt: {
    name: 'Tilt', type: 'number', min: 0, max: 60, step: 5, default: 25,
    help: 'X-axis tilt in degrees',
    group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0a0a0f' };

type Vec3 = [number, number, number];

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return normalize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
}

// Build icosahedron vertices and faces
function icosahedron(): { verts: Vec3[]; faces: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const verts = raw.map(normalize);
  const faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { verts, faces };
}

function subdivide(verts: Vec3[], faces: [number, number, number][], levels: number) {
  for (let lvl = 0; lvl < levels; lvl++) {
    const midCache = new Map<string, number>();
    const newFaces: [number, number, number][] = [];

    const getMid = (a: number, b: number): number => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (midCache.has(key)) return midCache.get(key)!;
      const m = midpoint(verts[a], verts[b]);
      const idx = verts.length;
      verts.push(m);
      midCache.set(key, idx);
      return idx;
    };

    for (const [a, b, c] of faces) {
      const ab = getMid(a, b);
      const bc = getMid(b, c);
      const ca = getMid(c, a);
      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = newFaces;
  }
  return { verts, faces };
}

// Rotation matrices
function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

export const geodesic: Generator = {
  id: 'graph-geodesic',
  family: 'graphs',
  styleName: 'Geodesic',
  definition: 'Geodesic sphere — subdivided icosahedron projected onto 2D with depth shading',
  algorithmNotes:
    'Starts with a regular icosahedron (12 vertices, 20 faces), subdivides each triangle into 4 sub-triangles ' +
    'at each level, projecting new vertices onto the unit sphere. The result is a geodesic polyhedron rendered ' +
    'via orthographic, stereographic, or equirectangular projection with backface culling and depth-based shading.',
  parameterSchema,
  defaultParams: {
    subdivisions: 3, projection: 'orthographic', nodeSize: 2, edgeWidth: 1,
    colorMode: 'latitude', fillFaces: true, background: 'dark', rotateSpeed: 0.2, tilt: 25,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const bg = params.background ?? 'dark';
    const isDark = bg === 'dark';
    ctx.fillStyle = BG[bg] ?? BG.dark;
    ctx.fillRect(0, 0, w, h);

    const noise = new SimplexNoise(seed);
    const colors = palette.colors.map(hexToRgb);

    const subdivisions = Math.max(1, Math.min(5, params.subdivisions ?? 3));
    const projection = params.projection ?? 'orthographic';
    const nodeSize = params.nodeSize ?? 2;
    const edgeWidth = params.edgeWidth ?? 1;
    const colorMode = params.colorMode ?? 'latitude';
    const fillFaces = params.fillFaces ?? true;
    const rotateSpeed = params.rotateSpeed ?? 0.2;
    const tilt = (params.tilt ?? 25) * Math.PI / 180;

    // Build geodesic sphere
    const ico = icosahedron();
    const { verts, faces } = subdivide(ico.verts, ico.faces, subdivisions);

    // Rotation
    const yRot = time * rotateSpeed;
    const rotated = verts.map(v => rotateX(rotateY(v, yRot), tilt));

    // Project to 2D
    const radius = Math.min(w, h) * 0.42;
    const cx = w / 2, cy = h / 2;

    const project = (v: Vec3): [number, number] => {
      if (projection === 'stereographic') {
        const d = 1 / (1.8 - v[2]);
        return [cx + v[0] * d * radius, cy + v[1] * d * radius];
      }
      if (projection === 'equirectangular') {
        const lon = Math.atan2(v[0], v[2]);
        const lat = Math.asin(Math.max(-1, Math.min(1, v[1])));
        return [cx + (lon / Math.PI) * radius, cy - (lat / (Math.PI / 2)) * radius * 0.5];
      }
      // orthographic
      return [cx + v[0] * radius, cy + v[1] * radius];
    };

    const projected = rotated.map(project);

    // Sort faces by depth (back to front) for correct rendering
    const faceDepths = faces.map((f, idx) => {
      const avgZ = (rotated[f[0]][2] + rotated[f[1]][2] + rotated[f[2]][2]) / 3;
      return { idx, face: f, avgZ };
    });
    faceDepths.sort((a, b) => a.avgZ - b.avgZ);

    // Draw faces and edges
    for (const { face, avgZ } of faceDepths) {
      const [a, b, c] = face;
      const pa = projected[a], pb = projected[b], pc = projected[c];
      const va = rotated[a], vb = rotated[b], vc = rotated[c];

      // Backface culling (for orthographic/stereographic)
      if (projection !== 'equirectangular') {
        const nx = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
        if (nx < 0) continue;
      }

      const depthT = (avgZ + 1) / 2; // 0 = back, 1 = front

      // Face color
      let faceColor: [number, number, number];
      if (colorMode === 'latitude') {
        const avgY = (va[1] + vb[1] + vc[1]) / 3;
        faceColor = paletteSample((avgY + 1) / 2, colors);
      } else if (colorMode === 'depth') {
        faceColor = paletteSample(depthT, colors);
      } else if (colorMode === 'noise') {
        const avgX = (va[0] + vb[0] + vc[0]) / 3;
        const avgY = (va[1] + vb[1] + vc[1]) / 3;
        const nv = noise.fbm(avgX * 2 + 5, avgY * 2 + 5, 3, 2, 0.5);
        faceColor = paletteSample(nv * 0.5 + 0.5, colors);
      } else {
        // face-area: triangle area on screen
        const area = Math.abs((pb[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pb[1] - pa[1])) / 2;
        const maxArea = radius * radius * 0.005;
        faceColor = paletteSample(Math.min(1, area / maxArea), colors);
      }

      // Depth-based lighting
      const shade = 0.3 + depthT * 0.7;
      const [cr, cg, cb] = faceColor;
      const sr = Math.min(255, (cr * shade) | 0);
      const sg = Math.min(255, (cg * shade) | 0);
      const sb = Math.min(255, (cb * shade) | 0);

      if (fillFaces) {
        ctx.fillStyle = `rgba(${sr},${sg},${sb},0.85)`;
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.lineTo(pc[0], pc[1]);
        ctx.closePath();
        ctx.fill();
      }

      // Edges
      if (edgeWidth > 0) {
        const edgeAlpha = isDark ? 0.3 + depthT * 0.3 : 0.15 + depthT * 0.2;
        ctx.strokeStyle = isDark
          ? `rgba(255,255,255,${edgeAlpha.toFixed(2)})`
          : `rgba(0,0,0,${edgeAlpha.toFixed(2)})`;
        ctx.lineWidth = edgeWidth;
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.lineTo(pc[0], pc[1]);
        ctx.closePath();
        ctx.stroke();
      }
    }

    // Draw nodes on front-facing vertices
    if (nodeSize > 0) {
      for (let i = 0; i < rotated.length; i++) {
        if (projection !== 'equirectangular' && rotated[i][2] < -0.05) continue;
        const [px, py] = projected[i];
        const depthT = (rotated[i][2] + 1) / 2;
        const [cr, cg, cb] = paletteSample(depthT, colors);

        if (isDark) {
          const grad = ctx.createRadialGradient(px, py, 0, px, py, nodeSize * 2);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.3)`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, nodeSize * 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.5 + depthT * 0.5).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(px, py, nodeSize * (0.5 + depthT * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const s = params.subdivisions ?? 3;
    return Math.round(20 * Math.pow(4, s) * 0.1);
  },
};
