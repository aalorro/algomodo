import type { Generator, Palette, ParameterSchema, SVGPath } from '../../types';
import { clearCanvas } from '../../renderers/canvas2d/utils';

const PRESETS: Record<string, { axiom: string; rules: Record<string, string>; angle: number }> = {
  Tree: {
    axiom: 'X',
    rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' },
    angle: 25,
  },
  Dragon: {
    axiom: 'FX',
    rules: { X: 'X+YF+', Y: '-FX-Y' },
    angle: 90,
  },
  Sierpinski: {
    axiom: 'F-G-G',
    rules: { F: 'F-G+F+G-F', G: 'GG' },
    angle: 120,
  },
  Hilbert: {
    axiom: 'A',
    rules: { A: '+BF-AFA-FB+', B: '-AF+BFB+FA-' },
    angle: 90,
  },
  Fern: {
    axiom: 'X',
    rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' },
    angle: 25,
  },
};

const parameterSchema: ParameterSchema = {
  preset: {
    name: 'Preset',
    type: 'select',
    options: ['Tree', 'Dragon', 'Sierpinski', 'Hilbert', 'Fern'],
    default: 'Tree',
    help: 'L-System preset to render',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations',
    type: 'number',
    min: 1,
    max: 8,
    step: 1,
    default: 5,
    help: 'Number of string rewriting steps',
    group: 'Composition',
  },
  angle: {
    name: 'Angle',
    type: 'number',
    min: 5,
    max: 180,
    step: 1,
    default: 25,
    help: 'Turn angle in degrees',
    group: 'Geometry',
  },
  stepLength: {
    name: 'Step Length',
    type: 'number',
    min: 1,
    max: 20,
    step: 1,
    default: 8,
    help: 'Length of each forward step',
    group: 'Geometry',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number',
    min: 0.5,
    max: 5,
    step: 0.5,
    default: 1,
    help: 'Width of drawn lines',
    group: 'Texture',
  },
  colorize: {
    name: 'Colorize',
    type: 'boolean',
    default: true,
    help: 'Color lines by recursion depth',
    group: 'Color',
  },
  revealSpeed: {
    name: 'Reveal Speed',
    type: 'number',
    min: 0.1,
    max: 5,
    step: 0.1,
    default: 1.0,
    help: 'How fast the drawing is revealed per cycle (animated only)',
    group: 'Flow/Motion',
  },
};

interface DrawLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  depth: number;
}

function expand(axiom: string, rules: Record<string, string>, iterations: number): string {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const ch of s) {
      next += rules[ch] ?? ch;
    }
    s = next;
    if (s.length > 600000) break;
  }
  return s;
}

