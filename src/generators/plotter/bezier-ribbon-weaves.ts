import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(
  c0: [number, number, number],
  c1: [number, number, number],
  f: number,
): [number, number, number] {
  return [
    (c0[0] + (c1[0] - c0[0]) * f) | 0,
    (c0[1] + (c1[1] - c0[1]) * f) | 0,
    (c0[2] + (c1[2] - c0[2]) * f) | 0,
  ];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  strandCount: {
    name: 'Strand Count',
    type: 'number', min: 2, max: 14, step: 1, default: 6,
    help: 'Number of horizontal (and vertical) ribbon strands',
    group: 'Composition',
  },
  ribbonWidth: {
    name: 'Ribbon Width',
    type: 'number', min: 4, max: 60, step: 2, default: 22,
    help: 'Thickness of each ribbon stroke in pixels',
    group: 'Geometry',
  },
  amplitude: {
    name: 'Amplitude',
    type: 'number', min: 0, max: 80, step: 2, default: 28,
    help: 'Bezier control-point jitter — how much each ribbon curves',
    group: 'Geometry',
  },
  frequency: {
    name: 'Wave Frequency',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 1.5,
    help: 'Number of full sine cycles per strand in animation mode',
    group: 'Geometry',
  },
  twist: {
    name: 'Twist',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0,
    help: 'Ribbon width variation along path — simulates twisting ribbons',
    group: 'Geometry',
  },
  weavePattern: {
    name: 'Weave Pattern',
    type: 'select',
    options: ['basket', 'twill', 'satin', 'herringbone', 'diamond'],
    default: 'basket',
    help: 'basket: 1/1 · twill: 2/2 diagonal · satin: irregular floats · herringbone: zigzag · diamond: centered motif',
    group: 'Composition',
  },
  ribbonStyle: {
    name: 'Ribbon Style',
    type: 'select',
    options: ['flat', 'shaded', 'striped', 'silk', 'embossed'],
    default: 'flat',
    help: 'flat: solid · shaded: 3D depth · striped: center stripe · silk: glossy gradient · embossed: raised edge effect',
    group: 'Texture',
  },
  crossingShadow: {
    name: 'Crossing Shadow',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0.3,
    help: 'Shadow intensity at crossing points for 3D depth illusion',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-pair', 'palette-index', 'monochrome', 'gradient', 'rainbow-twist'],
    default: 'palette-pair',
    help: 'palette-pair: H/V use halves · palette-index: each unique · gradient: smooth interpolation · rainbow-twist: color shifts along each ribbon',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
  waveSpeed: {
    name: 'Wave Speed',
    type: 'number', min: 0, max: 1.0, step: 0.05, default: 0.25,
    help: 'Speed at which bezier control points oscillate (animation)',
    group: 'Flow/Motion',
  },
};

function cubicBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function sampleHorizY(w: number, y0: number, cp1y: number, cp2y: number, x: number): number {
  return cubicBezier(y0, cp1y, cp2y, y0, Math.max(0, Math.min(1, x / w)));
}

function sampleVertX(h: number, x0: number, cp1x: number, cp2x: number, y: number): number {
  return cubicBezier(x0, cp1x, cp2x, x0, Math.max(0, Math.min(1, y / h)));
}

function verticalIsOver(i: number, j: number, pattern: string, n: number): boolean {
  if (pattern === 'twill') {
    return ((i + j) % 4) < 2;
  } else if (pattern === 'satin') {
    return ((i + j * 3) % 5) === 0;
  } else if (pattern === 'herringbone') {
    // Zigzag: direction reverses every row
    const dir = i % 2 === 0 ? 1 : -1;
    return ((i + j * dir + n) % 2) === 0;
  } else if (pattern === 'diamond') {
    // Diamond: centered motif based on distance from center
    const ci = Math.abs(i - (n - 1) / 2);
    const cj = Math.abs(j - (n - 1) / 2);
    return ((Math.round(ci) + Math.round(cj)) % 2) === 0;
  }
  // basket
  return (i + j) % 2 === 0;
}

export const bezierRibbonWeaves: Generator = {
  id: 'plotter-bezier-ribbon-weaves',
  family: 'plotter',
  styleName: 'Bézier Ribbon Weaves',
  definition: 'Horizontal and vertical bezier ribbon strands woven in configurable patterns with 3D shading',
  algorithmNotes:
    'N horizontal and N vertical ribbons traverse the canvas as cubic bezier paths. Weave patterns (basket, twill, satin, herringbone, diamond) define over/under crossings. Ribbon styles add shaded 3D depth, silk gradients, or embossed edges. Crossing shadows enhance depth. Over/under rendering uses clipped redraws for clean crossings.',
  parameterSchema,
  defaultParams: {
    strandCount: 6, ribbonWidth: 22, amplitude: 28, frequency: 1.5, twist: 0,
    weavePattern: 'basket', ribbonStyle: 'flat', crossingShadow: 0.3,
    colorMode: 'palette-pair', background: 'cream', waveSpeed: 0.25,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const isDark = params.background === 'dark';
    const colors = palette.colors.map(hexToRgb);

    const n = Math.max(2, (params.strandCount ?? 6) | 0);
    const ribbonW = Math.max(2, params.ribbonWidth ?? 22);
    const amp = params.amplitude ?? 28;
    const freq = params.frequency ?? 1.5;
    const twist = params.twist ?? 0;
    const waveSpeed = params.waveSpeed ?? 0.25;
    const colorMode = params.colorMode || 'palette-pair';
    const weavePattern = params.weavePattern || 'basket';
    const ribbonStyle = params.ribbonStyle || 'flat';
    const crossingShadow = params.crossingShadow ?? 0.3;

    const halfLen = Math.max(1, (colors.length / 2) | 0);

    function strandColor(isHoriz: boolean, index: number): [number, number, number] {
      if (colorMode === 'monochrome') return isDark ? [220, 220, 220] : [30, 30, 30];
      if (colorMode === 'palette-pair') {
        return isHoriz
          ? (colors[index % halfLen] ?? colors[0])
          : (colors[halfLen + (index % (colors.length - halfLen))] ?? colors[colors.length - 1]);
      }
      if (colorMode === 'palette-index') return colors[(isHoriz ? index : index + n) % colors.length];
      if (colorMode === 'rainbow-twist') {
        // Base color from palette, but shifts along the ribbon
        return colors[index % colors.length];
      }
      const t = index / Math.max(1, n - 1);
      const ci = t * (colors.length - 1);
      const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
      return lerpColor(colors[i0], colors[i1], ci - i0);
    }

    // For rainbow-twist, get a shifted color at a given t along the ribbon
    function shiftedColor(base: [number, number, number], index: number, t: number): [number, number, number] {
      if (colorMode !== 'rainbow-twist') return base;
      const shifted = (index + t * 2) % colors.length;
      const i0 = Math.floor(shifted), i1 = Math.ceil(shifted) % colors.length;
      const f = shifted - i0;
      return lerpColor(colors[i0 % colors.length], colors[i1], f);
    }

    const margin = ribbonW * 1.2;
    const spacingH = (h - 2 * margin) / (n - 1);
    const spacingW = (w - 2 * margin) / (n - 1);

    // Pre-generate bezier control points with per-strand independent animation
    const hCenters: number[] = [], hCp1y: number[] = [], hCp2y: number[] = [];
    for (let i = 0; i < n; i++) {
      const yc = margin + i * spacingH;
      hCenters.push(yc);
      const phase1 = rng.random() * Math.PI * 2;
      const phase2 = rng.random() * Math.PI * 2;
      const strandFreq = freq * (0.8 + rng.random() * 0.4); // slight per-strand variation
      hCp1y.push(yc + amp * Math.sin(time * waveSpeed * strandFreq + phase1));
      hCp2y.push(yc + amp * Math.sin(time * waveSpeed * strandFreq + phase2 + Math.PI));
    }

    const vCenters: number[] = [], vCp1x: number[] = [], vCp2x: number[] = [];
    for (let j = 0; j < n; j++) {
      const xc = margin + j * spacingW;
      vCenters.push(xc);
      const phase1 = rng.random() * Math.PI * 2;
      const phase2 = rng.random() * Math.PI * 2;
      const strandFreq = freq * (0.8 + rng.random() * 0.4);
      vCp1x.push(xc + amp * Math.sin(time * waveSpeed * strandFreq + phase1));
      vCp2x.push(xc + amp * Math.sin(time * waveSpeed * strandFreq + phase2 + Math.PI));
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const alpha = isDark ? 0.88 : 0.85;

    // Compute twist width at a given t along the path
    function twistWidth(t: number, strandIndex: number): number {
      if (twist <= 0) return ribbonW;
      const nv = noise.noise2D(strandIndex * 3.7 + 5, t * 4);
      return ribbonW * (1 - twist * 0.4 * (0.5 + 0.5 * nv));
    }

    // Draw a horizontal bezier strand
    function drawH(i: number) {
      ctx.beginPath();
      ctx.moveTo(0, hCenters[i]);
      ctx.bezierCurveTo(w / 3, hCp1y[i], (2 * w) / 3, hCp2y[i], w, hCenters[i]);
      ctx.stroke();
    }

    // Draw a vertical bezier strand, optionally skipping Y-ranges
    function drawV(j: number, skipRanges?: [number, number][]) {
      if (!skipRanges || skipRanges.length === 0) {
        ctx.beginPath();
        ctx.moveTo(vCenters[j], 0);
        ctx.bezierCurveTo(vCp1x[j], h / 3, vCp2x[j], (2 * h) / 3, vCenters[j], h);
        ctx.stroke();
        return;
      }
      const sorted = [...skipRanges].sort((a, b) => a[0] - b[0]);
      const ranges: [number, number][] = [];
      let prev = 0;
      for (const [yT, yB] of sorted) {
        if (prev < yT) ranges.push([prev, yT]);
        prev = yB;
      }
      if (prev < h) ranges.push([prev, h]);

      for (const [segTop, segBot] of ranges) {
        const tS = segTop / h, tE = segBot / h;
        const steps = Math.max(2, Math.ceil((segBot - segTop) / 2));
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const t = tS + (tE - tS) * (s / steps);
          const px = cubicBezier(vCenters[j], vCp1x[j], vCp2x[j], vCenters[j], t);
          const py = t * h;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    // Draw a horizontal strand as segmented with twist width variation
    function drawHTwist(i: number) {
      const steps = 40;
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const x0 = t0 * w, x1 = t1 * w;
        const y0 = cubicBezier(hCenters[i], hCp1y[i], hCp2y[i], hCenters[i], t0);
        const y1 = cubicBezier(hCenters[i], hCp1y[i], hCp2y[i], hCenters[i], t1);
        const tw = twistWidth(t0, i);
        ctx.lineWidth = tw;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }

    // Ribbon rendering: applies style
    function drawRibbon(
      color: [number, number, number],
      drawFn: () => void,
      isHoriz: boolean,
      strandIndex: number,
    ) {
      const [cr, cg, cb] = color;

      if (ribbonStyle === 'shaded') {
        // Shadow
        ctx.strokeStyle = isDark ? `rgba(0,0,0,0.3)` : `rgba(0,0,0,0.12)`;
        ctx.lineWidth = ribbonW + 3;
        drawFn();
        // Main fill
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.lineWidth = ribbonW;
        drawFn();
        // Highlight
        ctx.strokeStyle = isDark ? `rgba(255,255,255,0.18)` : `rgba(255,255,255,0.35)`;
        ctx.lineWidth = ribbonW * 0.2;
        drawFn();

      } else if (ribbonStyle === 'striped') {
        // Main ribbon
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.lineWidth = ribbonW;
        drawFn();
        // Dual decorative stripes
        const sc = isDark ? Math.min(255, cr + 60) : Math.max(0, cr - 60);
        const sg = isDark ? Math.min(255, cg + 60) : Math.max(0, cg - 60);
        const sb = isDark ? Math.min(255, cb + 60) : Math.max(0, cb - 60);
        ctx.strokeStyle = `rgba(${sc},${sg},${sb},${alpha * 0.55})`;
        ctx.lineWidth = ribbonW * 0.12;
        drawFn();
        // Edge lines
        ctx.strokeStyle = isDark ? `rgba(0,0,0,0.3)` : `rgba(255,255,255,0.35)`;
        ctx.lineWidth = 1;
        drawFn();

      } else if (ribbonStyle === 'silk') {
        // Outer darker stroke for depth
        const darken = 0.6;
        ctx.strokeStyle = `rgba(${(cr * darken) | 0},${(cg * darken) | 0},${(cb * darken) | 0},${alpha})`;
        ctx.lineWidth = ribbonW;
        drawFn();
        // Inner brighter gradient-like stroke
        const brighten = Math.min;
        ctx.strokeStyle = `rgba(${brighten(255, cr + 50)},${brighten(255, cg + 50)},${brighten(255, cb + 50)},${alpha * 0.7})`;
        ctx.lineWidth = ribbonW * 0.55;
        drawFn();
        // Hot highlight
        ctx.strokeStyle = `rgba(255,255,255,${isDark ? 0.2 : 0.35})`;
        ctx.lineWidth = ribbonW * 0.12;
        drawFn();

      } else if (ribbonStyle === 'embossed') {
        // Bottom-right shadow
        ctx.save();
        ctx.shadowColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.lineWidth = ribbonW;
        drawFn();
        ctx.restore();
        // Top-left inner highlight
        ctx.strokeStyle = `rgba(255,255,255,${isDark ? 0.12 : 0.25})`;
        ctx.lineWidth = ribbonW * 0.3;
        drawFn();

      } else {
        // Flat
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.lineWidth = ribbonW;
        drawFn();
        // Thin border
        ctx.strokeStyle = isDark ? `rgba(0,0,0,0.35)` : `rgba(255,255,255,0.4)`;
        ctx.lineWidth = 1;
        drawFn();
      }

      // Rainbow-twist: overlay shifted color segments
      if (colorMode === 'rainbow-twist') {
        const segments = 12;
        for (let s = 0; s < segments; s++) {
          const t = s / segments;
          const col = shiftedColor(color, strandIndex, t);
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.25)`;
          ctx.lineWidth = ribbonW * 0.6;
          drawFn();
        }
      }
    }

    // Draw crossing shadows for 3D depth
    function drawCrossingShadows() {
      if (crossingShadow <= 0) return;

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const isVOver = verticalIsOver(i, j, weavePattern, n);
          // Shadow falls on the "under" ribbon at the crossing
          const yCross = sampleHorizY(w, hCenters[i], hCp1y[i], hCp2y[i], vCenters[j]);
          const xCross = sampleVertX(h, vCenters[j], vCp1x[j], vCp2x[j], hCenters[i]);

          const shadowR = ribbonW * 0.7;
          const gradient = ctx.createRadialGradient(xCross, yCross, 0, xCross, yCross, shadowR);
          gradient.addColorStop(0, `rgba(0,0,0,${(crossingShadow * 0.3).toFixed(2)})`);
          gradient.addColorStop(0.5, `rgba(0,0,0,${(crossingShadow * 0.12).toFixed(2)})`);
          gradient.addColorStop(1, 'rgba(0,0,0,0)');

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(xCross, yCross, shadowR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    const useTwist = twist > 0;

    // ── Step 1: Draw crossing shadows beneath everything ─────────────
    drawCrossingShadows();

    // ── Step 2: Draw all horizontal ribbons ──────────────────────────
    for (let i = 0; i < n; i++) {
      const drawFn = useTwist ? () => drawHTwist(i) : () => drawH(i);
      drawRibbon(strandColor(true, i), drawFn, true, i);
    }

    // ── Step 3: Draw vertical ribbons, skipping "under" crossings ───
    for (let j = 0; j < n; j++) {
      const skipRanges: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        if (!verticalIsOver(i, j, weavePattern, n)) {
          const yCross = sampleHorizY(w, hCenters[i], hCp1y[i], hCp2y[i], vCenters[j]);
          const halfRib = ribbonW / 2 + 2;
          skipRanges.push([yCross - halfRib, yCross + halfRib]);
        }
      }
      drawRibbon(strandColor(false, j), () => drawV(j, skipRanges), false, j);
    }

    // ── Step 4: Redraw horizontal sections at "over" crossings ──────
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (verticalIsOver(i, j, weavePattern, n)) continue;
        const xCross = sampleVertX(h, vCenters[j], vCp1x[j], vCp2x[j], hCenters[i]);
        const halfRib = ribbonW / 2 + 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(xCross - halfRib, 0, halfRib * 2, h);
        ctx.clip();
        const drawFn = useTwist ? () => drawHTwist(i) : () => drawH(i);
        drawRibbon(strandColor(true, i), drawFn, true, i);
        ctx.restore();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    const n = params.strandCount ?? 6;
    return (n * n * 4) | 0;
  },
};
