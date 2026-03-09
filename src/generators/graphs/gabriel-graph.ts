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
  if (dist === 'fibonacci') {
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
    name: 'Point Count', type: 'number', min: 20, max: 300, step: 10, default: 100,
    group: 'Composition',
  },
  distribution: {
    name: 'Distribution', type: 'select',
    options: ['jittered-grid', 'random', 'poisson-disc', 'fibonacci'],
    default: 'poisson-disc', group: 'Composition',
  },
  showCircles: {
    name: 'Show Diametral Circles', type: 'boolean', default: false,
    help: 'Show the diametral circle for each Gabriel edge (an edge exists only if no other point lies inside)',
    group: 'Geometry',
  },
  nodeSize: {
    name: 'Node Size', type: 'number', min: 0, max: 8, step: 0.5, default: 3.5,
    group: 'Geometry',
  },
  edgeWidth: {
    name: 'Edge Width', type: 'number', min: 0.5, max: 4, step: 0.5, default: 1.5,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select',
    options: ['edge-length', 'degree', 'noise', 'radial'],
    default: 'edge-length',
    help: 'edge-length: short=warm, long=cool · degree: by connections · noise: FBM · radial: distance from center',
    group: 'Color',
  },
  fillCells: {
    name: 'Fill Regions', type: 'boolean', default: false,
    help: 'Fill triangular regions formed by the graph with translucent palette colors',
    group: 'Color',
  },
  background: {
    name: 'Background', type: 'select',
    options: ['dark', 'white', 'cream'],
    default: 'dark', group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed', type: 'number', min: 0, max: 1, step: 0.05, default: 0.12,
    help: 'Vertex drift speed (0 = static)', group: 'Flow/Motion',
  },
};

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0a0a0f' };

