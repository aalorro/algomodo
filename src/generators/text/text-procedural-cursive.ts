import type { Generator, ParameterSchema, Palette } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    (a[0] + (b[0] - a[0]) * t) | 0,
    (a[1] + (b[1] - a[1]) * t) | 0,
    (a[2] + (b[2] - a[2]) * t) | 0,
  ];
}

/** Generate a single cursive letter-form as control points */
function generateLetterForm(
  rng: SeededRNG,
  baseX: number,
  baseY: number,
  letterW: number,
  letterH: number,
  loopiness: number,
): number[] {
  // Returns flat array [x0,y0, x1,y1, ...] for zero-allocation
  const form = rng.integer(0, 9);
  // Add slight random perturbation to proportions for variety
  const v1 = 0.9 + rng.random() * 0.2;
  const v2 = 0.85 + rng.random() * 0.3;

  switch (form) {
    case 0: // hump (n-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.1, baseY - letterH * 0.8 * v1,
        baseX + letterW * 0.5, baseY - letterH * 0.9 * loopiness,
        baseX + letterW * 0.7, baseY - letterH * 0.5 * v2,
        baseX + letterW, baseY,
      ];
    case 1: // loop (o-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.2, baseY - letterH * 0.9 * loopiness * v1,
        baseX + letterW * 0.8, baseY - letterH * 0.85 * loopiness,
        baseX + letterW * 0.85, baseY - letterH * 0.2 * v2,
        baseX + letterW * 0.3, baseY + letterH * 0.1,
        baseX + letterW, baseY,
      ];
    case 2: // ascender loop (l-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.3, baseY - letterH * 1.5 * loopiness * v1,
        baseX + letterW * 0.6, baseY - letterH * 1.35 * loopiness,
        baseX + letterW * 0.4, baseY - letterH * 0.5 * v2,
        baseX + letterW, baseY,
      ];
    case 3: // valley (u-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.1, baseY + letterH * 0.3 * v1,
        baseX + letterW * 0.5, baseY + letterH * 0.5 * loopiness,
        baseX + letterW * 0.9, baseY + letterH * 0.2 * v2,
        baseX + letterW, baseY,
      ];
    case 4: // descender loop (g-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.3, baseY - letterH * 0.6 * v1,
        baseX + letterW * 0.7, baseY - letterH * 0.5,
        baseX + letterW * 0.8, baseY + letterH * 0.3 * v2,
        baseX + letterW * 0.5, baseY + letterH * 0.8 * loopiness,
        baseX + letterW * 0.3, baseY + letterH * 0.3,
        baseX + letterW, baseY,
      ];
    case 5: // double valley (w-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.2, baseY + letterH * 0.4 * loopiness * v1,
        baseX + letterW * 0.35, baseY - letterH * 0.2,
        baseX + letterW * 0.55, baseY + letterH * 0.4 * loopiness * v2,
        baseX + letterW * 0.75, baseY - letterH * 0.25,
        baseX + letterW, baseY,
      ];
    case 6: // tall form (f-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.2, baseY - letterH * 1.2 * loopiness * v1,
        baseX + letterW * 0.5, baseY - letterH * 1.25 * loopiness,
        baseX + letterW * 0.4, baseY - letterH * 0.3 * v2,
        baseX + letterW * 0.7, baseY - letterH * 0.5,
        baseX + letterW * 0.6, baseY,
        baseX + letterW, baseY,
      ];
    case 7: // small loop (e-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.4 * v1, baseY - letterH * 0.5,
        baseX + letterW * 0.7, baseY - letterH * 0.6 * loopiness,
        baseX + letterW * 0.6, baseY - letterH * 0.3 * v2,
        baseX + letterW * 0.3, baseY - letterH * 0.1,
        baseX + letterW, baseY,
      ];
    case 8: // sharp (v-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.15, baseY - letterH * 0.3 * v1,
        baseX + letterW * 0.45, baseY + letterH * 0.5 * loopiness,
        baseX + letterW * 0.75, baseY - letterH * 0.35 * v2,
        baseX + letterW, baseY,
      ];
    default: // wide arc (m-shape)
      return [
        baseX, baseY,
        baseX + letterW * 0.15, baseY - letterH * 0.7 * v1,
        baseX + letterW * 0.35, baseY - letterH * 0.3,
        baseX + letterW * 0.5, baseY - letterH * 0.75 * loopiness * v2,
        baseX + letterW * 0.7, baseY - letterH * 0.3,
        baseX + letterW * 0.85, baseY - letterH * 0.6,
        baseX + letterW, baseY,
      ];
  }
}

