import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const GLYPH_SETS: Record<string, string[]> = {
  geometric: '◆◇○●□■△▽▲▼◎◈⬡⬢⬤⟐⟡⏣⏢⌬⌭'.split(''),
  arrows: '→←↑↓↗↘↙↖↺↻⇄⇅⇆⇈⇊⇋⇌⇍⇐⇒'.split(''),
  alchemical: '☉☽☿♀♁♂♃♄♅♆☊☋⚗⚘⚙⚚⚛⚜'.split(''),
  zodiac: '♈♉♊♋♌♍♎♏♐♑♒♓'.split(''),
  botanical: '❀❁❂❃❄❅❆❇❈❉❊❋✿✾✽✼❖'.split(''),
  celestial: '★☆✦✧✩✪✫✬✭✮✯✰✶✷✸✹⍟'.split(''),
  mixed: '◆○■△▽☉♀♂★☆✦❀❁❂⚛⚜→↗↺⬡⬢✿❖♃'.split(''),
};

const parameterSchema: ParameterSchema = {
  glyphSet: {
    name: 'Glyph Set', type: 'select',
    options: ['geometric', 'arrows', 'alchemical', 'zodiac', 'botanical', 'celestial', 'mixed'],
    default: 'mixed',
    help: 'Collection of Unicode symbols to display',
    group: 'Composition',
  },
  layout: {
    name: 'Layout', type: 'select',
    options: ['scattered', 'grid', 'orbital', 'cascade'],
    default: 'scattered',
    help: 'Arrangement pattern for glyphs',
    group: 'Composition',
  },
  count: {
    name: 'Count', type: 'number', min: 20, max: 400, step: 10, default: 120,
    help: 'Number of glyphs to render',
    group: 'Geometry',
  },
  sizeRange: {
    name: 'Size Range', type: 'number', min: 10, max: 120, step: 5, default: 45,
    help: 'Maximum glyph size in pixels',
    group: 'Geometry',
  },
  rotation: {
    name: 'Rotation', type: 'number', min: 0, max: 1, step: 0.1, default: 0.3,
    help: 'Amount of random rotation per glyph',
    group: 'Geometry',
  },
  glow: {
    name: 'Glow', type: 'boolean', default: true,
    help: 'Add soft glow behind glyphs',
    group: 'Texture',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 2.0, step: 0.1, default: 0.4,
    help: 'Animation drift speed',
    group: 'Flow/Motion',
  },
};

export const textGlyphs: Generator = {
  id: 'text-glyphs',
  family: 'text',
  styleName: 'Glyphs',
  definition: 'Artistic compositions of Unicode symbols — geometric, alchemical, celestial, and botanical glyphs',
  algorithmNotes:
    'Selects glyphs from themed Unicode collections and places them in grid, scattered, orbital, or cascade layouts. ' +
    'Each glyph is sized and rotated with noise-based variation. Palette colors are assigned by depth-sorted position. ' +
    'Optional glow effect adds luminous depth. Animation gently drifts glyph positions using simplex noise.',
  parameterSchema,
  defaultParams: {
    glyphSet: 'mixed', layout: 'scattered', count: 120, sizeRange: 45,
    rotation: 0.3, glow: true, speed: 0.4,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const glyphSetName = params.glyphSet ?? 'mixed';
    const layout = params.layout ?? 'scattered';
    const count = params.count ?? 120;
    const sizeRange = params.sizeRange ?? 45;
    const rotationAmount = params.rotation ?? 0.3;
    const showGlow = params.glow ?? true;
    const speed = params.speed ?? 0.4;

    const glyphs = GLYPH_SETS[glyphSetName] || GLYPH_SETS.mixed;

    // Dark background with subtle gradient
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, '#12101a');
    grad.addColorStop(1, '#06050a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    interface GlyphInstance {
      x: number; y: number; size: number; angle: number;
      char: string; colorIdx: number; depth: number;
    }

    const instances: GlyphInstance[] = [];
    const cx = w / 2, cy = h / 2;

    for (let i = 0; i < count; i++) {
      let x = 0, y = 0;
      const t = i / count;

      switch (layout) {
        case 'grid': {
          const cols = Math.ceil(Math.sqrt(count * w / h));
          const rows = Math.ceil(count / cols);
          const col = i % cols;
          const row = Math.floor(i / cols);
          const cellW = w / cols;
          const cellH = h / rows;
          x = (col + 0.5) * cellW + rng.range(-cellW * 0.2, cellW * 0.2);
          y = (row + 0.5) * cellH + rng.range(-cellH * 0.2, cellH * 0.2);
          break;
        }
        case 'orbital': {
          const rings = 5;
          const ring = Math.floor(t * rings);
          const posInRing = (t * rings) - ring;
          const r = (ring + 1) / rings * Math.min(w, h) * 0.42;
          const angle = posInRing * Math.PI * 2 + ring * 0.7;
          x = cx + Math.cos(angle) * r;
          y = cy + Math.sin(angle) * r;
          break;
        }
        case 'cascade': {
          const cols = Math.ceil(Math.sqrt(count));
          const col = i % cols;
          const row = Math.floor(i / cols);
          const totalRows = Math.ceil(count / cols);
          x = (col / cols) * w * 0.85 + w * 0.075;
          y = (row / totalRows) * h * 0.85 + h * 0.075 +
            Math.sin(col * 0.5 + row * 0.3) * h * 0.025;
          break;
        }
        default: { // scattered
          x = rng.range(w * 0.05, w * 0.95);
          y = rng.range(h * 0.05, h * 0.95);
          break;
        }
      }

      // Noise-based animation drift
      const nx = noise.noise2D(x / w * 3 + time * speed * 0.02, y / h * 3 + seed * 0.1);
      const ny = noise.noise2D(x / w * 3 + 100, y / h * 3 + time * speed * 0.015 + seed * 0.1);
      x += nx * 18 * speed;
      y += ny * 18 * speed;

      const depth = rng.random();
      const size = Math.max(8, sizeRange * (0.25 + 0.75 * depth));
      const angle = rotationAmount * (rng.random() - 0.5) * Math.PI * 2;

      instances.push({
        x, y, size, angle,
        char: rng.pick(glyphs),
        colorIdx: Math.floor(rng.random() * palette.colors.length),
        depth,
      });
    }

    // Sort by depth so larger/closer glyphs render on top
    instances.sort((a, b) => a.depth - b.depth);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const inst of instances) {
      const color = palette.colors[inst.colorIdx];
      const alpha = 0.35 + inst.depth * 0.6;

      ctx.save();
      ctx.translate(inst.x, inst.y);
      ctx.rotate(inst.angle + Math.sin(time * speed * 0.5 + inst.depth * 10) * 0.06);

      if (showGlow) {
        ctx.shadowColor = hexToRgba(color, 0.45);
        ctx.shadowBlur = inst.size * 0.5;
      }

      ctx.font = `${Math.round(inst.size)}px serif`;
      ctx.fillStyle = hexToRgba(color, alpha);
      ctx.fillText(inst.char, 0, 0);

      ctx.shadowBlur = 0;
      ctx.restore();
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.floor((params.count ?? 120) * 2); },
};