export const gabrielGraph: Generator = {
  id: 'graph-gabriel',
  family: 'graphs',
  styleName: 'Gabriel Graph',
  definition: 'Gabriel graph — edge (i,j) exists iff no other point lies inside the diametral circle of i and j',
  algorithmNotes:
    'For every pair of points (i,j), the diametral circle has center at the midpoint and radius = half the ' +
    'distance between i and j. An edge is included only if no third point falls inside this circle. This ' +
    'produces a sparse, elegant subgraph of the Delaunay triangulation that captures proximity without clutter.',
  parameterSchema,
  defaultParams: {
    pointCount: 100, distribution: 'poisson-disc',
    showCircles: false, nodeSize: 3.5, edgeWidth: 1.5,
    colorMode: 'edge-length', fillCells: false, background: 'dark', animSpeed: 0.12,
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
    const showCircles = params.showCircles ?? false;
    const nodeSize = params.nodeSize ?? 3.5;
    const edgeWidth = params.edgeWidth ?? 1.5;
    const colorMode = params.colorMode ?? 'edge-length';
    const fillCells = params.fillCells ?? false;
    const animSpeed = params.animSpeed ?? 0.12;

    // Generate and animate points
    const basePts = generatePoints(pointCount, params.distribution ?? 'poisson-disc', w, h, rng);
    const avgCell = Math.sqrt(w * h / pointCount);
    const amp = animSpeed > 0 ? avgCell * 0.18 : 0;
    const pts: [number, number][] = basePts.map(([bx, by], i) => {
      if (time <= 0 || amp <= 0) return [bx, by];
      return [
        bx + Math.cos(time * animSpeed + i * 2.399) * amp,
        by + Math.sin(time * animSpeed * 1.3 + i * 3.7) * amp,
      ];
    });

    // Build Gabriel graph: edge (i,j) exists iff no point k lies inside the diametral circle
    const gabrielEdges: [number, number, number][] = []; // [i, j, distance]
    const degree: number[] = new Array(pointCount).fill(0);
    let maxDist = 0;

    for (let i = 0; i < pointCount; i++) {
      for (let j = i + 1; j < pointCount; j++) {
        const mx = (pts[i][0] + pts[j][0]) / 2;
        const my = (pts[i][1] + pts[j][1]) / 2;
        const dx = pts[j][0] - pts[i][0];
        const dy = pts[j][1] - pts[i][1];
        const r2 = (dx * dx + dy * dy) / 4; // radius² of diametral circle

        let isGabriel = true;
        for (let k = 0; k < pointCount; k++) {
          if (k === i || k === j) continue;
          const dkx = pts[k][0] - mx, dky = pts[k][1] - my;
          if (dkx * dkx + dky * dky < r2) {
            isGabriel = false;
            break;
          }
        }

        if (isGabriel) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          gabrielEdges.push([i, j, dist]);
          degree[i]++;
          degree[j]++;
          if (dist > maxDist) maxDist = dist;
        }
      }
    }

    const maxDeg = Math.max(1, ...degree);

    // Node colors
    const nodeColors: [number, number, number][] = new Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      if (colorMode === 'degree') {
        nodeColors[i] = paletteSample(degree[i] / maxDeg, colors);
      } else if (colorMode === 'noise') {
        const nv = noise.fbm(pts[i][0] / w * 3 + 5, pts[i][1] / h * 3 + 5, 3, 2, 0.5);
        nodeColors[i] = paletteSample(nv * 0.5 + 0.5, colors);
      } else if (colorMode === 'radial') {
        const dx = pts[i][0] - w / 2, dy = pts[i][1] - h / 2;
        const rd = Math.sqrt(dx * dx + dy * dy) / (Math.min(w, h) * 0.5);
        nodeColors[i] = paletteSample(Math.min(1, rd), colors);
      } else {
        // edge-length: average edge length for this node
        let total = 0, count = 0;
        for (const [a, b, d] of gabrielEdges) {
          if (a === i || b === i) { total += d; count++; }
        }
        const avg = count > 0 ? total / count : 0;
        nodeColors[i] = paletteSample(Math.min(1, avg / (maxDist || 1)), colors);
      }
    }

    // Fill triangular regions if enabled
    if (fillCells) {
      // Find all triangles from Gabriel edges (3 mutually connected nodes)
      const edgeSet = new Set<string>();
      for (const [i, j] of gabrielEdges) {
        edgeSet.add(`${i}-${j}`);
        edgeSet.add(`${j}-${i}`);
      }
      for (const [i, j] of gabrielEdges) {
        for (let k = j + 1; k < pointCount; k++) {
          if (edgeSet.has(`${i}-${k}`) && edgeSet.has(`${j}-${k}`)) {
            const avgT = ((degree[i] + degree[j] + degree[k]) / 3) / maxDeg;
            const [cr, cg, cb] = paletteSample(avgT, colors);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.08 : 0.06})`;
            ctx.beginPath();
            ctx.moveTo(pts[i][0], pts[i][1]);
            ctx.lineTo(pts[j][0], pts[j][1]);
            ctx.lineTo(pts[k][0], pts[k][1]);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }

    // Draw diametral circles
    if (showCircles) {
      ctx.lineWidth = 0.5;
      for (const [i, j, dist] of gabrielEdges) {
        const mx = (pts[i][0] + pts[j][0]) / 2;
        const my = (pts[i][1] + pts[j][1]) / 2;
        const r = dist / 2;
        const t = dist / (maxDist || 1);
        const [cr, cg, cb] = paletteSample(t, colors);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.08 : 0.06})`;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Draw edges
    ctx.lineCap = 'round';
    ctx.lineWidth = edgeWidth;
    for (const [i, j, dist] of gabrielEdges) {
      const t = dist / (maxDist || 1);
      const edgeAlpha = isDark ? 0.55 : 0.45;
      const [cr0, cg0, cb0] = nodeColors[i];
      const [cr1, cg1, cb1] = nodeColors[j];
      const grad = ctx.createLinearGradient(pts[i][0], pts[i][1], pts[j][0], pts[j][1]);
      grad.addColorStop(0, `rgba(${cr0},${cg0},${cb0},${edgeAlpha})`);
      grad.addColorStop(1, `rgba(${cr1},${cg1},${cb1},${edgeAlpha})`);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[i][0], pts[i][1]);
      ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.stroke();
    }

    // Draw nodes with glow
    if (nodeSize > 0) {
      for (let i = 0; i < pointCount; i++) {
        const [cr, cg, cb] = nodeColors[i];
        if (isDark) {
          const grad = ctx.createRadialGradient(pts[i][0], pts[i][1], 0, pts[i][0], pts[i][1], nodeSize * 2.5);
          grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.3)`);
          grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pts[i][0], pts[i][1], nodeSize * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], nodeSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const n = params.pointCount ?? 100;
    return Math.round(n * n * 0.15);
  },
};