/** Catmull-Rom spline — writes into flat output arrays for speed */
function catmullRomFlat(
  pts: number[], // flat [x0,y0, x1,y1, ...]
  segments: number,
  outX: number[],
  outY: number[],
) {
  const n = pts.length / 2;
  if (n < 2) {
    if (n === 1) { outX.push(pts[0]); outY.push(pts[1]); }
    return;
  }

  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1) * 2;
    const i1 = i * 2;
    const i2 = (i + 1) * 2;
    const i3 = Math.min(n - 1, i + 2) * 2;

    const p0x = pts[i0], p0y = pts[i0 + 1];
    const p1x = pts[i1], p1y = pts[i1 + 1];
    const p2x = pts[i2], p2y = pts[i2 + 1];
    const p3x = pts[i3], p3y = pts[i3 + 1];

    for (let t = 0; t < segments; t++) {
      const f = t / segments;
      const f2 = f * f;
      const f3 = f2 * f;

      outX.push(0.5 * (
        2 * p1x + (-p0x + p2x) * f +
        (2 * p0x - 5 * p1x + 4 * p2x - p3x) * f2 +
        (-p0x + 3 * p1x - 3 * p2x + p3x) * f3
      ));
      outY.push(0.5 * (
        2 * p1y + (-p0y + p2y) * f +
        (2 * p0y - 5 * p1y + 4 * p2y - p3y) * f2 +
        (-p0y + 3 * p1y - 3 * p2y + p3y) * f3
      ));
    }
  }

  outX.push(pts[pts.length - 2]);
  outY.push(pts[pts.length - 1]);
}

/** Draw a variable-width calligraphic stroke using flat path arrays */
function drawCalligraphicStroke(
  ctx: CanvasRenderingContext2D,
  pathX: number[],
  pathY: number[],
  baseWidth: number,
  nibAngleRad: number,
  color: string,
  alpha: number,
  pressureVary: boolean,
) {
  const len = pathX.length;
  if (len < 2) return;

  // Build outline points inline
  const leftX: number[] = [], leftY: number[] = [];
  const rightX: number[] = [], rightY: number[] = [];

  const cosNib = Math.cos(nibAngleRad);
  const sinNib = Math.sin(nibAngleRad);

  for (let i = 0; i < len; i++) {
    // Tangent
    let dx: number, dy: number;
    if (i === 0) {
      dx = pathX[1] - pathX[0]; dy = pathY[1] - pathY[0];
    } else if (i === len - 1) {
      dx = pathX[i] - pathX[i - 1]; dy = pathY[i] - pathY[i - 1];
    } else {
      dx = pathX[i + 1] - pathX[i - 1]; dy = pathY[i + 1] - pathY[i - 1];
    }

    const invLen = 1 / (Math.sqrt(dx * dx + dy * dy) || 1);
    const ndx = dx * invLen, ndy = dy * invLen;

    // Calligraphic width: |sin(tangent - nib)|
    // sin(a-b) = sin(a)cos(b) - cos(a)sin(b)
    // tangent: ndy = sin(angle), ndx = cos(angle) (already normalized)
    const sinDiff = ndy * cosNib - ndx * sinNib;
    const widthFactor = 0.2 + 0.8 * Math.abs(sinDiff);

    // Optional velocity-based pressure: distance between consecutive points
    let pressureFactor = 1;
    if (pressureVary && i > 0 && i < len - 1) {
      const segDx = pathX[i] - pathX[i - 1], segDy = pathY[i] - pathY[i - 1];
      const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
      // Short segments (slow movement) = thick; long segments (fast) = thin
      pressureFactor = Math.max(0.4, Math.min(1.5, 3 / (segLen + 1)));
    }

    const halfW = baseWidth * widthFactor * pressureFactor * 0.5;

    // Taper at start and end
    const t = i / (len - 1);
    const taper = Math.min(1, Math.min(t * 5, (1 - t) * 5));
    const finalHalfW = halfW * taper;

    // Normal perpendicular to tangent: (-dy, dx) / len
    const nx = -dy * invLen, ny = dx * invLen;

    leftX.push(pathX[i] + nx * finalHalfW);
    leftY.push(pathY[i] + ny * finalHalfW);
    rightX.push(pathX[i] - nx * finalHalfW);
    rightY.push(pathY[i] - ny * finalHalfW);
  }

  ctx.beginPath();
  ctx.moveTo(leftX[0], leftY[0]);
  for (let i = 1; i < leftX.length; i++) ctx.lineTo(leftX[i], leftY[i]);
  for (let i = rightX.length - 1; i >= 0; i--) ctx.lineTo(rightX[i], rightY[i]);
  ctx.closePath();
  ctx.fillStyle = color.replace(/,[^,)]+\)$/, `,${alpha.toFixed(2)})`);
  ctx.fill();
}

