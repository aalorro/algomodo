import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

interface LSystem {
  axiom: string;
  rules: Record<string, string>;
}

const PRESETS: Record<string, LSystem> = {
  algae:     { axiom: 'A', rules: { A: 'AB', B: 'A' } },
  fibonacci: { axiom: 'A', rules: { A: 'B', B: 'BA' } },
  cantor:    { axiom: 'A', rules: { A: 'ABA', B: 'BBB' } },
  'thue-morse': { axiom: '0', rules: { '0': '01', '1': '10' } },
  dragon:    { axiom: 'X', rules: { X: 'X+YF+', Y: '-FX-Y' } },
  koch:      { axiom: 'F', rules: { F: 'F+F-F-F+F' } },
  binary:    { axiom: '1', rules: { '1': '12', '2': '21' } },
};

function rewrite(system: LSystem, iterations: number): string {
  let str = system.axiom;
  const maxLen = 50000;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const ch of str) {
      next += system.rules[ch] ?? ch;
      if (next.length > maxLen) break;
    }
    str = next;
    if (str.length > maxLen) { str = str.slice(0, maxLen); break; }
  }
  return str;
}

const parameterSchema: ParameterSchema = {
  preset: {
    name: 'Preset', type: 'select',
    options: ['algae', 'fibonacci', 'cantor', 'thue-morse', 'dragon', 'koch', 'binary'],
    default: 'algae', help: 'L-System rewriting rule preset', group: 'Composition',
  },
  iterations: {
    name: 'Iterations', type: 'number', min: 1, max: 8, step: 1, default: 5,
    help: 'Number of rewriting iterations (higher = longer string)', group: 'Composition',
  },
  fontSize: {
    name: 'Font Size', type: 'number', min: 6, max: 36, step: 2, default: 14,
    help: 'Base font size for characters', group: 'Geometry',
  },
  layout: {
    name: 'Layout', type: 'select', options: ['wrap', 'spiral', 'grid', 'cascade'],
    default: 'wrap', help: 'How the string is laid out on canvas', group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['symbol', 'generation', 'position'],
    default: 'symbol', help: 'symbol: color per unique char | generation: by depth | position: by location', group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    help: 'Animation reveal speed', group: 'Flow/Motion',
  },
  customText: {
    name: 'Custom Axiom', type: 'text', default: '',
    placeholder: 'Custom axiom string (leave empty for preset)',
    maxLength: 100,
    help: 'Override the preset axiom with your own starting string',
    group: 'Composition',
  },
};

