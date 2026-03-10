import type { Generator, ParameterSchema, Palette } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const GLYPH_SETS: Record<string, string[]> = {
  geometric: '◆◇○●□■△▽▲▼◎◈⬡⬢⬤⟐⟡⏣⏢⌬⌭'.split(''),
  arrows:    '→←↑↓↗↘↙↖↺↻⇄⇅⇆⇈⇊⇋⇌⇍⇐⇒'.split(''),
  alchemical:'☉☽☿♀♁♂♃♄♅♆☊☋⚗⚘⚙⚚⚛⚜'.split(''),
  zodiac:    '♈♉♊♋♌♍♎♏♐♑♒♓'.split(''),
  botanical: '❀❁❂❃❄❅❆❇❈❉❊❋✿✾✽✼❖'.split(''),
  celestial: '★☆✦✧✩✪✫✬✭✮✯✰✶✷✸✹⍟'.split(''),
  mixed:     '◆○■△▽☉♀♂★☆✦❀❁❂⚛⚜→↗↺⬡⬢✿❖♃'.split(''),
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.508°

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
    options: ['scattered', 'grid', 'orbital', 'mandala', 'constellation'],
    default: 'mandala',
    help: 'Arrangement pattern for glyphs',
    group: 'Composition',
  },
  count: {
    name: 'Count', type: 'number', min: 20, max: 400, step: 10, default: 150,
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
  connectLines: {
    name: 'Connect Lines', type: 'boolean', default: true,
    help: 'Draw constellation lines between nearby glyphs',
    group: 'Texture',
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

// Pre-compute palette RGBA strings for all alpha levels we use
function buildPaletteRgba(palette: Palette): string[][] {
  // [colorIdx][alphaLevel] => rgba string
  // alphaLevels: 0=line(0.08), 1=glow(0.45), 2..21=glyph(0.30..0.90 in 20 steps)
  return palette.colors.map(hex => {
    const [r, g, b] = hexToRgb(hex);
    const result: string[] = [];
    result.push(`rgba(${r},${g},${b},0.08)`);  // 0: line
    result.push(`rgba(${r},${g},${b},0.45)`);  // 1: glow
    for (let i = 0; i <= 20; i++) {
      const a = (0.30 + i * 0.03).toFixed(2);
      result.push(`rgba(${r},${g},${b},${a})`); // 2..22: glyph alphas
    }
    return result;
  });
}

export const textGlyphs: Generator = {
  id: 'text-glyphs',
  family: 'text',
  styleName: 'Glyphs',
  definition: 'Artistic compositions of Unicode symbols — geometric, alchemical, celestial, and botanical glyphs',
  algorithmNotes:
    'Selects glyphs from themed Unicode collections and places them in grid, scattered, orbital, mandala (golden-angle spiral), ' +
    'or constellation layouts. Nearby glyphs can be connected with thin constellation lines. Color flows along the layout path ' +
    'via palette gradient interpolation. Depth layering creates parallax. Animation gently drifts positions using simplex noise.',
  parameterSchema,
  defaultParams: {
    glyphSet: 'mixed', layout: 'mandala', count: 150, sizeRange: 45,
    rotation: 0.3, connectLines: true, glow: true, speed: 0.4,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);

    const glyphSetName = params.glyphSet ?? 'mixed';
    const layout = params.layout ?? 'mandala';
    const count = params.count ?? 150;
    const sizeRange = params.sizeRange ?? 45;
    const rotationAmount = params.rotation ?? 0.3;
    const showConnectLines = params.connectLines ?? true;
    const showGlow = params.glow ?? true;
    const speed = params.speed ?? 0.4;

    const glyphs = GLYPH_SETS[glyphSetName] || GLYPH_SETS.mixed;
    const rgbaLookup = buildPaletteRgba(palette);
    const numColors = palette.colors.length;

    // Dark background with subtle radial gradient
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, '#12101a');
    grad.addColorStop(1, '#06050a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Generate glyph instances — flat arrays for speed
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    const sizes = new Float64Array(count);
    const angles = new Float64Array(count);
    const depths = new Float64Array(count);
    const colorIndices = new Uint8Array(count);
    const charIndices = new Uint8Array(count);

    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) * 0.43;

    for (let i = 0; i < count; i++) {
      const t = i / count;

      switch (layout) {
        case 'grid': {
          const cols = Math.ceil(Math.sqrt(count * w / h));
          const rows = Math.ceil(count / cols);
          const col = i % cols, row = (i / cols) | 0;
          const cellW = w / cols, cellH = h / rows;
          xs[i] = (col + 0.5) * cellW + rng.range(-cellW * 0.2, cellW * 0.2);
          ys[i] = (row + 0.5) * cellH + rng.range(-cellH * 0.2, cellH * 0.2);
          break;
        }
        case 'orbital': {
          const rings = 5;
          const ring = (t * rings) | 0;
          const posInRing = t * rings - ring;
          const r = ((ring + 1) / rings) * maxR;
          const a = posInRing * Math.PI * 2 + ring * 0.7;
          xs[i] = cx + Math.cos(a) * r;
          ys[i] = cy + Math.sin(a) * r;
          break;
        }
        case 'mandala': {
          // Golden-angle phyllotactic spiral
          const a = i * GOLDEN_ANGLE;
          const r = maxR * Math.sqrt(t);
          xs[i] = cx + Math.cos(a) * r;
          ys[i] = cy + Math.sin(a) * r;
          break;
        }
        case 'constellation': {
          // Clustered random: place glyphs in small groups
          const cluster = (i / 5) | 0;
          const clusterRng = new SeededRNG(seed + cluster * 7);
          const clusterX = clusterRng.range(w * 0.1, w * 0.9);
          const clusterY = clusterRng.range(h * 0.1, h * 0.9);
          const spread = Math.min(w, h) * 0.08;
          xs[i] = clusterX + rng.range(-spread, spread);
          ys[i] = clusterY + rng.range(-spread, spread);
          break;
        }
        default: { // scattered
          xs[i] = rng.range(w * 0.05, w * 0.95);
          ys[i] = rng.range(h * 0.05, h * 0.95);
          break;
        }
      }

      // Noise-based animation drift
      const nx = noise.noise2D(xs[i] / w * 3 + time * speed * 0.02, ys[i] / h * 3 + seed * 0.1);
      const ny = noise.noise2D(xs[i] / w * 3 + 100, ys[i] / h * 3 + time * speed * 0.015 + seed * 0.1);
      xs[i] += nx * 18 * speed;
      ys[i] += ny * 18 * speed;

      const d = rng.random();
      depths[i] = d;
      sizes[i] = Math.max(8, sizeRange * (0.2 + 0.8 * d));
      angles[i] = rotationAmount * (rng.random() - 0.5) * Math.PI * 2;
      // Color flows along layout position
      colorIndices[i] = ((t * (numColors - 1) + 0.5) | 0) % numColors;
      charIndices[i] = (rng.random() * glyphs.length) | 0;
    }

    // Sort by depth — build index array to avoid moving all data
    const order = Array.from({ length: count }, (_, i) => i);
    order.sort((a, b) => depths[a] - depths[b]);

    // Draw constellation lines BEFORE glyphs (behind)
    if (showConnectLines) {
      const threshold = Math.min(w, h) * 0.12;
      const threshold2 = threshold * threshold;
      ctx.lineWidth = 0.8;
      // Only check nearby pairs using spatial grid for O(n) instead of O(n²)
      const gridSize = threshold;
      const gridCols = Math.ceil(w / gridSize);
      const grid = new Map<number, number[]>();

      for (let i = 0; i < count; i++) {
        const gc = (xs[i] / gridSize) | 0;
        const gr = (ys[i] / gridSize) | 0;
        const key = gr * gridCols + gc;
        const cell = grid.get(key);
        if (cell) cell.push(i);
        else grid.set(key, [i]);
      }

      ctx.beginPath();
      for (const [key, cell] of grid) {
        const gr = (key / gridCols) | 0;
        const gc = key - gr * gridCols;
        // Check this cell and 3 neighbors (right, below, below-right) to avoid duplicates
        const neighbors = [cell];
        const r = grid.get((gr) * gridCols + gc + 1);
        const b = grid.get((gr + 1) * gridCols + gc);
        const br = grid.get((gr + 1) * gridCols + gc + 1);
        const bl = grid.get((gr + 1) * gridCols + gc - 1);
        if (r) neighbors.push(r);
        if (b) neighbors.push(b);
        if (br) neighbors.push(br);
        if (bl) neighbors.push(bl);

        for (const a of cell) {
          for (const neighborCell of neighbors) {
            for (const bb of neighborCell) {
              if (bb <= a) continue;
              const dx = xs[a] - xs[bb], dy = ys[a] - ys[bb];
              const d2 = dx * dx + dy * dy;
              if (d2 < threshold2) {
                ctx.moveTo(xs[a], ys[a]);
                ctx.lineTo(xs[bb], ys[bb]);
              }
            }
          }
        }
      }
      // Use first palette color for lines
      ctx.strokeStyle = rgbaLookup[0][0]; // alpha 0.08
      ctx.stroke();
    }

    // Draw glyphs in depth order
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Batch by font size bucket to reduce font changes
    let lastFontSize = -1;

    for (const idx of order) {
      const ci = colorIndices[idx];
      const d = depths[idx];
      // Map depth 0..1 to alpha index 2..22
      const alphaIdx = 2 + ((d * 20) | 0);
      const fs = (sizes[idx] + 0.5) | 0;

      // Only change font when size actually differs
      if (fs !== lastFontSize) {
        ctx.font = `${fs}px serif`;
        lastFontSize = fs;
      }

      const x = xs[idx], y = ys[idx];
      const a = angles[idx] + Math.sin(time * speed * 0.5 + d * 10) * 0.06;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);

      if (showGlow) {
        ctx.shadowColor = rgbaLookup[ci][1];
        ctx.shadowBlur = fs * 0.45;
      }

      ctx.fillStyle = rgbaLookup[ci][alphaIdx];
      ctx.fillText(glyphs[charIndices[idx]], 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();
    }
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return Math.floor((params.count ?? 150) * 2); },
};
