import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Complex number helpers */
type C = [number, number]; // [re, im]
function cadd(a: C, b: C): C { return [a[0]+b[0], a[1]+b[1]]; }
function csub(a: C, b: C): C { return [a[0]-b[0], a[1]-b[1]]; }
function cmul(a: C, b: C): C { return [a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]]; }
function csqrt(a: C): C {
  const r = Math.sqrt(Math.sqrt(a[0]*a[0]+a[1]*a[1]));
  const theta = Math.atan2(a[1], a[0]) / 2;
  return [r*Math.cos(theta), r*Math.sin(theta)];
}
function cscale(a: C, s: number): C { return [a[0]*s, a[1]*s]; }
function creal(a: C): number { return a[0]; }
function cimag(a: C): number { return a[1]; }

/** Descartes' theorem: given three mutually tangent circles with curvatures k1,k2,k3,
 *  the fourth tangent circle has curvature k4 = k1+k2+k3 ± 2√(k1k2+k2k3+k1k3) */
function descartesK(k1: number, k2: number, k3: number): [number, number] {
  const s = Math.sqrt(k1*k2 + k2*k3 + k1*k3);
  return [k1+k2+k3 + 2*s, k1+k2+k3 - 2*s];
}

/** Complex Descartes theorem for circle centers */
function descartesC(k1: number, k2: number, k3: number, k4: number, c1: C, c2: C, c3: C, c4: C): [C, C] {
  // c4 = (k1*c1 + k2*c2 + k3*c3 ± 2√(k1k2c1c2 + k2k3c2c3 + k1k3c1c3)) / k4
  const s1 = cmul(cscale(c1, k1), cscale(c2, k2));
  const s2 = cmul(cscale(c2, k2), cscale(c3, k3));
  const s3 = cmul(cscale(c1, k1), cscale(c3, k3));
  const sum: C = [s1[0]+s2[0]+s3[0], s1[1]+s2[1]+s3[1]];
  const sqr  = csqrt(sum);
  const num1 = cadd([k1*c1[0]+k2*c2[0]+k3*c3[0], k1*c1[1]+k2*c2[1]+k3*c3[1]], cscale(sqr, 2));
  const num2 = csub([k1*c1[0]+k2*c2[0]+k3*c3[0], k1*c1[1]+k2*c2[1]+k3*c3[1]], cscale(sqr, 2));
  return [cscale(num1, 1/k4), cscale(num2, 1/k4)];
}

interface Circle { k: number; cx: number; cy: number; depth: number; }

function buildGasket(
  k1: number, k2: number, k3: number, k4: number,
  c1: C, c2: C, c3: C, c4: C,
  depth: number, maxDepth: number, minR: number,
  circles: Circle[]
) {
  if (depth > maxDepth) return;
  const r4 = Math.abs(1 / k4);
  if (r4 < minR) return;
  circles.push({ k: k4, cx: creal(c4), cy: cimag(c4), depth });

  // Generate the three new Apollonian circles from each triple
  const triples: [number, number, number, C, C, C][] = [
    [k1, k2, k4, c1, c2, c4],
    [k1, k3, k4, c1, c3, c4],
    [k2, k3, k4, c2, c3, c4],
  ];

  for (const [a, b, c, ca, cb, cc] of triples) {
    const [kA, kB] = descartesK(a, b, c);
    const solutions = [kA, kB];
    for (const kNew of solutions) {
      if (!isFinite(kNew) || kNew <= 0) continue;
      const rNew = 1 / kNew;
      if (rNew < minR) continue;
      const [cNew1, cNew2] = descartesC(a, b, c, kNew, ca, cb, cc);
      // Pick the solution that is NOT the already-known fourth circle
      for (const cNew of [cNew1, cNew2]) {
        const dx = creal(cNew) - creal(c4);
        const dy = cimag(cNew) - cimag(c4);
        if (Math.sqrt(dx*dx+dy*dy) > rNew * 0.01) {
          buildGasket(a, b, c, kNew, ca, cb, cc, cNew, depth+1, maxDepth, minR, circles);
          break;
        }
      }
    }
  }
}

