import type { Generator, ParameterSchema, Palette } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
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
    default: 'crayon',
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
  doodles: {
    name: 'Doodles', type: 'boolean', default: true,
    help: 'Draw small doodles and underlines',
    group: 'Texture',
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

// Fast paper background: render noise at 1/8 resolution, scale up via drawImage
function drawPaperBackground(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  noise: SimplexNoise,
  isChalk: boolean,
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
      const n = noise.noise2D(sx * 0.04, sy * 0.04) * 6;
      const base = isChalk ? 52 + n : 244 + n;
      const idx = (py * bw + px) * 4;
      if (isChalk) {
        bd[idx] = base + 5; bd[idx + 1] = base + 8; bd[idx + 2] = base + 3;
      } else {
        bd[idx] = base; bd[idx + 1] = base - 4; bd[idx + 2] = base - 12;
      }
      bd[idx + 3] = 255;
    }
  }

  // Use temporary canvas for bilinear upscale
  const tmp = document.createElement('canvas');
  tmp.width = bw; tmp.height = bh;
  tmp.getContext('2d')!.putImageData(bgImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(tmp, 0, 0, w, h);
}

// Draw a wobbly underline
function drawWobblyLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y: number, x2: number,
  color: string, noise: SimplexNoise, seed: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y);
  const steps = ((x2 - x1) / 8) | 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const nx = x1 + (x2 - x1) * t;
    const ny = y + noise.noise2D(nx * 0.05 + seed, seed * 0.3) * 4;
    ctx.lineTo(nx, ny);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Draw a small doodle (star, heart, spiral)
