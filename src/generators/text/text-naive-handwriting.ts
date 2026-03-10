import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const WORDS = [
  'hello', 'world', 'sun', 'moon', 'love', 'dream', 'star', 'rain',
  'hope', 'free', 'wind', 'song', 'bird', 'leaf', 'tree', 'wave',
  'sky', 'blue', 'red', 'joy', 'art', 'soul', 'flow', 'glow',
  'calm', 'wild', 'soft', 'warm', 'cool', 'deep', 'echo', 'mist',
];

const parameterSchema: ParameterSchema = {
  customText: {
    name: 'Custom Text', type: 'text', default: '',
    placeholder: 'Enter text (leave empty for random)',
    maxLength: 300,
    help: 'Text to render — leave empty for random words',
    group: 'Composition',
  },
  style: {
    name: 'Style', type: 'select',
    options: ['pencil', 'crayon', 'marker', 'chalk'],
    default: 'pencil',
    help: 'Drawing tool simulation',
    group: 'Texture',
  },
  lineCount: {
    name: 'Lines', type: 'number', min: 3, max: 15, step: 1, default: 7,
    help: 'Number of text lines',
    group: 'Composition',
  },
  wobble: {
    name: 'Wobble', type: 'number', min: 0.1, max: 2.0, step: 0.1, default: 0.8,
    help: 'How shaky the handwriting is',
    group: 'Geometry',
  },
  fontSize: {
    name: 'Font Size', type: 'number', min: 16, max: 80, step: 4, default: 36,
    help: 'Base character size',
    group: 'Geometry',
  },
  ruled: {
    name: 'Ruled Lines', type: 'boolean', default: true,
    help: 'Show notebook ruled lines',
    group: 'Composition',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 2.0, step: 0.1, default: 0.5,
    help: 'Animation reveal speed',
    group: 'Flow/Motion',
  },
};

