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
  rows: Uint8Array[];
  head: number;
  width: number;
  currentRule: number; // live rule — may drift from params.rule via mutation
  rng: SeededRNG;      // for mutation events
} | null = null;

// ---------------------------------------------------------------------------
// Rule application — 3-cell neighbourhood (standard Wolfram ECA)
// ---------------------------------------------------------------------------
function applyRule(row: Uint8Array, rule: number): Uint8Array {
  const w = row.length;
  const next = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    const l = row[(x - 1 + w) % w];
    const c = row[x];
    const r = row[(x + 1) % w];
    next[x] = (rule >> ((l << 2) | (c << 1) | r)) & 1;
  }
  return next;
}

// ---------------------------------------------------------------------------
// 5-cell totalistic rule — neighbourhood = {x-2, x-1, x, x+1, x+2}
// sum ∈ [0,5] → 6 output bits; rule is a number 0–63 (bits 0-5 used)
// This neighbourhood produces much richer pattern vocabularies than 3-cell.
// ---------------------------------------------------------------------------
function applyRule5(row: Uint8Array, rule: number): Uint8Array {
  const w = row.length;
  const next = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    const sum =
      row[(x - 2 + w) % w] +
      row[(x - 1 + w) % w] +
      row[x] +
      row[(x + 1) % w] +
      row[(x + 2) % w];
    next[x] = (rule >> sum) & 1;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Blend two rules — compute each independently then combine bitwise
// ---------------------------------------------------------------------------
function applyRuleBlend(
  row: Uint8Array, ruleA: number, ruleB: number,
  blendMode: string, wide: boolean,
): Uint8Array {
  const a = wide ? applyRule5(row, ruleA) : applyRule(row, ruleA);
  const b = wide ? applyRule5(row, ruleB) : applyRule(row, ruleB);
  const w = row.length;
  const next = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    if (blendMode === 'xor') next[x] = a[x] ^ b[x];
    else if (blendMode === 'or')  next[x] = a[x] | b[x];
    else                          next[x] = a[x] & b[x]; // 'and'
  }
  return next;
}

// ---------------------------------------------------------------------------
// Compute next row — dispatches based on params
// ---------------------------------------------------------------------------
function nextRow(
  row: Uint8Array, rule: number, ruleB: number, blendMode: string, wide: boolean,
): Uint8Array {
  if (blendMode !== 'none') return applyRuleBlend(row, rule, ruleB, blendMode, wide);
  return wide ? applyRule5(row, rule) : applyRule(row, rule);
}

// ---------------------------------------------------------------------------
// Mutate a rule — randomly flip one bit of the 8-bit (or 6-bit) rule value
// ---------------------------------------------------------------------------
function mutateRule(rule: number, wide: boolean, rng: SeededRNG): number {
  const bits = wide ? 6 : 8;
  const bit = (rng.random() * bits) | 0;
  return rule ^ (1 << bit);
}

function makeInitRow(width: number, initialCondition: string, rng: SeededRNG): Uint8Array {
  const row = new Uint8Array(width);
  if (initialCondition === 'random') {
    for (let x = 0; x < width; x++) row[x] = rng.random() < 0.5 ? 1 : 0;
  } else if (initialCondition === 'two-center') {
    // Two seeds offset symmetrically — creates interference patterns
    const c = (width / 2) | 0;
    const offset = (width / 8) | 0;
    row[c] = 1;
    row[(c + offset) % width] = 1;
    row[(c - offset + width) % width] = 1;
  } else {
    row[(width / 2) | 0] = 1;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
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
  const cOff = colors[0]                 || [10, 10, 10]    as [number, number, number];
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const cellW = rows[0].length;
  const cw = w / cellW;
  const ch = h / numRows;

  for (let ri = 0; ri < numRows; ri++) {
    const rowIdx = (head + ri) % numRows;
    const row    = rows[rowIdx];
    const y0 = Math.floor(ri * ch), y1 = Math.floor((ri + 1) * ch);

    for (let cx = 0; cx < cellW; cx++) {
      const on = row[cx] === 1;
      let r: number, g: number, b: number;

      if (colorMode === 'age') {
        const t = ri / Math.max(1, numRows - 1);
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        const mixR = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        const mixG = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        const mixB = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
        r = on ? mixR : 8; g = on ? mixG : 8; b = on ? mixB : 8;
      } else if (colorMode === 'density') {
        // Colour by count of ON cells in 3-cell neighbourhood — 0,1,2,3 → palette
        const lv = row[(cx - 1 + cellW) % cellW];
        const rv = row[(cx + 1) % cellW];
        const count = lv + (on ? 1 : 0) + rv; // 0..3
        const t = count / 3;
        const scaled = t * (colors.length - 1);
        const i0 = Math.floor(scaled);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const frac = scaled - i0;
        r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * frac) | 0;
        g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * frac) | 0;
        b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * frac) | 0;
      } else {
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
    help: 'Cells per row; height = same number of generations displayed',
    group: 'Composition',
  },
  rule: {
    name: 'Rule A (0–255)',
    type: 'number', min: 0, max: 255, step: 1, default: 30,
    help: 'Primary Wolfram rule — notable: 30 (chaos/RNG), 90 (Sierpiński), 110 (Turing-complete), 184 (traffic flow). In 5-cell mode only bits 0–5 matter (rules 0–63).',
    group: 'Composition',
  },
  ruleB: {
    name: 'Rule B (0–255)',
    type: 'number', min: 0, max: 255, step: 1, default: 90,
    help: 'Secondary rule for blend mode — each generation is the bitwise combination of Rule A and Rule B outputs',
    group: 'Composition',
  },
  blendMode: {
    name: 'Blend Mode',
    type: 'select',
    options: ['none', 'xor', 'or', 'and'],
    default: 'none',
    help: 'none: only Rule A | xor: XOR of Rule A and B — creates complex interference/moiré patterns | or: OR | and: AND',
    group: 'Composition',
  },
  neighborWidth: {
    name: 'Neighbourhood',
    type: 'select',
    options: ['3-cell', '5-cell'],
    default: '3-cell',
    help: '3-cell: standard Wolfram (left, centre, right) → 8 patterns, 256 rules | 5-cell totalistic: sum of 5 cells, 6 counts → 64 rules; produces denser, more complex patterns',
    group: 'Geometry',
  },
  initialCondition: {
    name: 'Initial Condition',
    type: 'select',
    options: ['single-center', 'two-center', 'random'],
    default: 'single-center',
    help: 'single-center: one ON cell | two-center: three symmetric seeds — creates bilateral interference patterns | random: seeded random row',
    group: 'Geometry',
  },
  mutationRate: {
    name: 'Mutation Rate',
    type: 'number', min: 0, max: 0.1, step: 0.005, default: 0.0,
    help: 'Probability per generation that one rule bit randomly flips during animation — causes the pattern to slowly morph between different CA behaviours over time',
    group: 'Flow/Motion',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 20, step: 1, default: 4,
    help: 'Rows added per animation frame — the spacetime diagram scrolls at this rate',
    group: 'Flow/Motion',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['binary', 'age', 'density'],
    default: 'binary',
    help: 'binary: ON/OFF → last/first palette color | age: row age mapped to palette gradient | density: neighbourhood count (0–3) mapped to palette — reveals local activity structure',
    group: 'Color',
  },
};