function drawDoodle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  type: number, color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  switch (type % 4) {
    case 0: { // star
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
        const r = size;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 1: { // circle
      ctx.beginPath();
      ctx.arc(cx, cy, size, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 2: { // zigzag
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const x = cx - size + i * size * 0.4;
        const y = cy + (i % 2 === 0 ? -size * 0.5 : size * 0.5);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case 3: { // spiral
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.3) {
        const r = (a / (Math.PI * 4)) * size;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
  }
}

export const textNaiveHandwriting: Generator = {
  id: 'text-naive-handwriting',
  family: 'text',
  styleName: 'Naive Handwriting',
  definition: 'Childlike handwriting with wobbly strokes, wandering baselines, doodles, and crayon textures',
  algorithmNotes:
    'Renders text character-by-character with noise-perturbed positions, rotations, and sizes to simulate ' +
    'a child\'s handwriting. Multiple rendering passes create pencil, crayon, marker, or chalk textures. ' +
    'Colors rotate per word. Optional margin doodles (stars, spirals, circles) and wobbly underlines add charm. ' +
    'Background rendered via downscaled noise for fast paper texture. Animation reveals characters progressively.',
  parameterSchema,
  defaultParams: {
    customText: '', style: 'crayon', lineCount: 7, wobble: 0.8,
    fontSize: 36, doodles: true, ruled: true, speed: 0.5,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const style = params.style ?? 'crayon';
    const lineCount = params.lineCount ?? 7;
    const wobble = params.wobble ?? 0.8;
    const fontSize = params.fontSize ?? 36;
    const doodles = params.doodles ?? true;
    const ruled = params.ruled ?? true;
    const speed = params.speed ?? 0.5;
    const customText = (params.customText ?? '').trim();
    const isChalk = style === 'chalk';

    // Fast paper background
    drawPaperBackground(ctx, w, h, noise, isChalk);

    // Layout
    const margin = w * 0.08;
    const lineSpacing = (h - margin * 2) / (lineCount + 1);

    // Ruled lines
    if (ruled) {
      ctx.strokeStyle = isChalk ? 'rgba(80,90,100,0.3)' : 'rgba(170,195,220,0.45)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= lineCount; i++) {
        const y = margin + i * lineSpacing;
        ctx.beginPath();
        ctx.moveTo(margin, y);
        ctx.lineTo(w - margin, y);
        ctx.stroke();
      }
      if (!isChalk) {
        ctx.strokeStyle = 'rgba(210,110,110,0.35)';
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

    // Pre-compute palette RGB
    const paletteRgb = palette.colors.map(hexToRgb);
    const numColors = paletteRgb.length;

    // Animation: reveal characters progressively
    const totalChars = lines.reduce((sum, l) => sum + l.length, 0);
    const revealCount = time > 0 ? Math.min(totalChars, Math.floor(time * speed * 30)) : totalChars;
    let charsSoFar = 0;

    // Style configs — reduced passes for speed while maintaining look
    const strokeConfigs: Record<string, { passes: number; opacity: number; spread: number }> = {
      pencil:  { passes: 2, opacity: 0.45, spread: 1.0 },
      crayon:  { passes: 3, opacity: 0.28, spread: 3.0 },
      marker:  { passes: 2, opacity: 0.7,  spread: 0.8 },
      chalk:   { passes: 4, opacity: 0.2,  spread: 3.0 },
    };
    const sc = strokeConfigs[style] || strokeConfigs.pencil;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Track word boundaries for underlines/color changes
    let wordColorIdx = 0;

    for (let lineIdx = 0; lineIdx < Math.min(lines.length, lineCount); lineIdx++) {
      const line = lines[lineIdx];
      const baseY = margin + (lineIdx + 1) * lineSpacing;
      let cursorX = margin + (ruled && !isChalk ? fontSize * 2 : fontSize * 0.5);

      // Set font once per line (all chars same base, size varies only ±20%)
      const baseFont = `${fontSize}px 'Comic Sans MS','Segoe Print',cursive`;
      ctx.font = baseFont;

      let wordStartX = cursorX;
      let inWord = false;
      const shouldUnderline = doodles && rng.random() < 0.2; // 20% chance per line
      const underlineWordIdx = rng.integer(0, 3);
      let currentWordInLine = 0;

      for (let charIdx = 0; charIdx < line.length; charIdx++) {
        if (charsSoFar >= revealCount) return;
        charsSoFar++;

        const char = line[charIdx];
        if (char === ' ') {
          // Track word boundary
          if (inWord) {
            // Maybe underline this word
            if (shouldUnderline && currentWordInLine === underlineWordIdx) {
              const [cr, cg, cb] = paletteRgb[wordColorIdx % numColors];
              drawWobblyLine(ctx, wordStartX, baseY + fontSize * 0.15, cursorX, rgba(cr, cg, cb, 0.5), noise, seed + lineIdx);
            }
            currentWordInLine++;
            wordColorIdx++;
            inWord = false;
          }
          cursorX += fontSize * (0.3 + rng.random() * 0.2);
          wordStartX = cursorX;
          continue;
        }

        if (!inWord) inWord = true;

        // Color per word
        const [cr, cg, cb] = paletteRgb[wordColorIdx % numColors];

        // Wobble offsets from noise
        const wobbleX = noise.noise2D(charIdx * 0.5 + lineIdx * 3.7, seed * 0.1) * wobble * 8;
        const wobbleY = noise.noise2D(charIdx * 0.5 + 50, lineIdx * 3.7 + seed * 0.1) * wobble * 12;
        const wobbleAngle = noise.noise2D(charIdx * 0.3 + 100, lineIdx * 2.3) * wobble * 0.15;
        const sizeVar = 1.0 + noise.noise2D(charIdx * 0.4 + 200, lineIdx * 1.5) * wobble * 0.2;

        const x = cursorX + wobbleX;
        const y = baseY + wobbleY;
        const fs = (fontSize * sizeVar + 0.5) | 0;

        // Only update font if size changed
        if (fs !== fontSize) {
          ctx.font = `${fs}px 'Comic Sans MS','Segoe Print',cursive`;
        }

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(wobbleAngle);

        // Multi-pass textured rendering
        const colorStr = rgba(cr, cg, cb, sc.opacity);
        ctx.fillStyle = colorStr;
        for (let pass = 0; pass < sc.passes; pass++) {
          const ox = (rng.random() - 0.5) * sc.spread;
          const oy = (rng.random() - 0.5) * sc.spread;
          ctx.fillText(char, ox, oy);
        }

        // Chalk outline
        if (isChalk) {
          ctx.strokeStyle = rgba(cr, cg, cb, sc.opacity * 0.3);
          ctx.lineWidth = 0.5;
          ctx.strokeText(char, rng.range(-0.5, 0.5), rng.range(-0.5, 0.5));
        }

        ctx.restore();

        // Restore base font if changed
        if (fs !== fontSize) {
          ctx.font = baseFont;
        }

        cursorX += fontSize * (0.5 + rng.random() * 0.2);
      }

      // Close last word
      if (inWord) {
        wordColorIdx++;
      }
    }

    // Draw doodles in margins
    if (doodles) {
      const doodleRng = new SeededRNG(seed + 999);
      const doodleCount = Math.min(lineCount, 4);
      for (let i = 0; i < doodleCount; i++) {
        const lineIdx = doodleRng.integer(0, lineCount - 1);
        const doodleY = margin + (lineIdx + 1) * lineSpacing - lineSpacing * 0.3;
        const doodleX = doodleRng.random() < 0.5
          ? margin * 0.5 // left margin
          : w - margin * 0.5; // right margin
        const doodleSize = fontSize * 0.3;
        const [dr, dg, db] = paletteRgb[doodleRng.integer(0, numColors - 1)];
        drawDoodle(ctx, doodleX, doodleY, doodleSize, doodleRng.integer(0, 3), rgba(dr, dg, db, 0.5));
      }
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.floor((params.lineCount ?? 7) * 50); },
};