export const textNaiveHandwriting: Generator = {
  id: 'text-naive-handwriting',
  family: 'text',
  styleName: 'Naive Handwriting',
  definition: 'Childlike handwriting with wobbly strokes, wandering baselines, and crayon textures',
  algorithmNotes:
    'Renders text character-by-character with noise-perturbed positions, rotations, and sizes to simulate ' +
    'a child\'s handwriting. Strokes are drawn in multiple passes with slight offsets for pencil, crayon, ' +
    'marker, or chalk texture effects. Baseline wanders using simplex noise. Optional ruled-line notebook ' +
    'background. Animation progressively reveals characters as if being written in real time.',
  parameterSchema,
  defaultParams: {
    customText: '', style: 'pencil', lineCount: 7, wobble: 0.8,
    fontSize: 36, ruled: true, speed: 0.5,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const style = params.style ?? 'pencil';
    const lineCount = params.lineCount ?? 7;
    const wobble = params.wobble ?? 0.8;
    const fontSize = params.fontSize ?? 36;
    const ruled = params.ruled ?? true;
    const speed = params.speed ?? 0.5;
    const customText = (params.customText ?? '').trim();

    // Paper background with noise texture
    const imgData = ctx.createImageData(w, h);
    const dd = imgData.data;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const n = noise.noise2D(px * 0.04, py * 0.04) * 6;
        const n2 = noise.noise2D(px * 0.15, py * 0.15) * 2;
        const base = style === 'chalk' ? 52 + n : 244 + n + n2;
        const idx = (py * w + px) * 4;
        if (style === 'chalk') {
          dd[idx] = base + 5;
          dd[idx + 1] = base + 8;
          dd[idx + 2] = base + 3;
        } else {
          dd[idx] = base;
          dd[idx + 1] = base - 4;
          dd[idx + 2] = base - 12;
        }
        dd[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Layout
    const margin = w * 0.08;
    const lineSpacing = (h - margin * 2) / (lineCount + 1);

    // Ruled lines
    if (ruled) {
      ctx.strokeStyle = style === 'chalk'
        ? 'rgba(80, 90, 100, 0.3)'
        : 'rgba(170, 195, 220, 0.45)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= lineCount; i++) {
        const y = margin + i * lineSpacing;
        ctx.beginPath();
        ctx.moveTo(margin, y);
        ctx.lineTo(w - margin, y);
        ctx.stroke();
      }
      // Red margin line
      if (style !== 'chalk') {
        ctx.strokeStyle = 'rgba(210, 110, 110, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(margin + fontSize * 1.5, margin);
        ctx.lineTo(margin + fontSize * 1.5, h - margin);
        ctx.stroke();
      }
    }

    // Generate text lines
    const lines: string[] = [];
    if (customText) {
      const words = customText.split(/\s+/);
      let currentLine = '';
      for (const word of words) {
        if (currentLine.length + word.length > 18) {
          lines.push(currentLine.trim());
          currentLine = word + ' ';
        } else {
          currentLine += word + ' ';
        }
      }
      if (currentLine.trim()) lines.push(currentLine.trim());
    } else {
      for (let i = 0; i < lineCount; i++) {
        const wordCount = rng.integer(2, 5);
        const lineWords: string[] = [];
        for (let j = 0; j < wordCount; j++) {
          lineWords.push(rng.pick(WORDS));
        }
        lines.push(lineWords.join(' '));
      }
    }

    // Animation: reveal characters progressively
    const totalChars = lines.reduce((sum, l) => sum + l.length, 0);
    const revealCount = time > 0 ? Math.min(totalChars, Math.floor(time * speed * 30)) : totalChars;
    let charsSoFar = 0;

    // Style configs
    const strokeConfigs: Record<string, { passes: number; opacity: number; spread: number; lineW: number }> = {
      crayon:  { passes: 5, opacity: 0.2,  spread: 3.5, lineW: 3.0 },
      marker:  { passes: 2, opacity: 0.65, spread: 1.0, lineW: 4.0 },
      chalk:   { passes: 6, opacity: 0.18, spread: 3.5, lineW: 2.5 },
      pencil:  { passes: 3, opacity: 0.35, spread: 1.2, lineW: 1.5 },
    };
    const sc = strokeConfigs[style] || strokeConfigs.pencil;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let lineIdx = 0; lineIdx < Math.min(lines.length, lineCount); lineIdx++) {
      const line = lines[lineIdx];
      const baseY = margin + (lineIdx + 1) * lineSpacing;
      let cursorX = margin + (ruled && style !== 'chalk' ? fontSize * 2 : fontSize * 0.5);

      const colorIdx = lineIdx % palette.colors.length;
      const color = palette.colors[colorIdx];

      for (let charIdx = 0; charIdx < line.length; charIdx++) {
        if (charsSoFar >= revealCount) return;
        charsSoFar++;

        const char = line[charIdx];
        if (char === ' ') {
          cursorX += fontSize * (0.3 + rng.random() * 0.2);
          continue;
        }

        // Wobble offsets from noise
        const wobbleX = noise.noise2D(charIdx * 0.5 + lineIdx * 3.7, seed * 0.1) * wobble * 8;
        const wobbleY = noise.noise2D(charIdx * 0.5 + 50, lineIdx * 3.7 + seed * 0.1) * wobble * 12;
        const wobbleAngle = noise.noise2D(charIdx * 0.3 + 100, lineIdx * 2.3) * wobble * 0.15;
        const sizeVar = 1.0 + noise.noise2D(charIdx * 0.4 + 200, lineIdx * 1.5) * wobble * 0.2;

        const x = cursorX + wobbleX;
        const y = baseY + wobbleY;
        const fs = Math.round(fontSize * sizeVar);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(wobbleAngle);

        // Multi-pass textured rendering
        for (let pass = 0; pass < sc.passes; pass++) {
          const ox = (rng.random() - 0.5) * sc.spread;
          const oy = (rng.random() - 0.5) * sc.spread;

          ctx.font = `${fs}px 'Comic Sans MS', 'Segoe Print', cursive`;
          ctx.fillStyle = hexToRgba(color, sc.opacity);
          ctx.fillText(char, ox, oy);

          // Chalk gets extra outline strokes for dusty texture
          if (style === 'chalk') {
            ctx.strokeStyle = hexToRgba(color, sc.opacity * 0.4);
            ctx.lineWidth = 0.5;
            ctx.strokeText(char, ox + rng.range(-1, 1), oy + rng.range(-1, 1));
          }
        }

        ctx.restore();

        // Advance cursor with variable spacing
        cursorX += fontSize * (0.5 + rng.random() * 0.2);
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.floor((params.lineCount ?? 7) * (params.fontSize ?? 36) * 2); },
};