function interpret(
  str: string,
  stepLength: number,
  angleDeg: number
): { lines: DrawLine[]; minX: number; minY: number; maxX: number; maxY: number } {
  const lines: DrawLine[] = [];
  const stack: { x: number; y: number; angle: number; depth: number }[] = [];
  let x = 0, y = 0, angle = -90; // pointing up
  let depth = 0;
  let minX = 0, minY = 0, maxX = 0, maxY = 0;

  for (const ch of str) {
    if (ch === 'F' || ch === 'G') {
      const rad = (angle * Math.PI) / 180;
      const nx = x + Math.cos(rad) * stepLength;
      const ny = y + Math.sin(rad) * stepLength;
      lines.push({ x1: x, y1: y, x2: nx, y2: ny, depth });
      x = nx;
      y = ny;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else if (ch === '+') {
      angle += angleDeg;
    } else if (ch === '-') {
      angle -= angleDeg;
    } else if (ch === '[') {
      stack.push({ x, y, angle, depth });
      depth++;
    } else if (ch === ']') {
      const s = stack.pop();
      if (s) { x = s.x; y = s.y; angle = s.angle; depth = s.depth; }
    }
  }

  return { lines, minX, minY, maxX, maxY };
}

function computeTransform(
  minX: number, minY: number, maxX: number, maxY: number,
  canvasW: number, canvasH: number
): { scale: number; ox: number; oy: number } {
  const pw = maxX - minX || 1;
  const ph = maxY - minY || 1;
  const scale = Math.min((canvasW * 0.9) / pw, (canvasH * 0.9) / ph);
  const ox = (canvasW - pw * scale) / 2 - minX * scale;
  const oy = (canvasH - ph * scale) / 2 - minY * scale;
  return { scale, ox, oy };
}

export const lsystem: Generator = {
  id: 'lsystem',
  family: 'geometry',
  styleName: 'L-System',
  definition: 'Lindenmayer system: string rewriting rendered as turtle graphics',
  algorithmNotes:
    'Expands axiom with production rules N times, then interprets F=forward, +/- =turn, [/]=push/pop state.',
  parameterSchema,
  defaultParams: {
    preset: 'Tree',
    iterations: 5,
    angle: 25,
    stepLength: 8,
    lineWidth: 1,
    colorize: true,
    revealSpeed: 1.0,
  },
  supportsVector: true,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    clearCanvas(ctx, width, height, '#000000');

    const presetKey = params.preset || 'Tree';
    const preset = PRESETS[presetKey] || PRESETS['Tree'];
    const angleDeg = params.angle ?? preset.angle;
    const iterations = Math.min(Math.floor(params.iterations ?? 5), 8);
    const step = params.stepLength || 8;

    const str = expand(preset.axiom, preset.rules, iterations);
    const { lines, minX, minY, maxX, maxY } = interpret(str, step, angleDeg);
    if (lines.length === 0) return;

    const { scale, ox, oy } = computeTransform(minX, minY, maxX, maxY, width, height);
    const maxDepth = Math.max(...lines.map(l => l.depth), 1);
    const colors = palette.colors;

    // Progressive reveal when animating: cycle every ~6 seconds / revealSpeed
    const revealSpeed = params.revealSpeed ?? 1.0;
    const cycleDuration = 6 / revealSpeed;
    const progress = time > 0
      ? Math.min(1, (time % cycleDuration) / (cycleDuration * 0.85))
      : 1; // static: show all
    const numToDraw = time > 0 ? Math.floor(progress * lines.length) : lines.length;

    ctx.lineWidth = params.lineWidth || 1;
    ctx.lineCap = 'round';

    for (let li = 0; li < numToDraw; li++) {
      const line = lines[li];
      if (params.colorize) {
        const t = maxDepth > 0 ? line.depth / maxDepth : 0;
        const ci = Math.floor(t * (colors.length - 1));
        ctx.strokeStyle = colors[Math.min(ci, colors.length - 1)] || '#ffffff';
      } else {
        ctx.strokeStyle = colors[0] || '#ffffff';
      }
      ctx.beginPath();
      ctx.moveTo(line.x1 * scale + ox, line.y1 * scale + oy);
      ctx.lineTo(line.x2 * scale + ox, line.y2 * scale + oy);
      ctx.stroke();
    }
  },

  renderVector(params, seed, palette): SVGPath[] {
    const presetKey = params.preset || 'Tree';
    const preset = PRESETS[presetKey] || PRESETS['Tree'];
    const angleDeg = params.angle ?? preset.angle;
    const iterations = Math.min(Math.floor(params.iterations ?? 5), 7); // cap lower for SVG
    const step = params.stepLength || 8;

    const str = expand(preset.axiom, preset.rules, iterations);
    const { lines, minX, minY, maxX, maxY } = interpret(str, step, angleDeg);
    if (lines.length === 0) return [];

    const viewW = 1000, viewH = 1000;
    const { scale, ox, oy } = computeTransform(minX, minY, maxX, maxY, viewW, viewH);
    const maxDepth = Math.max(...lines.map(l => l.depth), 1);
    const colors = palette.colors;

    return lines.map(line => {
      const t = maxDepth > 0 ? line.depth / maxDepth : 0;
      const ci = Math.floor(t * (colors.length - 1));
      const color = params.colorize
        ? (colors[Math.min(ci, colors.length - 1)] || '#ffffff')
        : (colors[0] || '#ffffff');

      return {
        d: `M ${(line.x1 * scale + ox).toFixed(2)} ${(line.y1 * scale + oy).toFixed(2)} L ${(line.x2 * scale + ox).toFixed(2)} ${(line.y2 * scale + oy).toFixed(2)}`,
        stroke: color,
        strokeWidth: params.lineWidth || 1,
        fill: 'none',
      };
    });
  },

  renderWebGL2(gl, params, seed, palette, quality) {
    const canvas = gl.canvas as HTMLCanvasElement;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d')!;
    this.renderCanvas2D!(ctx, params, seed, palette, quality);
  },

  estimateCost(params) {
    return Math.pow(3, Math.min(params.iterations, 8)) * 10;
  },
};
