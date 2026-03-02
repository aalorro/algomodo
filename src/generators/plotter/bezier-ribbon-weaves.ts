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
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette-pair', 'palette-index', 'monochrome', 'gradient'],
    default: 'palette-pair',
    help: 'palette-pair: horizontal/vertical use alternating palette halves | palette-index: each strand gets its own colour | gradient: smooth interpolation across strands',
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
    help: 'Speed at which the bezier control points oscillate (animation)',
    group: 'Flow/Motion',
  },
};

// Evaluate cubic bezier at parameter t in [0,1]
function cubicBezier(
  p0: number, p1: number, p2: number, p3: number, t: number,
): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

// Sample a horizontal bezier strand's y-value at a given x (0..w)
function sampleHorizY(
  w: number,
  y0: number, cp1y: number, cp2y: number,
  x: number,
): number {
  // For a bezier going from x=0 to x=w with roughly linear x parametrisation, t ≈ x/w
  const t = Math.max(0, Math.min(1, x / w));
  return cubicBezier(y0, cp1y, cp2y, y0, t);
}

// Sample a vertical bezier strand's x-value at a given y (0..h)
function sampleVertX(
  h: number,
  x0: number, cp1x: number, cp2x: number,
  y: number,
): number {
  const t = Math.max(0, Math.min(1, y / h));
  return cubicBezier(x0, cp1x, cp2x, x0, t);
}

// Draw a thick cubic bezier stroke from (0, y0) to (w, y0) with control points cp1y, cp2y
function drawHorizStrand(
  ctx: CanvasRenderingContext2D,
  w: number, y0: number, cp1y: number, cp2y: number,
) {
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.bezierCurveTo(w / 3, cp1y, (2 * w) / 3, cp2y, w, y0);
  ctx.stroke();
}

// Draw a thick cubic bezier stroke from (x0, 0) to (x0, h) with control points cp1x, cp2x
function drawVertStrand(
  ctx: CanvasRenderingContext2D,
  h: number, x0: number, cp1x: number, cp2x: number,
) {
  ctx.beginPath();
  ctx.moveTo(x0, 0);
  ctx.bezierCurveTo(cp1x, h / 3, cp2x, (2 * h) / 3, x0, h);
  ctx.stroke();
}

