import type { Generator, ParameterSchema, SVGPath } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(colors: [number, number, number][], t: number): string {
  const ci = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
  const f  = ci - i0;
  const r  = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
  const g  = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
  const b  = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Presets — axiom, production rules, default turn angle
// ---------------------------------------------------------------------------
const PRESETS: Record<string, { axiom: string; rules: Record<string, string>; angle: number }> = {
  Tree:      { axiom: 'X',     rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' },                          angle: 25  },
  Plant:     { axiom: 'F',     rules: { F: 'FF+[+F-F-F]-[-F+F+F]' },                                  angle: 22.5 },
  Dragon:    { axiom: 'FX',    rules: { X: 'X+YF+', Y: '-FX-Y' },                                     angle: 90  },
  Sierpinski:{ axiom: 'F-G-G', rules: { F: 'F-G+F+G-F', G: 'GG' },                                    angle: 120 },
  Hilbert:   { axiom: 'A',     rules: { A: '+BF-AFA-FB+', B: '-AF+BFB+FA-' },                         angle: 90  },
  Koch:      { axiom: 'F',     rules: { F: 'F+F--F+F' },                                               angle: 60  },
  Gosper:    { axiom: 'F',     rules: { F: 'F-G--G+F++FF+G-', G: '+F-GG--G-F++F+G' },                angle: 60  },
};

// ---------------------------------------------------------------------------
// String expansion
// ---------------------------------------------------------------------------
function expand(axiom: string, rules: Record<string, string>, iters: number): string {
  let s = axiom;
  for (let i = 0; i < iters; i++) {
    let next = '';
    for (const ch of s) next += rules[ch] ?? ch;
    s = next;
    if (s.length > 600_000) break;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Turtle interpretation
//   F, G = forward + draw
//   +/- = turn by angleDeg (±jitter if stochastic)
//   [/] = push/pop state; depth tracks bracket nesting
// ---------------------------------------------------------------------------
interface DrawLine { x1: number; y1: number; x2: number; y2: number; depth: number }

function interpret(
  str: string, stepLength: number, angleDeg: number, jitter: number, rng: SeededRNG,
): { lines: DrawLine[]; minX: number; minY: number; maxX: number; maxY: number } {
  const lines: DrawLine[] = [];
  const stack: { x: number; y: number; angle: number; depth: number }[] = [];
  let x = 0, y = 0, angle = -90, depth = 0;
  let minX = 0, minY = 0, maxX = 0, maxY = 0;

  for (const ch of str) {
    if (ch === 'F' || ch === 'G') {
      const rad = (angle * Math.PI) / 180;
      const nx = x + Math.cos(rad) * stepLength;
      const ny = y + Math.sin(rad) * stepLength;
      lines.push({ x1: x, y1: y, x2: nx, y2: ny, depth });
      x = nx; y = ny;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    } else if (ch === '+') {
      angle += angleDeg + (jitter > 0 ? (rng.random() - 0.5) * jitter * 2 : 0);
    } else if (ch === '-') {
      angle -= angleDeg + (jitter > 0 ? (rng.random() - 0.5) * jitter * 2 : 0);
    } else if (ch === '[') {
      stack.push({ x, y, angle, depth }); depth++;
    } else if (ch === ']') {
      const s = stack.pop();
      if (s) { x = s.x; y = s.y; angle = s.angle; depth = s.depth; }
    }
  }
  return { lines, minX, minY, maxX, maxY };
}

function computeTransform(
  minX: number, minY: number, maxX: number, maxY: number, W: number, H: number,
): { scale: number; ox: number; oy: number } {
  const pw = maxX - minX || 1, ph = maxY - minY || 1;
  const scale = Math.min((W * 0.9) / pw, (H * 0.9) / ph);
  return { scale, ox: (W - pw * scale) / 2 - minX * scale, oy: (H - ph * scale) / 2 - minY * scale };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  preset: {
    name: 'Preset',
    type: 'select',
    options: ['Tree', 'Plant', 'Dragon', 'Sierpinski', 'Hilbert', 'Koch', 'Gosper'],
    default: 'Tree',
    help: 'Tree/Plant: fractal branching | Dragon: space-filling dragon curve | Sierpinski: triangle fractal | Hilbert: space-filling square curve | Koch: snowflake edge | Gosper: flowsnake / peano curve',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations',
    type: 'number', min: 1, max: 8, step: 1, default: 5,
    help: 'String rewriting steps — each iteration multiplies detail; high values may be slow',
    group: 'Composition',
  },
  angle: {
    name: 'Angle',
    type: 'number', min: 5, max: 180, step: 1, default: 25,
    help: 'Turn angle in degrees — overrides preset default; deviating from the preset angle creates distorted/organic variants',
    group: 'Geometry',
  },
  stepLength: {
    name: 'Step Length',
    type: 'number', min: 1, max: 20, step: 1, default: 8,
    help: 'Length of each forward step before auto-scaling',
    group: 'Geometry',
  },
  stochastic: {
    name: 'Stochastic',
    type: 'number', min: 0, max: 20, step: 1, default: 0,
    help: 'Random angle jitter in degrees — adds seeded noise to each turn, making branches organically irregular. 0 = deterministic. 5–10 = natural plant variation. 15–20 = highly chaotic.',
    group: 'Geometry',
  },
  taper: {
    name: 'Taper Width',
    type: 'boolean', default: false,
    help: 'Scale line width by branch depth — trunk thick, tips thin; greatly improves tree and plant presets',
    group: 'Texture',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.5, max: 8, step: 0.5, default: 1,
    help: 'Base line width (trunk width when taper is on)',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['depth', 'gradient', 'single'],
    default: 'depth',
    help: 'depth: colour by branch nesting level — roots vs tips | gradient: colour sweeps through palette by drawing order | single: first palette colour only',
    group: 'Color',
  },
  revealSpeed: {
    name: 'Reveal Speed',
    type: 'number', min: 0.1, max: 5, step: 0.1, default: 1.0,
    help: 'Draw-reveal speed in animation mode — the curve progressively draws itself then cycles',
    group: 'Flow/Motion',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const lsystem: Generator = {
  id: 'lsystem',
  family: 'geometry',
  styleName: 'L-System',
  definition: 'Lindenmayer system: recursive string rewriting rendered as turtle graphics — seven presets from fractal trees to space-filling curves, with stochastic angle jitter and tapered branch widths',
  algorithmNotes:
    'Expands an axiom string with production rules N times (each step rewrites every character), then interprets: F/G=step forward+draw, +/-=turn by angle, [/]=push/pop turtle state. Branch depth tracked by bracket nesting. Stochastic mode adds seeded random noise to each turn angle, producing organically irregular variants. Taper mode scales line width by (1−depth/maxDepth)^0.7, giving trunk-to-tip thickness. Color modes: depth maps bracket-nesting level to the palette gradient; gradient maps drawing order; single uses one colour.',
  parameterSchema,
  defaultParams: { preset: 'Tree', iterations: 5, angle: 25, stepLength: 8, stochastic: 0, taper: false, lineWidth: 1, colorMode: 'depth', revealSpeed: 1.0 },
  supportsVector: true,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    clearCanvas(ctx, W, H, '#000000');

    const presetKey = (params.preset as string) || 'Tree';
    const preset    = PRESETS[presetKey] ?? PRESETS['Tree'];
    const angleDeg  = params.angle    ?? preset.angle;
    const iters     = Math.min((params.iterations ?? 5) | 0, 8);
    const step      = params.stepLength ?? 8;
    const jitter    = params.stochastic ?? 0;
    const taper     = params.taper     ?? false;
    const lineWidth = params.lineWidth  ?? 1;
    const colorMode = (params.colorMode as string) ?? 'depth';
    const rng       = new SeededRNG(seed);

    const str = expand(preset.axiom, preset.rules, iters);
    const { lines, minX, minY, maxX, maxY } = interpret(str, step, angleDeg, jitter, rng);
    if (lines.length === 0) return;

    const { scale, ox, oy } = computeTransform(minX, minY, maxX, maxY, W, H);

    let maxDepth = 0;
    for (const l of lines) if (l.depth > maxDepth) maxDepth = l.depth;

    const rgbColors = palette.colors.map(hexToRgb);

    // Progressive reveal in animation
    const revealSpeed  = params.revealSpeed ?? 1.0;
    const cycleDur     = 6 / revealSpeed;
    const cyclePhase   = time > 0 ? (time % cycleDur) / cycleDur : 1;
    const progress     = time > 0 ? (cyclePhase < 0.85 ? cyclePhase / 0.85 : 1) : 1;
    const numToDraw    = Math.floor(progress * lines.length);

    ctx.lineCap = 'round';

    for (let li = 0; li < numToDraw; li++) {
      const line = lines[li];

      // Taper: width decreases with depth
      const depthFactor = taper ? Math.max(0.12, Math.pow(1 - line.depth / (maxDepth + 1), 0.7)) : 1;
      ctx.lineWidth = lineWidth * depthFactor;

      // Color
      if (colorMode === 'depth') {
        ctx.strokeStyle = lerpColor(rgbColors, maxDepth > 0 ? line.depth / maxDepth : 0);
      } else if (colorMode === 'gradient') {
        ctx.strokeStyle = lerpColor(rgbColors, lines.length > 1 ? li / (lines.length - 1) : 0);
      } else {
        ctx.strokeStyle = palette.colors[0] || '#ffffff';
      }

      ctx.beginPath();
      ctx.moveTo(line.x1 * scale + ox, line.y1 * scale + oy);
      ctx.lineTo(line.x2 * scale + ox, line.y2 * scale + oy);
      ctx.stroke();
    }
  },

  renderVector(params, seed, palette): SVGPath[] {
    const presetKey = (params.preset as string) || 'Tree';
    const preset    = PRESETS[presetKey] ?? PRESETS['Tree'];
    const angleDeg  = params.angle    ?? preset.angle;
    const iters     = Math.min((params.iterations ?? 5) | 0, 7);
    const step      = params.stepLength ?? 8;
    const jitter    = params.stochastic ?? 0;
    const taper     = params.taper     ?? false;
    const lineWidth = params.lineWidth  ?? 1;
    const colorMode = (params.colorMode as string) ?? 'depth';
    const rng       = new SeededRNG(seed);

    const str = expand(preset.axiom, preset.rules, iters);
    const { lines, minX, minY, maxX, maxY } = interpret(str, step, angleDeg, jitter, rng);
    if (lines.length === 0) return [];

    const viewW = 1000, viewH = 1000;
    const { scale, ox, oy } = computeTransform(minX, minY, maxX, maxY, viewW, viewH);

    let maxDepth = 0;
    for (const l of lines) if (l.depth > maxDepth) maxDepth = l.depth;
    const rgbColors = palette.colors.map(hexToRgb);

    return lines.map((line, li) => {
      const depthFactor = taper ? Math.max(0.12, Math.pow(1 - line.depth / (maxDepth + 1), 0.7)) : 1;
      const sw = lineWidth * depthFactor;

      let color: string;
      if (colorMode === 'depth') {
        color = lerpColor(rgbColors, maxDepth > 0 ? line.depth / maxDepth : 0);
      } else if (colorMode === 'gradient') {
        color = lerpColor(rgbColors, lines.length > 1 ? li / (lines.length - 1) : 0);
      } else {
        color = palette.colors[0] || '#ffffff';
      }

      return {
        d: `M ${(line.x1 * scale + ox).toFixed(1)} ${(line.y1 * scale + oy).toFixed(1)} L ${(line.x2 * scale + ox).toFixed(1)} ${(line.y2 * scale + oy).toFixed(1)}`,
        stroke: color,
        strokeWidth: sw,
        fill: 'none',
      };
    });
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.pow(3, Math.min(params.iterations ?? 5, 8)) * 10; },
};
