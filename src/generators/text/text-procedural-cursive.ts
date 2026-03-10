import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Generate a single cursive letter-form as control points */
function generateLetterForm(
  rng: SeededRNG,
  baseX: number,
  baseY: number,
  letterW: number,
  letterH: number,
  loopiness: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const form = rng.integer(0, 7);

  switch (form) {
    case 0: // hump (n-shape)
      pts.push({ x: baseX, y: baseY });
      pts.push({ x: baseX + letterW * 0.1, y: baseY - letterH * 0.8 });
      pts.push({ x: baseX + letterW * 0.5, y: baseY - letterH * 0.9 * loopiness });
      pts.push({ x: baseX + letterW * 0.7, y: baseY - letterH * 0.5 });
      pts.push({ x: baseX + letterW, y: baseY });
      break;
    case 1: // loop (o-shape)
      pts.push({ x: baseX, y: baseY });
      pts.push({ x: baseX + letterW * 0.2, y: baseY - letterH * 0.9 * loopiness });
      pts.push({ x: baseX + letterW * 0.8, y: baseY - letterH * 0.85 * loopiness });
      pts.push({ x: baseX + letterW * 0.85, y: baseY - letterH * 0.2 });
      pts.push({ x: baseX + letterW * 0.3, y: baseY + letterH * 0.1 });
      pts.push({ x: baseX + letterW, y: baseY });
      break;
    case 2: // ascender loop (l-shape)
      pts.push({ x: baseX, y: baseY });
      pts.push({ x: baseX + letterW * 0.3, y: baseY - letterH * 1.5 * loopiness });
      pts.push({ x: baseX + letterW * 0.6, y: baseY - letterH * 1.35 * loopiness });
      pts.push({ x: baseX + letterW * 0.4, y: baseY - letterH * 0.5 });
      pts.push({ x: baseX + letterW, y: baseY });
      break;
    case 3: // valley (u-shape)
      pts.push({ x: baseX, y: baseY });
      pts.push({ x: baseX + letterW * 0.1, y: baseY + letterH * 0.3 });
      pts.push({ x: baseX + letterW * 0.5, y: baseY + letterH * 0.5 * loopiness });
      pts.push({ x: baseX + letterW * 0.9, y: baseY + letterH * 0.2 });
      pts.push({ x: baseX + letterW, y: baseY });
      break;
    case 4: // descender loop (g-shape)
      pts.push({ x: baseX, y: baseY });
      pts.push({ x: baseX + letterW * 0.3, y: baseY - letterH * 0.6 });
      pts.push({ x: baseX + letterW * 0.7, y: baseY - letterH * 0.5 });
      pts.push({ x: baseX + letterW * 0.8, y: baseY + letterH * 0.3 });
      pts.push({ x: baseX + letterW * 0.5, y: baseY + letterH * 0.8 * loopiness });
      pts.push({ x: baseX + letterW * 0.3, y: baseY + letterH * 0.3 });
      pts.push({ x: baseX + letterW, y: baseY });
      break;
    case 5: // double valley (w-shape)
      pts.push({ x: baseX, y: baseY });
      pts.push({ x: baseX + letterW * 0.2, y: baseY + letterH * 0.4 * loopiness });
      pts.push({ x: baseX + letterW * 0.35, y: baseY - letterH * 0.2 });
      pts.push({ x: baseX + letterW * 0.55, y: baseY + letterH * 0.4 * loopiness });
      pts.push({ x: baseX + letterW * 0.75, y: baseY - letterH * 0.25 });
      pts.push({ x: baseX + letterW, y: baseY });
      break;
    case 6: // tall form (f-shape)
      pts.push({ x: baseX, y: baseY });
      pts.push({ x: baseX + letterW * 0.2, y: baseY - letterH * 1.2 * loopiness });
      pts.push({ x: baseX + letterW * 0.5, y: baseY - letterH * 1.25 * loopiness });
      pts.push({ x: baseX + letterW * 0.4, y: baseY - letterH * 0.3 });
      pts.push({ x: baseX + letterW * 0.7, y: baseY - letterH * 0.5 });
      pts.push({ x: baseX + letterW * 0.6, y: baseY });
      pts.push({ x: baseX + letterW, y: baseY });
      break;
    default: // small loop (e-shape)
      pts.push({ x: baseX, y: baseY });
      pts.push({ x: baseX + letterW * 0.4, y: baseY - letterH * 0.5 });
      pts.push({ x: baseX + letterW * 0.7, y: baseY - letterH * 0.6 * loopiness });
      pts.push({ x: baseX + letterW * 0.6, y: baseY - letterH * 0.3 });
      pts.push({ x: baseX + letterW * 0.3, y: baseY - letterH * 0.1 });
      pts.push({ x: baseX + letterW, y: baseY });
      break;
  }

  return pts;
}