// Draw a vertical strand as a sampled polyline, skipping the provided Y-ranges
function drawVertStrandSegmented(
  ctx: CanvasRenderingContext2D,
  h: number, x0: number, cp1x: number, cp2x: number,
  skipRanges: [number, number][],
) {
  // Sort skip ranges
  const sorted = [...skipRanges].sort((a, b) => a[0] - b[0]);

  const STEPS = Math.ceil(h / 2) + 1;

  // Build segments between skip ranges
  const segments: [number, number][][] = [];
  let prevY = 0;

  for (const [yTop, yBot] of sorted) {
    if (prevY < yTop) segments.push([[prevY, prevY], [yTop, yTop]]);
    prevY = yBot;
  }
  if (prevY < h) segments.push([[prevY, prevY], [h, h]]);

  // Draw each segment as a sampled polyline along the bezier
  for (const [[segTop], [segBot]] of segments) {
    const tStart = segTop / h;
    const tEnd = segBot / h;
    const steps = Math.max(2, Math.ceil((segBot - segTop) / 2));

    ctx.beginPath();
    let first = true;
    for (let s = 0; s <= steps; s++) {
      const t = tStart + (tEnd - tStart) * (s / steps);
      const px = cubicBezier(x0, cp1x, cp2x, x0, t);
      const py = t * h;
      if (first) { ctx.moveTo(px, py); first = false; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

export const bezierRibbonWeaves: Generator = {
  id: 'plotter-bezier-ribbon-weaves',
  family: 'plotter',
  styleName: 'Bézier Ribbon Weaves',
  definition:
    'Horizontal and vertical bezier ribbon strands woven over/under each other in an alternating basket-weave pattern',
  algorithmNotes:
    'N horizontal and N vertical ribbons traverse the canvas as cubic bezier paths, with seeded random control-point jitter for organic curves. Over/under weaving is implemented by drawing horizontal strands first, then rendering each vertical strand via a segmented polyline that skips the Y-ranges of "under" crossings — where (i+j) % 2 ≠ 0 — allowing the horizontal ribbon to show through. In animation mode the bezier control points oscillate sinusoidally, producing a flowing wave through the weave.',
  parameterSchema,
  defaultParams: {
    strandCount: 6,
    ribbonWidth: 22,
    amplitude: 28,
    frequency: 1.5,
    colorMode: 'palette-pair',
    background: 'cream',
    waveSpeed: 0.25,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
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

    // Half-palette split for pair mode
    const halfLen = Math.max(1, (colors.length / 2) | 0);

    function strandColor(
      isHoriz: boolean,
      index: number,
    ): [number, number, number] {
      if (colorMode === 'monochrome') {
        return isDark ? [220, 220, 220] : [30, 30, 30];
      }
      if (colorMode === 'palette-pair') {
        if (isHoriz) {
          return colors[index % halfLen] ?? colors[0];
        } else {
          return colors[halfLen + (index % (colors.length - halfLen))] ?? colors[colors.length - 1];
        }
      }
      if (colorMode === 'palette-index') {
        return colors[(isHoriz ? index : index + n) % colors.length];
      }
      // gradient
      const t = index / (n - 1);
      const ci = t * (colors.length - 1);
      const i0 = Math.floor(ci);
      const i1 = Math.min(colors.length - 1, i0 + 1);
      return lerpColor(colors[i0], colors[i1], ci - i0);
    }

    // Strand centers (evenly spaced with margin = ribbonW * 1.2)
    const margin = ribbonW * 1.2;
    const spacingH = (h - 2 * margin) / (n - 1);
    const spacingW = (w - 2 * margin) / (n - 1);

    // Pre-generate bezier control points per strand (seeded)
    // Horizontal strand i: y-center = margin + i * spacingH
    //   cp1y = yCenter + amp * sin(phase1)
    //   cp2y = yCenter + amp * sin(phase2)
    const hCenters: number[] = [];
    const hCp1y: number[] = [];
    const hCp2y: number[] = [];
    for (let i = 0; i < n; i++) {
      const yc = margin + i * spacingH;
      hCenters.push(yc);
      const phase1 = rng.random() * Math.PI * 2;
      const phase2 = rng.random() * Math.PI * 2;
      // Animated: oscillate control points
      hCp1y.push(yc + amp * Math.sin(time * waveSpeed * freq + phase1));
      hCp2y.push(yc + amp * Math.sin(time * waveSpeed * freq + phase2 + Math.PI));
    }

    // Vertical strand j: x-center = margin + j * spacingW
    const vCenters: number[] = [];
    const vCp1x: number[] = [];
    const vCp2x: number[] = [];
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

    // ── Step 1: Draw all horizontal ribbons (complete) ─────────────────────
    for (let i = 0; i < n; i++) {
      const [cr, cg, cb] = strandColor(true, i);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
      ctx.lineWidth = ribbonW;
      drawHorizStrand(ctx, w, hCenters[i], hCp1y[i], hCp2y[i]);

      // Thin border for ribbon edge definition
      ctx.strokeStyle = isDark
        ? `rgba(0,0,0,0.35)`
        : `rgba(255,255,255,0.4)`;
      ctx.lineWidth = 1;
      drawHorizStrand(ctx, w, hCenters[i], hCp1y[i], hCp2y[i]);
    }

    // ── Step 2: Draw vertical ribbons, skipping "under" crossing zones ─────
    // At crossing (i, j): vertical goes OVER if (i + j) % 2 === 0
    //                     vertical goes UNDER if (i + j) % 2 !== 0
    for (let j = 0; j < n; j++) {
      // Build list of Y-ranges where vertical j goes UNDER a horizontal strand i
      const skipRanges: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        if ((i + j) % 2 !== 0) {
          // Vertical goes under horizontal i at this crossing
          // Approximate crossing Y using the horizontal strand's Y at x = vCenters[j]
          const yCross = sampleHorizY(w, hCenters[i], hCp1y[i], hCp2y[i], vCenters[j]);
          const halfRib = ribbonW / 2 + 2; // small margin for clean edge
          skipRanges.push([yCross - halfRib, yCross + halfRib]);
        }
      }

      const [cr, cg, cb] = strandColor(false, j);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
      ctx.lineWidth = ribbonW;
      drawVertStrandSegmented(ctx, h, vCenters[j], vCp1x[j], vCp2x[j], skipRanges);

      // Thin border pass
      ctx.strokeStyle = isDark
        ? `rgba(0,0,0,0.35)`
        : `rgba(255,255,255,0.4)`;
      ctx.lineWidth = 1;
      drawVertStrandSegmented(ctx, h, vCenters[j], vCp1x[j], vCp2x[j], skipRanges);
    }

    // ── Step 3: Redraw horizontal sections at "over" crossings ─────────────
    // Horizontal goes OVER vertical when (i + j) % 2 !== 0
    // We redraw just the small X-segment of the horizontal strand around the crossing
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i + j) % 2 === 0) continue; // vertical was on top — skip
        // Horizontal strand i goes OVER vertical strand j here
        // Find approximate X-range of crossing (vertical strand j at y = hCenters[i])
        const xCross = sampleVertX(h, vCenters[j], vCp1x[j], vCp2x[j], hCenters[i]);
        const halfRib = ribbonW / 2 + 2;
        const xL = xCross - halfRib;
        const xR = xCross + halfRib;

        // Redraw horizontal strand i in the X-range [xL, xR] using clipping
        ctx.save();
        ctx.beginPath();
        ctx.rect(xL, 0, xR - xL, h);
        ctx.clip();

        const [cr, cg, cb] = strandColor(true, i);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.lineWidth = ribbonW;
        drawHorizStrand(ctx, w, hCenters[i], hCp1y[i], hCp2y[i]);

        ctx.strokeStyle = isDark
          ? `rgba(0,0,0,0.35)`
          : `rgba(255,255,255,0.4)`;
        ctx.lineWidth = 1;
        drawHorizStrand(ctx, w, hCenters[i], hCp1y[i], hCp2y[i]);

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
