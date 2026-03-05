import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const NOUNS = [
  'light', 'shadow', 'stone', 'river', 'wind', 'mirror', 'silence', 'fire',
  'glass', 'rain', 'dust', 'wave', 'root', 'cloud', 'thread', 'echo',
  'moon', 'frost', 'tide', 'ember', 'void', 'bloom', 'ash', 'bone',
  'mist', 'iron', 'salt', 'seed', 'ink', 'pearl', 'moss', 'crystal',
];

const VERBS = [
  'falls', 'breaks', 'turns', 'folds', 'drifts', 'echoes', 'blooms', 'dissolves',
  'weaves', 'trembles', 'rises', 'shatters', 'whispers', 'bends', 'gathers', 'fades',
  'spills', 'returns', 'splits', 'unfolds', 'lingers', 'erodes', 'spirals', 'glows',
];

const ADJECTIVES = [
  'hollow', 'bright', 'still', 'slow', 'thin', 'deep', 'cold', 'soft',
  'sharp', 'faint', 'pale', 'dark', 'bare', 'wild', 'quiet', 'heavy',
  'ancient', 'fragile', 'endless', 'sudden', 'distant', 'burning', 'frozen', 'secret',
];

const PREPOSITIONS = [
  'beneath', 'above', 'within', 'beyond', 'against', 'through', 'along', 'between',
  'upon', 'across', 'toward', 'inside', 'outside', 'under', 'over', 'among',
];

function generateHaiku(rng: SeededRNG): string[] {
  // Simplified syllable approximation: short words ≈ 1-2 syllables
  const pick = (arr: string[]) => arr[Math.floor(rng.random() * arr.length)];

  const lines: string[] = [];

  // Line 1: ~5 syllables — adj + noun (2+1 or 2+2 ≈ 3-4, close enough for art)
  lines.push(`${pick(ADJECTIVES)} ${pick(NOUNS)}`);

  // Line 2: ~7 syllables — noun + verb + prep + noun
  lines.push(`${pick(NOUNS)} ${pick(VERBS)} ${pick(PREPOSITIONS)} ${pick(NOUNS)}`);

  // Line 3: ~5 syllables — adj + noun + verb
  lines.push(`${pick(ADJECTIVES)} ${pick(NOUNS)} ${pick(VERBS)}`);

  return lines;
}

function generateMinimal(rng: SeededRNG): string[] {
  const pick = (arr: string[]) => arr[Math.floor(rng.random() * arr.length)];
  const count = 1 + Math.floor(rng.random() * 3);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const pattern = Math.floor(rng.random() * 4);
    switch (pattern) {
      case 0: lines.push(`${pick(NOUNS)}.`); break;
      case 1: lines.push(`${pick(ADJECTIVES)} ${pick(NOUNS)}`); break;
      case 2: lines.push(`${pick(VERBS)}`); break;
      default: lines.push(`${pick(PREPOSITIONS)} ${pick(NOUNS)}`); break;
    }
  }
  return lines;
}

function generateManifesto(rng: SeededRNG): string[] {
  const pick = (arr: string[]) => arr[Math.floor(rng.random() * arr.length)];
  const lines: string[] = [];
  const lineCount = 4 + Math.floor(rng.random() * 4);
  for (let i = 0; i < lineCount; i++) {
    const pattern = Math.floor(rng.random() * 5);
    switch (pattern) {
      case 0: lines.push(`WE ARE THE ${pick(NOUNS).toUpperCase()}.`); break;
      case 1: lines.push(`${pick(ADJECTIVES)} ${pick(NOUNS)} ${pick(VERBS)} ${pick(PREPOSITIONS)} ${pick(NOUNS)}!`); break;
      case 2: lines.push(`NO MORE ${pick(ADJECTIVES)} ${pick(NOUNS)}.`); break;
      case 3: lines.push(`LET ${pick(NOUNS)} ${pick(VERBS)}.`); break;
      default: lines.push(`${pick(PREPOSITIONS).toUpperCase()} THE ${pick(NOUNS)} —`); break;
    }
  }
  return lines;
}

