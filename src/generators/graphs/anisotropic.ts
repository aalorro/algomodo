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

function generatePoints(
  count: number, dist: string, w: number, h: number, rng: SeededRNG,
): [number, number][] {
  if (dist === 'random') {
    const pts: [number, number][] = [];
    for (let i = 0; i < count; i++) pts.push([rng.random() * w, rng.random() * h]);
    return pts;
  }
  if (dist === 'poisson-disc') {
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
  // jittered-grid
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const pts: [number, number][] = [];
  for (let r = 0; r < rows && pts.length < count; r++) {
    for (let c = 0; c < cols && pts.length < count; c++) {
      pts.push([(c + 0.2 + rng.random() * 0.6) * cw, (r + 0.2 + rng.random() * 0.6) * ch]);
    }
  }
  return pts;
}

const parameterSchema: ParameterSchema = {
  pointCount: {
    name: 'Point Count', type: 'number', min: 30, max: 300, step: 10, default: 100,
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['jittered-grid', 'random', 'poisson-disc'],
    default: 'poisson-disc', group: 'Composition',
  },
  maxDistance: {
    name: 'Max Distance', type: 'number', min: 0.05, max: 0.3, step: 0.01, default: 0.12,
    help: 'Maximum edge length relative to canvas — only shorter edges are drawn',
    group: 'Geometry',
  },
  anisotropy: {
    name: 'Anisotropy', type: 'number', min: 0, max: 3, step: 0.1, default: 1.5,
    help: 'Directional bias — 0 = isotropic, higher = stronger directional preference',
    group: 'Geometry',
  },
  fieldMode: {
    name: 'Field Mode', type: 'select',
    options: ['noise', 'radial', 'horizontal', 'vortex'],
    default: 'noise',
    help: 'Direction field that governs anisotropic edge filtering',
    group: 'Geometry',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 0, max: 6, step: 0.5, default: 2.5,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 3, step: 0.5, default: 1,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['direction', 'distance', 'noise', 'degree'],
    default: 'direction',
    help: 'direction: color by edge angle · distance: by edge length · noise: FBM · degree: by connections',
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['dark', 'white', 'cream'],
    default: 'dark', group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed', type: 'number', min: 0, max: 1, step: 0.05, default: 0.15,
    group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0a0a0f' };

export const anisotropic: Generator = {
  id: 'graph-anisotropic',
  family: 'graphs',
  styleName: 'Anisotropic',
  definition: 'Anisotropic proximity graph — edges are filtered by a direction field, creating oriented flow patterns',
  algorithmNotes:
    'Generates N points and connects all pairs within a distance threshold, then filters edges by alignment ' +
    'to a spatially-varying direction field (noise, radial, horizontal, or vortex). Edges aligned with the ' +
    'field are kept; perpendicular edges are removed. This creates flowing, directional graph structures.',
  parameterSchema,
  defaultParams: {
    pointCount: 100, distribution: 'poisson-disc', maxDistance: 0.12,
    anisotropy: 1.5, fieldMode: 'noise', nodeSize: 2.5, edgeWidth: 1,
    colorMode: 'direction', background: 'dark', animSpeed: 0.15,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const bg = params.background ?? 'dark';
    const isDark = bg === 'dark';
    ctx.fillStyle = BG[bg] ?? BG.dark;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const colors = palette.colors.map(hexToRgb);

    const pointCount = params.pointCount ?? 100;
    const maxDistRel = params.maxDistance ?? 0.12;
    const maxDist = maxDistRel * Math.min(w, h);
    const anisotropy = params.anisotropy ?? 1.5;
    const fieldMode = params.fieldMode ?? 'noise';
    const nodeSize = params.nodeSize ?? 2.5;
    const edgeWidth = params.edgeWidth ?? 1;
    const colorMode = params.colorMode ?? 'direction';
    const animSpeed = params.animSpeed ?? 0.15;

    // Generate and animate points
    const basePts = generatePoints(pointCount, params.distribution ?? 'poisson-disc', w, h, rng);
    const avgCell = Math.sqrt(w * h / pointCount);
    const amp = animSpeed > 0 ? avgCell * 0.12 : 0;
    const pts: [number, number][] = basePts.map(([bx, by], i) => {
      if (time <= 0 || amp <= 0) return [bx, by];
      return [
        bx + Math.cos(time * animSpeed + i * 2.399) * amp,
        by + Math.sin(time * animSpeed * 1.3 + i * 3.7) * amp,
      ];
    });

    // Direction field function: returns preferred direction angle at (x, y)
    const fieldAngle = (x: number, y: number): number => {
      const nx = x / w, ny = y / h;
      if (fieldMode === 'radial') {
        return Math.atan2(y - h / 2, x - w / 2);
      }
      if (fieldMode === 'horizontal') {
        return Math.sin(ny * Math.PI * 3 + time * animSpeed * 0.3) * 0.3;
      }
      if (fieldMode === 'vortex') {
        const dx = x - w / 2, dy = y - h / 2;
        return Math.atan2(dy, dx) + Math.PI / 2; // perpendicular to radial = tangential
      }
      // noise
      return noise.noise2D(nx * 3 + 5 + time * animSpeed * 0.05, ny * 3 + 5) * Math.PI;
    };

    // Build proximity graph with anisotropic filtering
    const edges: { i: number; j: number; dist: number; angle: number; alignment: number }[] = [];
    const degree: number[] = new Array(pointCount).fill(0);
    const maxDist2 = maxDist * maxDist;

    for (let i = 0; i < pointCount; i++) {
      for (let j = i + 1; j < pointCount; j++) {
        const dx = pts[j][0] - pts[i][0], dy = pts[j][1] - pts[i][1];
        const dist2 = dx * dx + dy * dy;
        if (dist2 > maxDist2) continue;

        const dist = Math.sqrt(dist2);
        const edgeAngle = Math.atan2(dy, dx);

        // Get field direction at midpoint
        const mx = (pts[i][0] + pts[j][0]) / 2;
        const my = (pts[i][1] + pts[j][1]) / 2;
        const preferred = fieldAngle(mx, my);

        // Alignment: cos²(angle difference) — 1 when aligned, 0 when perpendicular
        const angleDiff = edgeAngle - preferred;
        const alignment = Math.pow(Math.cos(angleDiff), 2);

        // Anisotropic threshold: edges aligned with field pass easily, perpendicular ones need to be very short
        const threshold = maxDist * (alignment + (1 - alignment) / (1 + anisotropy));
        if (dist > threshold) continue;

        edges.push({ i, j, dist, angle: edgeAngle, alignment });
        degree[i]++;
        degree[j]++;
      }
    }

    const maxDeg = Math.max(1, ...degree);
    let maxEdgeDist = 0;
    for (const e of edges) if (e.dist > maxEdgeDist) maxEdgeDist = e.dist;

    // Node colors
    const nodeColors: [number, number, number][] = new Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      if (colorMode === 'degree') {
        nodeColors[i] = paletteSample(degree[i] / maxDeg, colors);
      } else if (colorMode === 'noise') {
        const nv = noise.fbm(pts[i][0] / w * 3 + 5, pts[i][1] / h * 3 + 5, 3, 2, 0.5);
        nodeColors[i] = paletteSample(nv * 0.5 + 0.5, colors);
      } else {
        // direction or distance: derive from field angle at point
        const fa = fieldAngle(pts[i][0], pts[i][1]);
        const t = ((fa / Math.PI) + 1) % 1;
        nodeColors[i] = paletteSample(t, colors);
      }
    }

    // Draw edges
    ctx.lineCap = 'round';
    for (const e of edges) {
      const edgeAlpha = isDark
        ? 0.25 + e.alignment * 0.4
        : 0.15 + e.alignment * 0.3;

      let edgeCol: [number, number, number];
      if (colorMode === 'direction') {
        const t = ((e.angle / Math.PI) + 1) % 1;
        edgeCol = paletteSample(t, colors);
      } else if (colorMode === 'distance') {
        edgeCol = paletteSample(e.dist / (maxEdgeDist || 1), colors);
      } else {
        // Gradient between node colors
        const [cr0, cg0, cb0] = nodeColors[e.i];
        const [cr1, cg1, cb1] = nodeColors[e.j];
        edgeCol = [((cr0 + cr1) / 2) | 0, ((cg0 + cg1) / 2) | 0, ((cb0 + cb1) / 2) | 0];
      }

      // Width varies by alignment (aligned edges are bolder)
      ctx.lineWidth = edgeWidth * (0.5 + e.alignment * 0.8);
      ctx.strokeStyle = `rgba(${edgeCol[0]},${edgeCol[1]},${edgeCol[2]},${edgeAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(pts[e.i][0], pts[e.i][1]);
      ctx.lineTo(pts[e.j][0], pts[e.j][1]);
      ctx.stroke();
    }

    // Draw nodes
    if (nodeSize > 0) {
      for (let i = 0; i < pointCount; i++) {
        if (degree[i] === 0 && nodeSize < 2) continue;
        const [cr, cg, cb] = nodeColors[i];

        if (isDark && degree[i] > 0) {
          const grad = ctx.createRadialGradient(pts[i][0], pts[i][1], 0, pts[i][0], pts[i][1], nodeSize * 2.5);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.25)`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pts[i][0], pts[i][1], nodeSize * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        const sizeScale = degree[i] > 0 ? 1 : 0.5;
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], nodeSize * sizeScale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = params.pointCount ?? 100;
    return Math.round(n * n * 0.1);
  },
};