export const textRewrite: Generator = {
  id: 'text-rewrite',
  family: 'text',
  styleName: 'L-System Text',
  definition: 'Lindenmayer string rewriting systems rendered as formatted text',
  algorithmNotes:
    'Starting from an axiom string, production rules are applied iteratively to grow the string exponentially. ' +
    'The resulting string is then rendered on canvas using one of several layout modes: wrap (flowing text), ' +
    'spiral (Archimedean spiral), grid (rows = generations), or cascade (centered growing lines). ' +
    'Color can be assigned per unique symbol, by generation depth, or by position in the string. ' +
    'Animation progressively reveals characters.',
  parameterSchema,
  defaultParams: { preset: 'algae', iterations: 5, fontSize: 14, layout: 'wrap', colorMode: 'symbol', speed: 0.5, customText: '' },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const _rng = new SeededRNG(seed);

    const presetName = params.preset ?? 'algae';
    const iterations = params.iterations ?? 5;
    const fontSize = params.fontSize ?? 14;
    const layout = params.layout ?? 'wrap';
    const colorMode = params.colorMode ?? 'symbol';
    const speed = params.speed ?? 0.5;

    const customText = (params.customText ?? '').trim();
    const baseSystem = PRESETS[presetName] ?? PRESETS.algae;
    // If custom axiom provided, override the preset's axiom
    const system = customText.length > 0
      ? { ...baseSystem, axiom: customText }
      : baseSystem;
    const fullStr = rewrite(system, iterations);

    // Animation: progressive reveal, cycling
    let visibleCount: number;
    if (time > 0) {
      const cycleDuration = Math.max(2, fullStr.length / (speed * 200));
      const phase = (time % cycleDuration) / cycleDuration;
      visibleCount = Math.max(1, Math.floor(phase * fullStr.length));
    } else {
      visibleCount = fullStr.length;
    }

    const str = fullStr.slice(0, visibleCount);

    // Build unique symbol → color map
    const uniqueChars = [...new Set(fullStr)];
    const symbolColors: Record<string, string> = {};
    uniqueChars.forEach((ch, i) => {
      symbolColors[ch] = palette.colors[i % palette.colors.length];
    });

    // Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const charW = fontSize * 0.65;
    const charH = fontSize * 1.3;

    switch (layout) {
      case 'spiral': {
        const cx = w / 2, cy = h / 2;
        const maxR = Math.min(w, h) * 0.45;
        const turns = 2 + str.length / 200;
        for (let i = 0; i < str.length; i++) {
          const t = i / Math.max(1, str.length - 1);
          const a = t * turns * Math.PI * 2;
          const r = maxR * t;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;

          if (x < -fontSize || x > w + fontSize || y < -fontSize || y > h + fontSize) continue;

          const color = getColor(i, str, colorMode, palette, symbolColors);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(a + Math.PI / 2);
          ctx.fillStyle = color;
          ctx.fillText(str[i], 0, 0);
          ctx.restore();
        }
        break;
      }
      case 'grid': {
        // Show generations as rows
        const generations: string[] = [];
        let current = system.axiom;
        generations.push(current);
        for (let i = 0; i < iterations; i++) {
          let next = '';
          for (const ch of current) {
            next += system.rules[ch] ?? ch;
            if (next.length > 5000) break;
          }
          current = next;
          generations.push(current);
        }

        const totalRows = generations.length;
        const rowH = Math.min(charH, h / totalRows);
        const yStart = (h - totalRows * rowH) / 2;

        for (let gi = 0; gi < totalRows; gi++) {
          const gen = generations[gi];
          const maxChars = Math.floor(w / Math.max(2, charW * 0.5));
          const shown = gen.slice(0, maxChars);
          const xStart = (w - shown.length * charW) / 2;

          // Progressive reveal for animation
          const genVisible = time > 0
            ? Math.min(shown.length, Math.floor(visibleCount * shown.length / fullStr.length))
            : shown.length;

          for (let ci = 0; ci < genVisible; ci++) {
            const x = xStart + ci * charW + charW / 2;
            const y = yStart + gi * rowH + rowH / 2;
            if (x < 0 || x > w) continue;

            let color: string;
            if (colorMode === 'generation') {
              color = palette.colors[gi % palette.colors.length];
            } else if (colorMode === 'symbol') {
              color = symbolColors[shown[ci]] ?? palette.colors[0];
            } else {
              color = palette.colors[Math.floor((ci / shown.length) * (palette.colors.length - 1))];
            }

            ctx.fillStyle = hexToRgba(color, 0.9);
            ctx.font = `${Math.round(rowH * 0.7)}px monospace`;
            ctx.fillText(shown[ci], x, y);
          }
        }
        break;
      }
      case 'cascade': {
        // Each generation centered, growing
        const generations: string[] = [];
        let current = system.axiom;
        generations.push(current);
        for (let i = 0; i < iterations; i++) {
          let next = '';
          for (const ch of current) {
            next += system.rules[ch] ?? ch;
            if (next.length > 2000) break;
          }
          current = next;
          generations.push(current);
        }

        const totalRows = generations.length;
        const rowH = Math.min(charH * 1.5, h / totalRows);
        const yStart = (h - totalRows * rowH) / 2;

        for (let gi = 0; gi < totalRows; gi++) {
          const gen = generations[gi];
          // Scale font to fit generation in canvas width
          const maxW = w * 0.9;
          const fs = Math.min(fontSize * 1.5, maxW / Math.max(1, gen.length) / 0.65);
          const cw = fs * 0.65;
          const xStart = (w - gen.length * cw) / 2;

          for (let ci = 0; ci < gen.length; ci++) {
            const x = xStart + ci * cw + cw / 2;
            const y = yStart + gi * rowH + rowH / 2;
            if (x < 0 || x > w) continue;

            const color = colorMode === 'generation'
              ? palette.colors[gi % palette.colors.length]
              : symbolColors[gen[ci]] ?? palette.colors[0];

            ctx.font = `${Math.round(fs)}px monospace`;
            ctx.fillStyle = hexToRgba(color, 0.9);
            ctx.fillText(gen[ci], x, y);
          }
        }
        break;
      }
      default: { // wrap
        const charsPerRow = Math.max(1, Math.floor((w * 0.9) / charW));
        const totalRows = Math.ceil(str.length / charsPerRow);
        const xStart = (w - charsPerRow * charW) / 2;
        const yStart = Math.max(charH / 2, (h - totalRows * charH) / 2);

        for (let i = 0; i < str.length; i++) {
          const row = Math.floor(i / charsPerRow);
          const col = i % charsPerRow;
          const x = xStart + col * charW + charW / 2;
          const y = yStart + row * charH + charH / 2;

          if (y > h + charH) break;

          const color = getColor(i, str, colorMode, palette, symbolColors);
          ctx.fillStyle = color;
          ctx.fillText(str[i], x, y);
        }
        break;
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const iters = params.iterations ?? 5;
    return Math.min(50000, Math.pow(3, iters)) | 0;
  },
};

function getColor(
  i: number, str: string, colorMode: string,
  palette: { colors: string[] }, symbolColors: Record<string, string>
): string {
  if (colorMode === 'symbol') {
    return hexToRgba(symbolColors[str[i]] ?? palette.colors[0], 0.9);
  } else if (colorMode === 'position') {
    const t = i / Math.max(1, str.length - 1);
    const ci = Math.floor(t * (palette.colors.length - 1));
    return hexToRgba(palette.colors[ci], 0.9);
  } else {
    // generation — approximate by log
    return hexToRgba(palette.colors[Math.floor(Math.log2(i + 1)) % palette.colors.length], 0.9);
  }
}