function generateConcrete(rng: SeededRNG): string[] {
  const pick = (arr: string[]) => arr[Math.floor(rng.random() * arr.length)];
  // Words arranged to form a shape — we'll generate them and mark with spacing
  const lines: string[] = [];
  const height = 7 + Math.floor(rng.random() * 6);
  const word = pick(NOUNS);
  for (let i = 0; i < height; i++) {
    const t = i / (height - 1);
    // Diamond shape
    const width = Math.round(t < 0.5 ? t * 2 * 8 + 1 : (1 - t) * 2 * 8 + 1);
    const padding = Math.round((8 - width / 2));
    const repeated = (word + ' ').repeat(Math.ceil(width / (word.length + 1))).slice(0, Math.max(1, width * 2));
    lines.push(' '.repeat(Math.max(0, padding)) + repeated);
  }
  return lines;
}

const parameterSchema: ParameterSchema = {
  style: {
    name: 'Style', type: 'select', options: ['haiku', 'concrete', 'minimal', 'manifesto'],
    default: 'haiku', help: 'Poetry style template', group: 'Composition',
  },
  fontScale: {
    name: 'Font Scale', type: 'number', min: 0.5, max: 2.0, step: 0.1, default: 1.0,
    help: 'Scale factor for font size', group: 'Geometry',
  },
  alignment: {
    name: 'Alignment', type: 'select', options: ['left', 'center', 'justified', 'scattered'],
    default: 'center', help: 'Text alignment mode', group: 'Geometry',
  },
  lineSpacing: {
    name: 'Line Spacing', type: 'number', min: 1.0, max: 3.0, step: 0.1, default: 1.8,
    help: 'Vertical spacing between lines', group: 'Geometry',
  },
  textContrast: {
    name: 'Text Contrast', type: 'number', min: 0.3, max: 1.0, step: 0.05, default: 0.85,
    help: 'Opacity of the text', group: 'Color',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.3,
    help: 'Typewriter animation speed', group: 'Flow/Motion',
  },
};