// Fast parchment background: render noise at 1/8 resolution, scale up
function drawParchmentBackground(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  noise: SimplexNoise,
) {
  const scale = 8;
  const bw = (w / scale) | 0, bh = (h / scale) | 0;
  if (bw < 1 || bh < 1) return;
  const bgImg = ctx.createImageData(bw, bh);
  const bd = bgImg.data;

  for (let py = 0; py < bh; py++) {
    const sy = py * scale;
    for (let px = 0; px < bw; px++) {
      const sx = px * scale;
      const n = noise.noise2D(sx * 0.015, sy * 0.015) * 5;
      const base = 248 + n;
      const idx = (py * bw + px) * 4;
      bd[idx] = base; bd[idx + 1] = base - 3; bd[idx + 2] = base - 14; bd[idx + 3] = 255;
    }
  }

  const tmp = document.createElement('canvas');
  tmp.width = bw; tmp.height = bh;
  tmp.getContext('2d')!.putImageData(bgImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(tmp, 0, 0, w, h);
}

const parameterSchema: ParameterSchema = {
  lineCount: {
    name: 'Lines', type: 'number', min: 2, max: 12, step: 1, default: 5,
    help: 'Number of cursive lines',
    group: 'Composition',
  },
  complexity: {
    name: 'Complexity', type: 'number', min: 3, max: 20, step: 1, default: 10,
    help: 'Number of letter-forms per line',
    group: 'Composition',
  },
  strokeWidth: {
    name: 'Stroke Width', type: 'number', min: 1, max: 12, step: 0.5, default: 4,
    help: 'Base calligraphic stroke width',
    group: 'Geometry',
  },
  loopiness: {
    name: 'Loopiness', type: 'number', min: 0.2, max: 2.0, step: 0.1, default: 1.0,
    help: 'How dramatic the ascender/descender loops are',
    group: 'Geometry',
  },
  calligraphic: {
    name: 'Calligraphic', type: 'boolean', default: true,
    help: 'Enable thick-thin stroke variation like a nib pen',
    group: 'Texture',
  },
  inkPooling: {
    name: 'Ink Pooling', type: 'boolean', default: true,
    help: 'Add ink spots at stroke endpoints',
    group: 'Texture',
  },
  nibAngle: {
    name: 'Nib Angle', type: 'number', min: 0, max: 90, step: 5, default: 45,
    help: 'Pen nib angle in degrees (affects thick-thin distribution)',
    group: 'Texture',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 2.0, step: 0.1, default: 0.5,
    help: 'Animation writing speed',
    group: 'Flow/Motion',
  },
};

export const textProceduralCursive: Generator = {
  id: 'text-procedural-cursive',
  family: 'text',
  styleName: 'Procedural Cursive',
  definition: 'Flowing calligraphic cursive with variable-width nib strokes, ink pooling, and elegant loops',
  algorithmNotes:
    'Generates connected cursive letter-forms (10 archetypes with random variation) using Catmull-Rom splines. ' +
    'Calligraphic stroke width varies via broad-nib simulation (sin of angle between stroke and nib). ' +
    'Optional velocity-based pressure makes slow strokes thick and fast strokes thin. Ink pooling draws ' +
    'dark gradient spots at stroke endpoints. Color gradients flow along each line. Background uses ' +
    'downscaled noise for fast parchment texture.',
  parameterSchema,
  defaultParams: {
    lineCount: 5, complexity: 10, strokeWidth: 4, loopiness: 1.0,
    calligraphic: true, inkPooling: true, nibAngle: 45, speed: 0.5,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const lineCount = params.lineCount ?? 5;
    const complexity = params.complexity ?? 10;
    const strokeWidth = params.strokeWidth ?? 4;
    const loopiness = params.loopiness ?? 1.0;
    const calligraphic = params.calligraphic ?? true;
    const inkPooling = params.inkPooling ?? true;
    const nibAngle = (params.nibAngle ?? 45) * Math.PI / 180;
    const speed = params.speed ?? 0.5;

    // Fast parchment background
    drawParchmentBackground(ctx, w, h, noise);

    const paletteRgb = palette.colors.map(hexToRgb);
    const numColors = paletteRgb.length;

    const margin = w * 0.1;
    const lineSpacing = (h - margin * 2) / (lineCount + 1);
    const letterW = (w - margin * 2) / (complexity + 1);
    const letterH = lineSpacing * 0.35;

    // Animation: reveal strokes progressively
    const totalStrokes = lineCount * complexity;
    const revealCount = time > 0
      ? Math.min(totalStrokes, Math.floor(time * speed * 15))
      : totalStrokes;
    let strokesSoFar = 0;

    // Reusable arrays for spline output
    const splineX: number[] = [];
    const splineY: number[] = [];

    for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
      const baseY = margin + (lineIdx + 1) * lineSpacing;

      // Gradient color: interpolate between two palette colors along the line
      const c1 = paletteRgb[lineIdx % numColors];
      const c2 = paletteRgb[(lineIdx + 1) % numColors];

      // Build continuous path for the line — flat array
      const allPts: number[] = [];

      let lettersRendered = 0;
      for (let letterIdx = 0; letterIdx < complexity; letterIdx++) {
        if (strokesSoFar >= revealCount) break;
        strokesSoFar++;
        lettersRendered++;

        const baseX = margin + letterIdx * letterW;

        // Baseline wobble
        const yWobble = noise.noise2D(
          letterIdx * 0.3 + lineIdx * 5.1, seed * 0.01,
        ) * letterH * 0.2;

        const letterPts = generateLetterForm(
          rng,
          baseX,
          baseY + yWobble,
          letterW * (0.8 + rng.random() * 0.3),
          letterH * (0.8 + rng.random() * 0.4),
          loopiness,
        );

        // Smooth connection from previous letter
        if (allPts.length > 0) {
          const lastX = allPts[allPts.length - 2];
          const lastY = allPts[allPts.length - 1];
          allPts.push((lastX + letterPts[0]) / 2, (lastY + letterPts[1]) / 2);
        }

        // Append flat points
        for (let k = 0; k < letterPts.length; k++) allPts.push(letterPts[k]);
      }

      if (allPts.length < 4) continue; // need at least 2 points

      // Add opening swash before the line
      const swashPts: number[] = [
        allPts[0] - letterW * 0.6, allPts[1] + letterH * 0.4 * loopiness,
        allPts[0] - letterW * 0.4, allPts[1] - letterH * 0.5 * loopiness,
        allPts[0] - letterW * 0.15, allPts[1] + letterH * 0.1,
        allPts[0], allPts[1],
      ];

      // Smooth the main path
      splineX.length = 0;
      splineY.length = 0;
      catmullRomFlat(allPts, 8, splineX, splineY);

      // Color for this line (gradient midpoint)
      const t = lettersRendered / complexity;
      const [mr, mg, mb] = lerpRgb(c1, c2, t * 0.5);
      const mainColor = rgba(mr, mg, mb, 1);

      if (calligraphic) {
        drawCalligraphicStroke(ctx, splineX, splineY, strokeWidth, nibAngle, mainColor, 0.85, true);
      } else {
        ctx.beginPath();
        ctx.moveTo(splineX[0], splineY[0]);
        for (let i = 1; i < splineX.length; i++) ctx.lineTo(splineX[i], splineY[i]);
        ctx.strokeStyle = rgba(mr, mg, mb, 0.85);
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Opening swash
      const swashSpX: number[] = [], swashSpY: number[] = [];
      catmullRomFlat(swashPts, 8, swashSpX, swashSpY);
      if (calligraphic) {
        drawCalligraphicStroke(ctx, swashSpX, swashSpY, strokeWidth * 0.6, nibAngle, mainColor, 0.55, true);
      } else {
        ctx.beginPath();
        ctx.moveTo(swashSpX[0], swashSpY[0]);
        for (let i = 1; i < swashSpX.length; i++) ctx.lineTo(swashSpX[i], swashSpY[i]);
        ctx.strokeStyle = rgba(mr, mg, mb, 0.55);
        ctx.lineWidth = strokeWidth * 0.6;
        ctx.stroke();
      }

      // End flourish
      if (allPts.length > 4) {
        const lx = allPts[allPts.length - 2], ly = allPts[allPts.length - 1];
        const flourishPts: number[] = [
          lx, ly,
          lx + letterW * 0.4, ly - letterH * 0.4,
          lx + letterW * 0.8, ly + letterH * 0.3 * loopiness,
          lx + letterW * 0.6, ly + letterH * 0.6 * loopiness,
        ];
        const flX: number[] = [], flY: number[] = [];
        catmullRomFlat(flourishPts, 8, flX, flY);
        if (calligraphic) {
          drawCalligraphicStroke(ctx, flX, flY, strokeWidth * 0.55, nibAngle, mainColor, 0.5, true);
        } else {
          ctx.beginPath();
          ctx.moveTo(flX[0], flY[0]);
          for (let i = 1; i < flX.length; i++) ctx.lineTo(flX[i], flY[i]);
          ctx.strokeStyle = rgba(mr, mg, mb, 0.5);
          ctx.lineWidth = strokeWidth * 0.55;
          ctx.stroke();
        }
      }

      // Ink pooling: dark spots at stroke endpoints
      if (inkPooling && splineX.length > 0) {
        const poolRadius = strokeWidth * 0.8;
        const poolColor = rgba(mr, mg, mb, 0.3);

        // Start of line
        const g1 = ctx.createRadialGradient(splineX[0], splineY[0], 0, splineX[0], splineY[0], poolRadius);
        g1.addColorStop(0, rgba(mr, mg, mb, 0.5));
        g1.addColorStop(1, rgba(mr, mg, mb, 0));
        ctx.fillStyle = g1;
        ctx.beginPath();
        ctx.arc(splineX[0], splineY[0], poolRadius, 0, Math.PI * 2);
        ctx.fill();

        // End of line
        const ex = splineX[splineX.length - 1], ey = splineY[splineY.length - 1];
        const g2 = ctx.createRadialGradient(ex, ey, 0, ex, ey, poolRadius * 1.2);
        g2.addColorStop(0, rgba(mr, mg, mb, 0.55));
        g2.addColorStop(1, rgba(mr, mg, mb, 0));
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(ex, ey, poolRadius * 1.2, 0, Math.PI * 2);
        ctx.fill();

        // A few spots along the baseline at random intervals
        const spotRng = new SeededRNG(seed + lineIdx * 31);
        const spotCount = 2 + (complexity / 5) | 0;
        for (let s = 0; s < spotCount; s++) {
          const si = (spotRng.random() * (splineX.length - 1)) | 0;
          const sr = poolRadius * (0.3 + spotRng.random() * 0.5);
          const g = ctx.createRadialGradient(splineX[si], splineY[si], 0, splineX[si], splineY[si], sr);
          g.addColorStop(0, rgba(mr, mg, mb, 0.25));
          g.addColorStop(1, rgba(mr, mg, mb, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(splineX[si], splineY[si], sr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.floor((params.lineCount ?? 5) * (params.complexity ?? 10) * 15); },
};
