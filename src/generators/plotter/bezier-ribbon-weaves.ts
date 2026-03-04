import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

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
  weavePattern: {
    name: 'Weave Pattern',
    type: 'select',
    options: ['basket', 'twill', 'satin'],
    default: 'basket',
    help: 'basket: 1-over-1 checkerboard | twill: 2-over-2 diagonal | satin: irregular long floats',
    group: 'Composition',
  },
  ribbonStyle: {
    name: 'Ribbon Style',
    type: 'select',
    options: ['flat', 'shaded', 'striped'],
    default: 'flat',
    help: 'flat: solid fill | shaded: 3D highlight/shadow | striped: decorative center stripe',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-pair', 'palette-index', 'monochrome', 'gradient'],
    default: 'palette-pair',
    help: 'palette-pair: H/V use alternating halves | palette-index: each strand unique | gradient: smooth interpolation',
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

// Determine if vertical goes OVER horizontal at crossing (i, j) based on weave pattern
function verticalIsOver(i: number, j: number, pattern: string): boolean {
  if (pattern === 'twill') {
    // 2/2 twill: diagonal pattern
    return ((i + j) % 4) < 2;
  } else if (pattern === 'satin') {
    // Satin: irregular offset (5-harness satin)
    return ((i + j * 3) % 5) === 0;
  }
  // basket: simple alternating
  return (i + j) % 2 === 0;
}

export const bezierRibbonWeaves: Generator = {
  id: 'plotter-bezier-ribbon-weaves',
  family: 'plotter',
  styleName: 'Bézier Ribbon Weaves',
  definition: 'Horizontal and vertical bezier ribbon strands woven in configurable patterns with 3D shading',
  algorithmNotes:
    'N horizontal and N vertical ribbons traverse the canvas as cubic bezier paths. Weave patterns (basket, twill, satin) define over/under crossings. Ribbon styles add shaded 3D depth or decorative stripes. Over/under rendering uses clipped redraws for clean crossings.',
  parameterSchema,
  defaultParams: {
    strandCount: 6, ribbonWidth: 22, amplitude: 28, frequency: 1.5,
    weavePattern: 'basket', ribbonStyle: 'flat',
    colorMode: 'palette-pair', background: 'cream', waveSpeed: 0.25,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const isDark = params.background === 'dark';
    const colors = palette.colors.map(hexToRgb);

    const n = Math.max(2, (params.strandCount ?? 6) | 0);
    const ribbonW = Math.max(2, params.ribbonWidth ?? 22);
    const amp = params.amplitude ?? 28;
    const freq = params.frequency ?? 1.5;
    const waveSpeed = params.waveSpeed ?? 0.25;
    const colorMode = params.colorMode || 'palette-pair';
    const weavePattern = params.weavePattern || 'basket';
    const ribbonStyle = params.ribbonStyle || 'flat';

    const halfLen = Math.max(1, (colors.length / 2) | 0);

    function strandColor(isHoriz: boolean, index: number): [number, number, number] {
      if (colorMode === 'monochrome') return isDark ? [220, 220, 220] : [30, 30, 30];
      if (colorMode === 'palette-pair') {
        return isHoriz
          ? (colors[index % halfLen] ?? colors[0])
          : (colors[halfLen + (index % (colors.length - halfLen))] ?? colors[colors.length - 1]);
      }
      if (colorMode === 'palette-index') return colors[(isHoriz ? index : index + n) % colors.length];
      const t = index / (n - 1);
      const ci = t * (colors.length - 1);
      const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
      return lerpColor(colors[i0], colors[i1], ci - i0);
    }

    const margin = ribbonW * 1.2;
    const spacingH = (h - 2 * margin) / (n - 1);
    const spacingW = (w - 2 * margin) / (n - 1);

    // Pre-generate bezier control points
    const hCenters: number[] = [], hCp1y: number[] = [], hCp2y: number[] = [];
    for (let i = 0; i < n; i++) {
      const yc = margin + i * spacingH;
      hCenters.push(yc);
      const phase1 = rng.random() * Math.PI * 2;
      const phase2 = rng.random() * Math.PI * 2;
      hCp1y.push(yc + amp * Math.sin(time * waveSpeed * freq + phase1));
      hCp2y.push(yc + amp * Math.sin(time * waveSpeed * freq + phase2 + Math.PI));
    }

    const vCenters: number[] = [], vCp1x: number[] = [], vCp2x: number[] = [];
    for (let j = 0; j < n; j++) {
      const xc = margin + j * spacingW;
      vCenters.push(xc);
      const phase1 = rng.random() * Math.PI * 2;
      const phase2 = rng.random() * Math.PI * 2;
      vCp1x.push(xc + amp * Math.sin(time * waveSpeed * freq + phase1));
      vCp2x.push(xc + amp * Math.sin(time * waveSpeed * freq + phase2 + Math.PI));
    }

    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const alpha = isDark ? 0.88 : 0.85;

    // Draw a horizontal bezier strand
    function drawH(i: number, strokeOnly = false) {
      ctx.beginPath();
      ctx.moveTo(0, hCenters[i]);
      ctx.bezierCurveTo(w / 3, hCp1y[i], (2 * w) / 3, hCp2y[i], w, hCenters[i]);
      if (strokeOnly) ctx.stroke(); else ctx.stroke();
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

    // Ribbon rendering: applies style (flat, shaded, striped)
    function drawRibbon(
      color: [number, number, number],
      drawFn: () => void,
    ) {
      const [cr, cg, cb] = color;

      if (ribbonStyle === 'shaded') {
        // Draw three passes: shadow, main, highlight
        // Shadow (offset slightly)
        ctx.strokeStyle = isDark
          ? `rgba(0,0,0,0.3)`
          : `rgba(0,0,0,0.12)`;
        ctx.lineWidth = ribbonW + 2;
        drawFn();

        // Main fill
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.lineWidth = ribbonW;
        drawFn();

        // Highlight stripe
        ctx.strokeStyle = isDark
          ? `rgba(255,255,255,0.15)`
          : `rgba(255,255,255,0.3)`;
        ctx.lineWidth = ribbonW * 0.25;
        drawFn();
      } else if (ribbonStyle === 'striped') {
        // Main ribbon
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.lineWidth = ribbonW;
        drawFn();

        // Decorative center stripe (contrasting)
        const sc = isDark ? Math.min(255, cr + 60) : Math.max(0, cr - 60);
        const sg = isDark ? Math.min(255, cg + 60) : Math.max(0, cg - 60);
        const sb = isDark ? Math.min(255, cb + 60) : Math.max(0, cb - 60);
        ctx.strokeStyle = `rgba(${sc},${sg},${sb},${alpha * 0.6})`;
        ctx.lineWidth = ribbonW * 0.15;
        drawFn();

        // Edge lines
        ctx.strokeStyle = isDark ? `rgba(0,0,0,0.35)` : `rgba(255,255,255,0.4)`;
        ctx.lineWidth = 1;
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
    }

    // ── Step 1: Draw all horizontal ribbons ─────────────────────────────
    for (let i = 0; i < n; i++) {
      drawRibbon(strandColor(true, i), () => drawH(i));
    }

    // ── Step 2: Draw vertical ribbons, skipping "under" crossings ───────
    for (let j = 0; j < n; j++) {
      const skipRanges: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        if (!verticalIsOver(i, j, weavePattern)) {
          const yCross = sampleHorizY(w, hCenters[i], hCp1y[i], hCp2y[i], vCenters[j]);
          const halfRib = ribbonW / 2 + 2;
          skipRanges.push([yCross - halfRib, yCross + halfRib]);
        }
      }
      drawRibbon(strandColor(false, j), () => drawV(j, skipRanges));
    }

    // ── Step 3: Redraw horizontal sections at "over" crossings ──────────
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (verticalIsOver(i, j, weavePattern)) continue;
        const xCross = sampleVertX(h, vCenters[j], vCp1x[j], vCp2x[j], hCenters[i]);
        const halfRib = ribbonW / 2 + 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(xCross - halfRib, 0, halfRib * 2, h);
        ctx.clip();
        drawRibbon(strandColor(true, i), () => drawH(i));
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
