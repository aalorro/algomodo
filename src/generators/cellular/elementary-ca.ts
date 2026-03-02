import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state — ring buffer of rows
// ---------------------------------------------------------------------------
let _ecaAnim: {
  key: string;
  rows: Uint8Array[];   // ring buffer, length = size
  head: number;         // index of oldest row (next to be overwritten)
  width: number;        // cells per row
} | null = null;

function applyRule(row: Uint8Array, rule: number): Uint8Array {
  const w = row.length;
  const next = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    const l = row[(x - 1 + w) % w];
    const c = row[x];
    const r = row[(x + 1) % w];
    const idx = (l << 2) | (c << 1) | r;
    next[x] = (rule >> idx) & 1;
  }
  return next;
}

function makeInitRow(width: number, initialCondition: string, rng: SeededRNG): Uint8Array {
  const row = new Uint8Array(width);
  if (initialCondition === 'random') {
    for (let x = 0; x < width; x++) row[x] = rng.random() < 0.5 ? 1 : 0;
  } else {
    // Single cell in the centre
    row[(width / 2) | 0] = 1;
  }
  return row;
}

function renderECA(
  ctx: CanvasRenderingContext2D,
  rows: Uint8Array[],
  head: number,
  numRows: number,
  colorMode: string,
  palette: { colors: string[] },
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const colors = palette.colors.map(hexToRgb);
  const cOn  = colors[colors.length - 1] || [255, 255, 255] as [number, number, number];
  const cOff = colors[0] || [10, 10, 10] as [number, number, number];
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cellW = rows[0].length;

  const cw = w / cellW;
  const ch = h / numRows;

  for (let ri = 0; ri < numRows; ri++) {
    // Display from oldest (head) to newest
    const rowIdx = (head + ri) % numRows;
    const row = rows[rowIdx];
    const y0 = Math.floor(ri * ch), y1 = Math.floor((ri + 1) * ch);

    for (let cx = 0; cx < cellW; cx++) {
      const on = row[cx] === 1;
      let r: number, g: number, b: number;

      if (colorMode === 'age') {
        // Older rows fade: top row = first palette color, bottom = last
        const t = ri / Math.max(1, numRows - 1);
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        const mixR = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        const mixG = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        const mixB = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
        r = on ? mixR : 8; g = on ? mixG : 8; b = on ? mixB : 8;
      } else {
        // binary: last palette color / first palette color
        [r, g, b] = on ? cOn : cOff;
      }

      const x0 = Math.floor(cx * cw), x1 = Math.floor((cx + 1) * cw);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * w + px) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  gridSize: {
    name: 'Grid Width',
    type: 'number', min: 64, max: 512, step: 64, default: 256,
    help: 'Number of cells per row; height = same number of generations displayed',
    group: 'Composition',
  },
  rule: {
    name: 'Rule (0–255)',
    type: 'number', min: 0, max: 255, step: 1, default: 30,
    help: 'Wolfram rule number — notable rules: 30 (chaotic / RNG), 90 (Sierpiński triangle), 110 (Turing-complete), 184 (traffic flow)',
    group: 'Composition',
  },
  initialCondition: {
    name: 'Initial Condition',
    type: 'select',
    options: ['single-center', 'random'],
    default: 'single-center',
    help: 'single-center: one ON cell in the middle (deterministic) | random: seeded random row',
    group: 'Geometry',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 20, step: 1, default: 4,
    help: 'Rows added per animation frame — the spacetime diagram scrolls upward at this rate',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['binary', 'age'],
    default: 'binary',
    help: 'binary: ON/OFF → last/first palette color | age: row age mapped to palette gradient (newest row = last palette color)',
    group: 'Color',
  },
};

export const elementaryCA: Generator = {
  id: 'cellular-elementary-ca',
  family: 'cellular',
  styleName: 'Elementary CA',
  definition: 'Wolfram\'s 1D elementary cellular automata displayed as a spacetime diagram — 256 possible rules produce behaviour ranging from uniform to fractal to chaotic to Turing-complete',
  algorithmNotes:
    'Each row is one generation of a 1D binary automaton of width W. The next state of cell x depends only on cells x−1, x, x+1 (3-bit neighbourhood → 8 patterns → the rule number encodes the output for each pattern as a byte). The spacetime diagram scrolls upward in animation mode. Rule 30 passes all statistical randomness tests; Rule 90 produces the Sierpiński triangle; Rule 110 is the simplest known Turing-complete system.',
  parameterSchema,
  defaultParams: {
    gridSize: 256, rule: 30, initialCondition: 'single-center',
    stepsPerFrame: 4, colorMode: 'binary',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const width = Math.max(16, (params.gridSize ?? 256) | 0);
    const rule = Math.max(0, Math.min(255, (params.rule ?? 30) | 0));
    const ic = params.initialCondition || 'single-center';
    const colorMode = params.colorMode || 'binary';
    const numRows = width; // square spacetime diagram

    if (time === 0) {
      const rng = new SeededRNG(seed);
      let row = makeInitRow(width, ic, rng);
      const allRows: Uint8Array[] = [row];
      for (let i = 1; i < numRows; i++) {
        row = applyRule(row, rule);
        allRows.push(row);
      }
      // Render as static image (oldest row at top)
      const fakeHead = 0;
      renderECA(ctx, allRows, fakeHead, numRows, colorMode, palette);
      return;
    }

    const key = `${seed}|${width}|${rule}|${ic}`;
    if (!_ecaAnim || _ecaAnim.key !== key) {
      const rng = new SeededRNG(seed);
      let row = makeInitRow(width, ic, rng);
      const rows: Uint8Array[] = [];
      // Pre-fill the ring buffer
      for (let i = 0; i < numRows; i++) {
        rows.push(new Uint8Array(row));
        row = applyRule(row, rule);
      }
      _ecaAnim = { key, rows, head: 0, width };
    }

    // Advance: replace oldest row with new generation each step
    const spf = Math.max(1, (params.stepsPerFrame ?? 4) | 0);
    for (let s = 0; s < spf; s++) {
      // Last row in display order is at index (head + numRows - 1) % numRows
      const lastIdx = (_ecaAnim.head + numRows - 1) % numRows;
      const newRow = applyRule(_ecaAnim.rows[lastIdx], rule);
      _ecaAnim.rows[_ecaAnim.head].set(newRow);
      _ecaAnim.head = (_ecaAnim.head + 1) % numRows;
    }

    renderECA(ctx, _ecaAnim.rows, _ecaAnim.head, numRows, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 256) ** 2 * 0.001) | 0; },
};