export const elementaryCA: Generator = {
  id: 'cellular-elementary-ca',
  family: 'cellular',
  styleName: 'Elementary CA',
  definition: "Wolfram's 1D elementary cellular automata — standard 3-cell or 5-cell totalistic neighbourhood, dual-rule bitwise blending, slow rule mutation during animation, and density colour mode; creates behaviour from uniform to fractal to chaotic to Turing-complete",
  algorithmNotes:
    'Each row is one generation of a 1D binary automaton of width W. Standard 3-cell mode: next state of cell x depends on {x−1, x, x+1} (3-bit neighbourhood → 8 patterns, 256 rules). 5-cell totalistic mode: uses {x−2, x−1, x, x+1, x+2} — only the sum (0–5) matters, giving 6 output bits (64 rules); this produces denser, more varied textures. Blend mode applies two rules independently and combines their outputs with XOR/OR/AND, creating interference-like beating patterns. Rule mutation: each generation, with probability mutationRate, one random bit of the active rule flips — over time the spacetime diagram slowly morphs through different CA behaviours, creating an endlessly evolving pattern. Density colour mode maps the 3-cell neighbourhood count to the palette, revealing local activity without hard binary thresholding.',
  parameterSchema,
  defaultParams: {
    gridSize: 256, rule: 30, ruleB: 90,
    blendMode: 'none', neighborWidth: '3-cell',
    initialCondition: 'single-center',
    mutationRate: 0.0, stepsPerFrame: 4, colorMode: 'binary',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const width    = Math.max(16, (params.gridSize ?? 256) | 0);
    const rule     = Math.max(0, Math.min(255, (params.rule  ?? 30)  | 0));
    const ruleB    = Math.max(0, Math.min(255, (params.ruleB ?? 90)  | 0));
    const blendMode    = params.blendMode     ?? 'none';
    const wide         = (params.neighborWidth ?? '3-cell') === '5-cell';
    const ic           = params.initialCondition || 'single-center';
    const mutationRate = params.mutationRate ?? 0;
    const colorMode    = params.colorMode    || 'binary';
    const numRows      = width;

    if (time === 0) {
      const rng = new SeededRNG(seed);
      let row = makeInitRow(width, ic, rng);
      const allRows: Uint8Array[] = [row];
      for (let i = 1; i < numRows; i++) {
        row = nextRow(row, rule, ruleB, blendMode, wide);
        allRows.push(row);
      }
      renderECA(ctx, allRows, 0, numRows, colorMode, palette);
      return;
    }

    const key = `${seed}|${width}|${rule}|${ic}|${blendMode}|${wide}`;
    if (!_ecaAnim || _ecaAnim.key !== key) {
      const rng = new SeededRNG(seed);
      let row = makeInitRow(width, ic, rng);
      const rows: Uint8Array[] = [];
      for (let i = 0; i < numRows; i++) {
        rows.push(new Uint8Array(row));
        row = nextRow(row, rule, ruleB, blendMode, wide);
      }
      _ecaAnim = { key, rows, head: 0, width, currentRule: rule, rng: new SeededRNG(seed ^ 0x1234) };
    }

    const spf = Math.max(1, (params.stepsPerFrame ?? 4) | 0);
    for (let s = 0; s < spf; s++) {
      // Rule mutation — slowly evolve the active rule during animation
      if (mutationRate > 0 && _ecaAnim.rng.random() < mutationRate) {
        _ecaAnim.currentRule = mutateRule(_ecaAnim.currentRule, wide, _ecaAnim.rng);
      }

      const lastIdx = (_ecaAnim.head + numRows - 1) % numRows;
      const newRow  = nextRow(_ecaAnim.rows[lastIdx], _ecaAnim.currentRule, ruleB, blendMode, wide);
      _ecaAnim.rows[_ecaAnim.head].set(newRow);
      _ecaAnim.head = (_ecaAnim.head + 1) % numRows;
    }

    renderECA(ctx, _ecaAnim.rows, _ecaAnim.head, numRows, colorMode, palette);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) { return ((params.gridSize ?? 256) ** 2 * 0.001) | 0; },
};