/** Catmull-Rom spline interpolation through control points */
function catmullRom(
  points: { x: number; y: number }[],
  segments: number = 16,
): { x: number; y: number }[] {
  if (points.length < 2) return [...points];

  const result: { x: number; y: number }[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    for (let t = 0; t < segments; t++) {
      const f = t / segments;
      const f2 = f * f;
      const f3 = f2 * f;

      result.push({
        x: 0.5 * (
          (2 * p1.x) +
          (-p0.x + p2.x) * f +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3
        ),
        y: 0.5 * (
          (2 * p1.y) +
          (-p0.y + p2.y) * f +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3
        ),
      });
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

/** Draw a variable-width calligraphic stroke as a filled polygon */
function drawCalligraphicStroke(
  ctx: CanvasRenderingContext2D,
  path: { x: number; y: number }[],
  baseWidth: number,
  nibAngleRad: number,
  color: string,
  alpha: number,
) {
  if (path.length < 2) return;

  const leftEdge: { x: number; y: number }[] = [];
  const rightEdge: { x: number; y: number }[] = [];

  for (let i = 0; i < path.length; i++) {
    const p = path[i];

    // Tangent direction
    let dx: number, dy: number;
    if (i === 0) {
      dx = path[1].x - p.x;
      dy = path[1].y - p.y;
    } else if (i === path.length - 1) {
      dx = p.x - path[i - 1].x;
      dy = p.y - path[i - 1].y;
    } else {
      dx = path[i + 1].x - path[i - 1].x;
      dy = path[i + 1].y - path[i - 1].y;
    }

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const tangentAngle = Math.atan2(dy, dx);

    // Width varies with angle relative to nib
    const angleDiff = tangentAngle - nibAngleRad;
    const widthFactor = 0.25 + 0.75 * Math.abs(Math.sin(angleDiff));
    const halfW = baseWidth * widthFactor * 0.5;

    // Taper at start and end
    const t = i / (path.length - 1);
    const taper = Math.min(1, Math.min(t * 6, (1 - t) * 6));
    const finalHalfW = halfW * taper;

    // Normal perpendicular to tangent
    const nx = -dy / len;
    const ny = dx / len;

    leftEdge.push({ x: p.x + nx * finalHalfW, y: p.y + ny * finalHalfW });
    rightEdge.push({ x: p.x - nx * finalHalfW, y: p.y - ny * finalHalfW });
  }

  ctx.beginPath();
  ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
  for (let i = 1; i < leftEdge.length; i++) {
    ctx.lineTo(leftEdge[i].x, leftEdge[i].y);
  }
  for (let i = rightEdge.length - 1; i >= 0; i--) {
    ctx.lineTo(rightEdge[i].x, rightEdge[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = hexToRgba(color, alpha);
  ctx.fill();
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
  definition: 'Flowing calligraphic cursive with variable-width nib strokes and elegant loops',
  algorithmNotes:
    'Generates connected cursive letter-forms using Catmull-Rom splines through procedurally placed control points. ' +
    'Each letter-form is an archetype (humps, loops, ascenders, descenders) with randomized proportions. ' +
    'Calligraphic stroke variation simulates a broad-nib pen by varying width based on stroke angle relative to the nib. ' +
    'Strokes taper at entry and exit points. Animation reveals lines progressively as if being written.',
  parameterSchema,
  defaultParams: {
    lineCount: 5, complexity: 10, strokeWidth: 4, loopiness: 1.0,
    calligraphic: true, nibAngle: 45, speed: 0.5,
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
    const nibAngle = (params.nibAngle ?? 45) * Math.PI / 180;
    const speed = params.speed ?? 0.5;

    // Warm parchment background with noise texture
    const imgData = ctx.createImageData(w, h);
    const dd = imgData.data;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const n = noise.noise2D(px * 0.015, py * 0.015) * 5;
        const n2 = noise.noise2D(px * 0.08, py * 0.08) * 3;
        const base = 248 + n + n2;
        const idx = (py * w + px) * 4;
        dd[idx] = base;
        dd[idx + 1] = base - 3;
        dd[idx + 2] = base - 14;
        dd[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

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

    for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
      const baseY = margin + (lineIdx + 1) * lineSpacing;
      const colorIdx = lineIdx % palette.colors.length;
      const color = palette.colors[colorIdx];

      // Build continuous path for the line
      const allPoints: { x: number; y: number }[] = [];

      for (let letterIdx = 0; letterIdx < complexity; letterIdx++) {
        if (strokesSoFar >= revealCount) break;
        strokesSoFar++;

        const baseX = margin + letterIdx * letterW;

        // Baseline wobble
        const yWobble = noise.noise2D(
          letterIdx * 0.3 + lineIdx * 5.1, seed * 0.01,
        ) * letterH * 0.2;

        const letterPoints = generateLetterForm(
          rng,
          baseX,
          baseY + yWobble,
          letterW * (0.8 + rng.random() * 0.3),
          letterH * (0.8 + rng.random() * 0.4),
          loopiness,
        );

        // Smooth connection from previous letter
        if (allPoints.length > 0) {
          const lastPt = allPoints[allPoints.length - 1];
          const firstPt = letterPoints[0];
          allPoints.push({
            x: (lastPt.x + firstPt.x) / 2,
            y: (lastPt.y + firstPt.y) / 2,
          });
        }

        allPoints.push(...letterPoints);
      }

      if (allPoints.length < 2) continue;

      // Smooth the path
      const smoothPath = catmullRom(allPoints, 12);

      if (calligraphic) {
        drawCalligraphicStroke(ctx, smoothPath, strokeWidth, nibAngle, color, 0.85);
      } else {
        ctx.beginPath();
        ctx.moveTo(smoothPath[0].x, smoothPath[0].y);
        for (let i = 1; i < smoothPath.length; i++) {
          ctx.lineTo(smoothPath[i].x, smoothPath[i].y);
        }
        ctx.strokeStyle = hexToRgba(color, 0.85);
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Decorative flourish at the end of the line
      if (strokesSoFar > 0 && allPoints.length > 2) {
        const lastPt = allPoints[allPoints.length - 1];
        const flourish = [
          lastPt,
          { x: lastPt.x + letterW * 0.4, y: lastPt.y - letterH * 0.35 },
          { x: lastPt.x + letterW * 0.7, y: lastPt.y + letterH * 0.25 * loopiness },
          { x: lastPt.x + letterW * 0.5, y: lastPt.y + letterH * 0.45 * loopiness },
        ];
        const flourishSmooth = catmullRom(flourish, 10);
        if (calligraphic) {
          drawCalligraphicStroke(ctx, flourishSmooth, strokeWidth * 0.65, nibAngle, color, 0.55);
        } else {
          ctx.beginPath();
          ctx.moveTo(flourishSmooth[0].x, flourishSmooth[0].y);
          for (let i = 1; i < flourishSmooth.length; i++) {
            ctx.lineTo(flourishSmooth[i].x, flourishSmooth[i].y);
          }
          ctx.strokeStyle = hexToRgba(color, 0.55);
          ctx.lineWidth = strokeWidth * 0.65;
          ctx.stroke();
        }
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.floor((params.lineCount ?? 5) * (params.complexity ?? 10) * 20); },
};