const parameterSchema: ParameterSchema = {
  depth: {
    name: 'Depth', type: 'number', min: 1, max: 6, step: 1, default: 4,
    help: 'Recursion depth — each level adds tangent circles in every gap; depth 5+ is expensive',
    group: 'Composition',
  },
  startConfig: {
    name: 'Start Config', type: 'select', options: ['classic', 'nested', 'strip'], default: 'classic',
    help: 'classic: outer enclosing circle + 3 inner | nested: three equal circles | strip: two parallel lines + circle',
    group: 'Geometry',
  },
  strokeWidth: {
    name: 'Stroke Width', type: 'number', min: 0.25, max: 4, step: 0.25, default: 0.75,
    group: 'Texture',
  },
  fill: {
    name: 'Fill', type: 'boolean', default: true,
    help: 'Fill circles with depth-mapped palette color at low opacity',
    group: 'Color',
  },
  colorBy: {
    name: 'Color By', type: 'select', options: ['depth', 'radius', 'curvature'], default: 'depth',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['spin', 'breathe', 'none'], default: 'spin',
    help: 'spin: rotate entire gasket | breathe: slight scale pulse',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.15,
    group: 'Flow/Motion',
  },
};

export const geoApolloian: Generator = {
  id: 'geo-apollonian',
  family: 'geometry',
  styleName: 'Apollonian Gasket',
  definition: "Recursive circle packing where every gap between mutually tangent circles is filled with the unique circle tangent to all three — producing a self-similar fractal dust of tangent circles",
  algorithmNotes:
    "Given three mutually tangent circles with curvatures (k=1/r) k1, k2, k3, Descartes' Circle Theorem gives k4 = k1+k2+k3 ± 2√(k1k2+k2k3+k1k3). The complex generalisation locates the new circle center: c4 = (k1c1+k2c2+k3c3 ± 2√(k1k2c1c2+k2k3c2c3+k1k3c1c3)) / k4. Starting from an initial configuration (outer circle k=-1 enclosing three mutually tangent inner circles), this theorem is applied recursively to every new gap until a minimum radius is reached. The result is a fractal with Hausdorff dimension ≈ 1.305.",
  parameterSchema,
  defaultParams: {
    depth: 4, startConfig: 'classic', strokeWidth: 0.75, fill: true,
    colorBy: 'depth', animMode: 'spin', speed: 0.15,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.46;

    const maxDepth   = Math.max(1, Math.min(6, (params.depth ?? 4) | 0));
    const startConf  = params.startConfig ?? 'classic';
    const sw         = params.strokeWidth ?? 0.75;
    const doFill     = params.fill ?? true;
    const colorBy    = params.colorBy ?? 'depth';
    const animMode   = params.animMode ?? 'spin';
    const t          = time * (params.speed ?? 0.15);

    const minR = quality === 'draft' ? R * 0.02 : R * 0.008;

    // Build circle list
    const circles: Circle[] = [];

    if (startConf === 'classic') {
      // Outer enclosing circle (negative curvature), 3 inner tangent circles
      // Three equal inner circles with r = R/(1 + 2/√3)
      const rInner = R / (1 + 2 / Math.sqrt(3));
      const kInner = 1 / rInner;
      const d = rInner / Math.sqrt(3) * 2 + rInner; // dist from center to inner circle centers
      const dCenter = R - rInner;
      const c1: C = [0, -dCenter];
      const c2: C = [dCenter * Math.sin(Math.PI*2/3), dCenter * Math.cos(Math.PI*2/3)];
      const c3: C = [dCenter * Math.sin(Math.PI*4/3), dCenter * Math.cos(Math.PI*4/3)];
      const k0 = -1/R;
      circles.push({ k: k0, cx: 0, cy: 0, depth: 0 });
      circles.push({ k: kInner, cx: c1[0], cy: c1[1], depth: 1 });
      circles.push({ k: kInner, cx: c2[0], cy: c2[1], depth: 1 });
      circles.push({ k: kInner, cx: c3[0], cy: c3[1], depth: 1 });

      // Fill each gap between outer and two inner circles
      const [kA] = descartesK(k0, kInner, kInner);
      if (isFinite(kA) && kA > 0) {
        const [cA1, cA2] = descartesC(k0, kInner, kInner, kA, [0,0], c1, c2);
        buildGasket(k0, kInner, kInner, kA, [0,0], c1, c2, cA1, 2, maxDepth, minR, circles);
        buildGasket(k0, kInner, kInner, kA, [0,0], c1, c2, cA2, 2, maxDepth, minR, circles);
        const [cB1, cB2] = descartesC(k0, kInner, kInner, kA, [0,0], c1, c3);
        buildGasket(k0, kInner, kInner, kA, [0,0], c1, c3, cB1, 2, maxDepth, minR, circles);
        buildGasket(k0, kInner, kInner, kA, [0,0], c1, c3, cB2, 2, maxDepth, minR, circles);
        const [cC1, cC2] = descartesC(k0, kInner, kInner, kA, [0,0], c2, c3);
        buildGasket(k0, kInner, kInner, kA, [0,0], c2, c3, cC1, 2, maxDepth, minR, circles);
        buildGasket(k0, kInner, kInner, kA, [0,0], c2, c3, cC2, 2, maxDepth, minR, circles);
      }
      // Fill central gap
      const [kCenter] = descartesK(kInner, kInner, kInner);
      if (isFinite(kCenter) && kCenter > 0) {
        const [cCtr] = descartesC(kInner, kInner, kInner, kCenter, c1, c2, c3);
        circles.push({ k: kCenter, cx: cCtr[0], cy: cCtr[1], depth: 1 });
        buildGasket(kInner, kInner, kCenter, kCenter, c1, c2, cCtr, cCtr, 2, maxDepth, minR, circles);
      }
    } else if (startConf === 'nested') {
      // Three equal circles packed, no enclosing
      const r3 = R * 0.5;
      const k3 = 1/r3;
      const dc = r3;
      const c1: C = [0, -dc]; const c2: C = [dc*0.866, dc*0.5]; const c3: C = [-dc*0.866, dc*0.5];
      circles.push({ k: k3, cx: c1[0], cy: c1[1], depth: 0 });
      circles.push({ k: k3, cx: c2[0], cy: c2[1], depth: 0 });
      circles.push({ k: k3, cx: c3[0], cy: c3[1], depth: 0 });
      const [kA, kB] = descartesK(k3, k3, k3);
      for (const kNew of [kA, kB]) {
        if (!isFinite(kNew) || kNew <= 0 || 1/kNew < minR) continue;
        const [cNew] = descartesC(k3, k3, k3, kNew, c1, c2, c3);
        circles.push({ k: kNew, cx: cNew[0], cy: cNew[1], depth: 1 });
        buildGasket(k3, k3, k3, kNew, c1, c2, c3, cNew, 2, maxDepth, minR, circles);
      }
    } else { // strip
      const r = R * 0.4;
      const k = 1/r;
      circles.push({ k, cx: 0, cy: 0, depth: 0 });
      const c0: C = [0, 0];
      const c1: C = [2*r, 0];
      const c2: C = [-2*r, 0];
      circles.push({ k, cx: c1[0], cy: c1[1], depth: 0 });
      circles.push({ k, cx: c2[0], cy: c2[1], depth: 0 });
      const [kA] = descartesK(k, k, k);
      if (isFinite(kA) && kA > 0) {
        const [cA] = descartesC(k, k, k, kA, c0, c1, c2);
        buildGasket(k, k, k, kA, c0, c1, c2, cA, 2, maxDepth, minR, circles);
      }
    }

    // Compute range for coloring
    const maxD = Math.max(...circles.map(c => c.depth));
    const maxK = Math.max(...circles.map(c => Math.abs(c.k)));

    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    // Global transform for animation
    ctx.save();
    ctx.translate(cx, cy);
    if (animMode === 'spin') ctx.rotate(t * 0.2);
    const scaleMul = animMode === 'breathe' ? 1 + 0.05 * Math.sin(t * 1.2) : 1;
    ctx.scale(scaleMul, scaleMul);

    const colors = palette.colors.map(hexToRgb);

    // Draw largest first (depth 0/1), then smaller on top
    const sorted = [...circles].sort((a, b) => Math.abs(a.k) - Math.abs(b.k));

    for (const circ of sorted) {
      const r = Math.abs(1 / circ.k);
      if (r * R < 0.5) continue; // sub-pixel skip

      let t_color = 0;
      if (colorBy === 'depth') {
        t_color = maxD > 0 ? circ.depth / maxD : 0;
      } else if (colorBy === 'radius') {
        t_color = 1 - Math.min(1, r); // small circles → high t
      } else { // curvature
        t_color = Math.min(1, Math.abs(circ.k) / maxK);
      }

      const [cr, cg, cb] = paletteSample(t_color, colors);

      const screenR = r * R;
      const screenX = circ.cx * R;
      const screenY = circ.cy * R;

      ctx.beginPath();
      ctx.arc(screenX, screenY, screenR, 0, Math.PI * 2);
      if (doFill) {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.15)`;
        ctx.fill();
      }
      ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
      ctx.lineWidth = sw;
      ctx.stroke();
    }

    ctx.restore();
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    return Math.pow(4, params.depth ?? 4) * 10 | 0;
  },
};