export const textPoem: Generator = {
  id: 'text-poem',
  family: 'text',
  styleName: 'Poem Layout',
  definition: 'Rule-based poetry generator with beautiful typographic layout',
  algorithmNotes:
    'Procedurally generates poems using word banks (nouns, verbs, adjectives, prepositions) and ' +
    'style-specific composition rules. Haiku follows a 3-line nature-themed structure. Concrete arranges ' +
    'words into visual shapes. Minimal uses sparse phrasing with large whitespace. Manifesto produces ' +
    'bold declarations with mixed sizes. Animation reveals text character by character.',
  parameterSchema,
  defaultParams: { style: 'haiku', fontScale: 1.0, alignment: 'center', lineSpacing: 1.8, textContrast: 0.85, speed: 0.3 },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);

    const style = params.style ?? 'haiku';
    const fontScale = params.fontScale ?? 1.0;
    const alignment = params.alignment ?? 'center';
    const lineSpacing = params.lineSpacing ?? 1.8;
    const textContrast = params.textContrast ?? 0.85;
    const speed = params.speed ?? 0.3;

    // Generate poem lines
    let lines: string[];
    switch (style) {
      case 'concrete': lines = generateConcrete(rng); break;
      case 'minimal': lines = generateMinimal(rng); break;
      case 'manifesto': lines = generateManifesto(rng); break;
      default: lines = generateHaiku(rng); break;
    }

    // Background
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    // Font sizes by style
    let baseFontSize: number;
    switch (style) {
      case 'minimal': baseFontSize = w * 0.06; break;
      case 'manifesto': baseFontSize = w * 0.035; break;
      case 'concrete': baseFontSize = w * 0.02; break;
      default: baseFontSize = w * 0.04; break;
    }
    baseFontSize *= fontScale;

    const lineH = baseFontSize * lineSpacing;
    const totalTextH = lines.length * lineH;
    const startY = (h - totalTextH) / 2 + lineH / 2;

    // Typewriter animation: total chars revealed
    const totalChars = lines.reduce((sum, l) => sum + l.length, 0);
    let revealedChars: number;
    if (time > 0) {
      const cycleDuration = Math.max(3, totalChars / (speed * 15));
      const phase = (time % (cycleDuration * 1.5)) / cycleDuration; // 1.5x for pause at end
      revealedChars = Math.floor(Math.min(1, phase) * totalChars);
    } else {
      revealedChars = totalChars;
    }

    let charsShown = 0;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const y = startY + li * lineH;

      // How many chars of this line to show
      const lineCharsToShow = Math.max(0, Math.min(line.length, revealedChars - charsShown));
      charsShown += line.length;

      if (lineCharsToShow === 0) continue;
      const visibleLine = line.slice(0, lineCharsToShow);

      // Font — manifesto uses mixed bold
      const isBold = style === 'manifesto' && li % 2 === 0;
      const isItalic = style === 'haiku';
      const fontWeight = isBold ? 'bold ' : '';
      const fontStyle = isItalic ? 'italic ' : '';

      // Per-line font size variation for manifesto
      let fs = baseFontSize;
      if (style === 'manifesto') {
        fs = baseFontSize * (0.8 + (li % 3) * 0.3);
      }

      ctx.font = `${fontStyle}${fontWeight}${Math.round(fs)}px serif`;

      // Color — alternate palette colors per line
      const colorIdx = li % palette.colors.length;
      const color = palette.colors[colorIdx];

      // Alignment
      if (alignment === 'scattered') {
        // Scatter each word at a random-ish position
        const words = visibleLine.split(' ').filter(w => w.length > 0);
        for (let wi = 0; wi < words.length; wi++) {
          const wordRng = new SeededRNG(seed + li * 100 + wi);
          const wx = w * 0.1 + wordRng.random() * w * 0.8;
          const wy = y + (wordRng.random() - 0.5) * lineH * 0.5;
          ctx.textAlign = 'center';
          ctx.fillStyle = hexToRgba(palette.colors[(li + wi) % palette.colors.length], textContrast);
          ctx.fillText(words[wi], wx, wy);
        }
      } else {
        ctx.textAlign = alignment === 'left' ? 'left' : 'center';
        const x = alignment === 'left' ? w * 0.1 : w / 2;

        ctx.fillStyle = hexToRgba(color, textContrast);
        ctx.fillText(visibleLine, x, y);

        // Accent: highlight last word brighter
        if (lineCharsToShow === line.length && line.includes(' ')) {
          const lastSpace = line.lastIndexOf(' ');
          const lastWord = line.slice(lastSpace + 1);
          const beforeLast = line.slice(0, lastSpace + 1);

          if (lastWord.length > 0) {
            const accentColor = palette.colors[(colorIdx + 1) % palette.colors.length];
            const beforeWidth = ctx.measureText(beforeLast).width;

            if (alignment === 'left') {
              ctx.fillStyle = hexToRgba(accentColor, Math.min(1, textContrast + 0.15));
              ctx.fillText(lastWord, w * 0.1 + beforeWidth, y);
            } else if (alignment === 'center') {
              const fullWidth = ctx.measureText(line).width;
              ctx.fillStyle = hexToRgba(accentColor, Math.min(1, textContrast + 0.15));
              ctx.fillText(lastWord, w / 2 - fullWidth / 2 + beforeWidth + ctx.measureText(lastWord).width / 2, y);
            }
          }
        }
      }
    }

    // For concrete style, add a subtle title at bottom
    if (style === 'concrete') {
      ctx.font = `italic ${Math.round(baseFontSize * 0.7)}px serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = hexToRgba(palette.colors[0], textContrast * 0.5);
      // Pick a word the poem is about
      const titleRng = new SeededRNG(seed + 999);
      ctx.fillText(`— ${NOUNS[Math.floor(titleRng.random() * NOUNS.length)]} —`, w / 2, h * 0.92);
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost() { return 50; },
};
