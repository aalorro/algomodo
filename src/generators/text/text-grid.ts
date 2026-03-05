import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const CHAR_SETS: Record<string, string[]> = {
  blocks: '░▒▓█▄▀■□▪▫'.split(''),
  braille: '⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⡀⡁⡂⡃⡄⡅'.split(''),
  ascii: ' .:;+*#@%&'.split(''),
  digits: '0123456789'.split(''),
  custom: '◯◉◎●◐◑◒◓◔◕'.split(''),
};

const parameterSchema: ParameterSchema = {
  charSet: {
    name: 'Character Set', type: 'select', options: ['blocks', 'braille', 'ascii', 'digits', 'custom'],
    default: 'blocks', help: 'Which character set to use for the grid', group: 'Composition',
  },
  gridSize: {
    name: 'Grid Size', type: 'number', min: 8, max: 48, step: 2, default: 16,
    help: 'Size of each grid cell in pixels', group: 'Composition',
  },
  noiseScale: {
    name: 'Noise Scale', type: 'number', min: 1, max: 8, step: 0.5, default: 3,
    help: 'Scale of the simplex noise field', group: 'Geometry',
  },
  sizeVariation: {
    name: 'Size Variation', type: 'number', min: 0, max: 1, step: 0.05, default: 0.6,
    help: 'How much font size varies with noise (0 = uniform)', group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['noise', 'row', 'random'],
    default: 'noise', help: 'noise: color by noise value | row: color by row | random: per-cell random', group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.3,
    help: 'Animation speed for noise scrolling', group: 'Flow/Motion',
  },
};

export const textGrid: Generator = {
  id: 'text-grid',
  family: 'text',
  styleName: 'Typographic Grid',
  definition: 'Grid of characters where size, weight, and color are driven by simplex noise',
  algorithmNotes:
    'Divides the canvas into a grid. For each cell, simplex noise is sampled to determine which character ' +
    'to display, its font size, and its color. Higher noise values produce denser/larger characters. ' +
    'Animation scrolls the noise field over time, creating organic flowing texture.',
  parameterSchema,
  defaultParams: { charSet: 'blocks', gridSize: 16, noiseScale: 3, sizeVariation: 0.6, colorMode: 'noise', speed: 0.3 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const charSetName = params.charSet ?? 'blocks';
    const gridSize = params.gridSize ?? 16;
    const noiseScale = params.noiseScale ?? 3;
    const sizeVariation = params.sizeVariation ?? 0.6;
    const colorMode = params.colorMode ?? 'noise';
    const speed = params.speed ?? 0.3;

    const chars = CHAR_SETS[charSetName] ?? CHAR_SETS.blocks;
    const cols = Math.ceil(w / gridSize);
    const rows = Math.ceil(h / gridSize);

    // Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Time offset for animation
    const timeOffset = time * speed * 0.5;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const nx = col / cols * noiseScale;
        const ny = row / rows * noiseScale + timeOffset;

        // Noise value in [0, 1]
        const n = (noise.noise2D(nx, ny) + 1) * 0.5;

        // Character selection by noise
        const charIdx = Math.floor(n * (chars.length - 1));
        const char = chars[Math.min(charIdx, chars.length - 1)];

        // Font size variation
        const baseFontSize = gridSize * 0.85;
        const fontSize = Math.max(4, Math.round(baseFontSize * (1 - sizeVariation + sizeVariation * 2 * n)));

        // Color
        let color: string;
        if (colorMode === 'row') {
          const ci = row % palette.colors.length;
          color = palette.colors[ci];
        } else if (colorMode === 'random') {
          const ci = Math.floor(rng.random() * palette.colors.length);
          color = palette.colors[ci];
        } else {
          // noise-based color
          const ci = Math.floor(n * (palette.colors.length - 1));
          color = palette.colors[Math.min(ci, palette.colors.length - 1)];
        }

        // Alpha from noise — faint for low noise, bold for high
        const alpha = 0.2 + n * 0.8;

        const x = col * gridSize + gridSize / 2;
        const y = row * gridSize + gridSize / 2;

        ctx.font = `${fontSize}px monospace`;
        ctx.fillStyle = hexToRgba(color, alpha);
        ctx.fillText(char, x, y);
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const g = params.gridSize ?? 16;
    return Math.floor((1080 / g) * (1080 / g));
  },
};
