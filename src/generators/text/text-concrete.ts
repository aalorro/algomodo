import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const WORDS = [
  'light', 'shadow', 'stone', 'river', 'wind', 'mirror', 'silence', 'fire',
  'glass', 'rain', 'dust', 'wave', 'root', 'cloud', 'thread', 'echo',
  'bloom', 'drift', 'void', 'pulse', 'orbit', 'fracture', 'whisper', 'glow',
];

const SYMBOLS = '!@#$%^&*()+=<>{}[]|~';

function getCharSet(source: string, rng: SeededRNG): string[] {
  switch (source) {
    case 'digits': return '0123456789'.split('');
    case 'symbols': return SYMBOLS.split('');
    case 'words': return rng.shuffle([...WORDS]).slice(0, 12);
    default: return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  }
}

interface PathPoint { x: number; y: number; angle: number; }

function generatePath(
  type: string, w: number, h: number, density: number, _seed: number
): PathPoint[] {
  const points: PathPoint[] = [];
  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(w, h) * 0.45;
  const count = Math.floor(300 * density);

  switch (type) {
    case 'circle': {
      const rings = Math.max(2, Math.floor(5 * density));
      for (let ring = 0; ring < rings; ring++) {
        const r = maxR * (0.2 + 0.8 * ring / (rings - 1));
        const n = Math.floor(count / rings);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, angle: a + Math.PI / 2 });
        }
      }
      break;
    }
    case 'wave': {
      const rows = Math.max(3, Math.floor(8 * density));
      const perRow = Math.floor(count / rows);
      for (let row = 0; row < rows; row++) {
        const yBase = h * 0.1 + (h * 0.8) * row / (rows - 1);
        for (let i = 0; i < perRow; i++) {
          const t = i / perRow;
          const x = w * 0.05 + t * w * 0.9;
          const waveY = Math.sin(t * Math.PI * 4 + row * 0.8) * (h * 0.04);
          const dy = Math.cos(t * Math.PI * 4 + row * 0.8) * Math.PI * 4 * (h * 0.04) / (w * 0.9);
          points.push({ x, y: yBase + waveY, angle: Math.atan(dy) });
        }
      }
      break;
    }
    case 'diagonal': {
      const lines = Math.max(3, Math.floor(10 * density));
      const perLine = Math.floor(count / lines);
      for (let line = 0; line < lines; line++) {
        const offset = (line - lines / 2) * (h * 0.12);
        for (let i = 0; i < perLine; i++) {
          const t = i / perLine;
          points.push({
            x: t * w,
            y: t * h + offset,
            angle: Math.atan2(h, w),
          });
        }
      }
      break;
    }
    case 'radial': {
      const arms = Math.max(4, Math.floor(8 * density));
      const perArm = Math.floor(count / arms);
      for (let arm = 0; arm < arms; arm++) {
        const baseAngle = (arm / arms) * Math.PI * 2;
        for (let i = 0; i < perArm; i++) {
          const t = i / perArm;
          const r = maxR * t;
          points.push({
            x: cx + Math.cos(baseAngle) * r,
            y: cy + Math.sin(baseAngle) * r,
            angle: baseAngle,
          });
        }
      }
      break;
    }
    default: { // spiral
      const turns = 3 + density * 2;
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const a = t * turns * Math.PI * 2;
        const r = maxR * t;
        points.push({
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          angle: a + Math.PI / 2,
        });
      }
      break;
    }
  }
  return points;
}

const parameterSchema: ParameterSchema = {
  customText: {
    name: 'Custom Text', type: 'text', default: '',
    placeholder: 'Enter text (leave empty for random)',
    maxLength: 200,
    help: 'Custom characters, words, or sentence — leave empty for random',
    group: 'Composition',
  },
  textSource: {
    name: 'Text Source', type: 'select', options: ['alphabet', 'digits', 'symbols', 'words'],
    default: 'alphabet', help: 'Character set when custom text is empty', group: 'Composition',
  },
  pathType: {
    name: 'Path Type', type: 'select', options: ['spiral', 'circle', 'wave', 'diagonal', 'radial'],
    default: 'spiral', help: 'Geometric path for text placement', group: 'Composition',
  },
  fontSize: {
    name: 'Font Size', type: 'number', min: 8, max: 72, step: 2, default: 24,
    help: 'Base font size in pixels', group: 'Geometry',
  },
  density: {
    name: 'Density', type: 'number', min: 0.2, max: 2.0, step: 0.1, default: 1.0,
    help: 'How many characters to place along the paths', group: 'Geometry',
  },
  letterSpacing: {
    name: 'Letter Spacing', type: 'number', min: 0.5, max: 3.0, step: 0.1, default: 1.2,
    help: 'Spacing multiplier between characters', group: 'Geometry',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation scroll speed', group: 'Flow/Motion',
  },
};

export const textConcrete: Generator = {
  id: 'text-concrete',
  family: 'text',
  styleName: 'Concrete Poetry',
  definition: 'Text flows along geometric paths — spiral, circle, wave, diagonal, or radial',
  algorithmNotes:
    'Characters from the selected set are placed at even intervals along parametric curves. ' +
    'Each character is rotated to follow the path tangent. Color is sampled from the palette based on ' +
    'position along the path. Animation scrolls characters by shifting the start offset.',
  parameterSchema,
  defaultParams: { customText: '', textSource: 'alphabet', pathType: 'spiral', fontSize: 24, density: 1.0, letterSpacing: 1.2, speed: 0.5 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);

    const textSource = params.textSource ?? 'alphabet';
    const pathType = params.pathType ?? 'spiral';
    const fontSize = params.fontSize ?? 24;
    const density = params.density ?? 1.0;
    const letterSpacing = params.letterSpacing ?? 1.2;
    const speed = params.speed ?? 0.5;

    const customText = (params.customText ?? '').trim();
    const chars = customText.length > 0
      ? (customText.includes(' ') ? customText.split(/\s+/) : customText.split(''))
      : getCharSet(textSource, rng);
    const isWords = textSource === 'words' || (customText.length > 0 && customText.includes(' '));

    // Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    const pathPoints = generatePath(pathType, w, h, density, seed);
    if (pathPoints.length === 0) return;

    // Animation offset: scroll characters along path
    const scrollOffset = time > 0 ? Math.floor(time * speed * 8) : 0;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const step = Math.max(1, Math.floor(letterSpacing * fontSize * 0.6 / Math.max(1, (w + h) / pathPoints.length)));

    for (let i = 0; i < pathPoints.length; i += Math.max(1, step)) {
      const pt = pathPoints[i];

      // Character selection with scroll offset
      const charIdx = (i + scrollOffset) % chars.length;
      const char = chars[charIdx];

      // Palette color by position
      const t = i / pathPoints.length;
      const ci = Math.floor(t * (palette.colors.length - 1));
      const color = palette.colors[Math.min(ci, palette.colors.length - 1)];

      const sizeVar = 0.7 + 0.6 * Math.sin(i * 0.1 + seed * 0.01);
      const fs = Math.round(fontSize * sizeVar);

      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(pt.angle);
      ctx.font = `${isWords ? 'italic ' : ''}${fs}px monospace`;
      ctx.fillStyle = hexToRgba(color, 0.85);
      ctx.fillText(char, 0, 0);
      ctx.restore();
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.floor((params.density ?? 1) * 300); },
};
