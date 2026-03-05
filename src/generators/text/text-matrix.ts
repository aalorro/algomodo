import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Katakana Unicode range subset
const KATAKANA = Array.from({ length: 96 }, (_, i) => String.fromCharCode(0x30A0 + i));
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
const DIGITS = '0123456789'.split('');

function getCharSet(name: string): string[] {
  switch (name) {
    case 'latin': return LATIN;
    case 'digits': return DIGITS;
    case 'mixed': return [...KATAKANA.slice(0, 48), ...LATIN];
    default: return KATAKANA;
  }
}

const parameterSchema: ParameterSchema = {
  customText: {
    name: 'Custom Text', type: 'text', default: '',
    placeholder: 'Enter text (leave empty for random)',
    maxLength: 200,
    help: 'Custom characters to rain — leave empty for random',
    group: 'Composition',
  },
  charSet: {
    name: 'Character Set', type: 'select', options: ['katakana', 'latin', 'digits', 'mixed'],
    default: 'katakana', help: 'Character set when custom text is empty', group: 'Composition',
  },
  columns: {
    name: 'Columns', type: 'number', min: 10, max: 80, step: 5, default: 40,
    help: 'Number of character columns', group: 'Composition',
  },
  dropSpeed: {
    name: 'Drop Speed', type: 'number', min: 1, max: 10, step: 1, default: 5,
    help: 'How fast characters fall', group: 'Flow/Motion',
  },
  trailLength: {
    name: 'Trail Length', type: 'number', min: 5, max: 30, step: 1, default: 15,
    help: 'Length of the fading trail behind each drop', group: 'Geometry',
  },
  brightness: {
    name: 'Brightness', type: 'number', min: 0.5, max: 1.5, step: 0.1, default: 1.0,
    help: 'Overall brightness multiplier', group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 1.0,
    help: 'Animation speed multiplier', group: 'Flow/Motion',
  },
};

export const textMatrix: Generator = {
  id: 'text-matrix',
  family: 'text',
  styleName: 'Digital Rain',
  definition: 'Matrix-style falling character columns with glow, fade, and palette coloring',
  algorithmNotes:
    'Creates a grid of character columns. Each column has an independent drop with a staggered start offset ' +
    'seeded by the RNG. The head character is brightest; trailing characters fade toward transparency. ' +
    'Characters are randomly selected from the chosen set and periodically refreshed for a shimmer effect. ' +
    'For static renders, a frozen snapshot with full trails is shown.',
  parameterSchema,
  defaultParams: { customText: '', charSet: 'katakana', columns: 40, dropSpeed: 5, trailLength: 15, brightness: 1.0, speed: 1.0 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const colors = palette.colors.map(hexToRgb);

    const charSetName = params.charSet ?? 'katakana';
    const numCols = params.columns ?? 40;
    const dropSpeed = params.dropSpeed ?? 5;
    const trailLength = params.trailLength ?? 15;
    const brightness = params.brightness ?? 1.0;
    const speed = params.speed ?? 1.0;

    const customText = (params.customText ?? '').trim();
    const chars = customText.length > 0
      ? customText.split('').filter((c: string) => c !== ' ')
      : getCharSet(charSetName);
    if (chars.length === 0) return;
    const cellW = w / numCols;
    const cellH = cellW * 1.2;
    const rows = Math.ceil(h / cellH) + trailLength;
    const fontSize = Math.max(8, Math.floor(cellW * 0.85));

    // Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Generate per-column data
    const colCharRng = new SeededRNG(seed + 1);

    for (let col = 0; col < numCols; col++) {
      const startOffset = rng.random() * rows * 2; // staggered start
      const colSpeed = dropSpeed * (0.7 + rng.random() * 0.6); // slight speed variation

      // Head position — cycles through rows
      const rawHead = startOffset + (time > 0 ? time * colSpeed * speed : colSpeed * 3);
      const totalCycle = rows + trailLength;
      const head = rawHead % totalCycle;

      const x = col * cellW + cellW / 2;

      // Select a palette color for this column
      const colColor = colors[col % colors.length];

      for (let row = 0; row < rows; row++) {
        const y = row * cellH + cellH / 2;
        if (y < -cellH || y > h + cellH) continue;

        // Distance from head
        let dist = head - row;
        if (dist < 0) dist += totalCycle;

        if (dist < 0 || dist > trailLength) continue;

        // Alpha fades from 1 (head) to 0 (tail)
        const alpha = Math.max(0, 1 - dist / trailLength) * brightness;
        if (alpha < 0.02) continue;

        // Character — seeded per cell, occasionally flicker
        const charSeed = col * 1000 + row + Math.floor(rawHead * 0.3);
        const charRng = new SeededRNG(charSeed);
        const char = chars[Math.floor(charRng.random() * chars.length)];

        // Head glow: head character is extra bright with highlight
        if (dist < 1) {
          const glow = Math.min(1, brightness * 1.2);
          ctx.fillStyle = `rgba(255,255,255,${glow})`;
          ctx.fillText(char, x, y);
        } else {
          const r = Math.min(255, Math.floor(colColor[0] * alpha));
          const g = Math.min(255, Math.floor(colColor[1] * alpha));
          const b = Math.min(255, Math.floor(colColor[2] * alpha));
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.fillText(char, x, y);
        }
      }
    }

    // Shimmer: redraw a few random characters brighter
    const shimmerRng = new SeededRNG(seed + Math.floor((time || 0) * 10));
    const shimmerCount = Math.floor(numCols * 0.3);
    for (let i = 0; i < shimmerCount; i++) {
      const col = Math.floor(colCharRng.random() * numCols);
      const row = Math.floor(shimmerRng.random() * Math.ceil(h / cellH));
      const x = col * cellW + cellW / 2;
      const y = row * cellH + cellH / 2;
      if (y > h) continue;
      const char = chars[Math.floor(shimmerRng.random() * chars.length)];
      const c = colors[col % colors.length];
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.15 * brightness})`;
      ctx.fillText(char, x, y);
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return (params.columns ?? 40) * 50; },
};
