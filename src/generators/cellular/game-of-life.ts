import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { drawRect, clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Persistent animation state (survives between RAF frames)
// ---------------------------------------------------------------------------
let _anim: {
  key: string;
  grid: Uint8Array;
  // positive = consecutive frames alive; negative = frames since death (trail)
  age: Int16Array;
  size: number;
} | null = null;

function animKey(seed: number, size: number, density: number, wrap: boolean): string {
  return `${seed}|${size}|${density}|${wrap}`;
}

function initGrid(seed: number, size: number, density: number) {
  const rng = new SeededRNG(seed);
  const n = size * size;
  const grid = new Uint8Array(n);
  const age = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    if (rng.random() < density) { grid[i] = 1; age[i] = 1; }
  }
  return { grid, age };
}

function stepGrid(grid: Uint8Array, age: Int16Array, size: number, wrap: boolean): void {
  const next = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          let ny = y + dy, nx = x + dx;
          if (wrap) {
            ny = (ny + size) % size;
            nx = (nx + size) % size;
          } else {
            if (ny < 0 || ny >= size || nx < 0 || nx >= size) continue;
          }
          n += grid[ny * size + nx];
        }
      }
      const alive = grid[y * size + x];
      next[y * size + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
    }
  }
  // Update grid and age in-place from next
  for (let i = 0; i < size * size; i++) {
    if (next[i]) {
      age[i] = age[i] <= 0 ? 1 : Math.min(age[i] + 1, 32767);
    } else {
      age[i] = age[i] >= 0 ? -1 : Math.max(age[i] - 1, -60);
    }
    grid[i] = next[i];
  }
}

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------
const parameterSchema: ParameterSchema = {
  gridSize: {
    name: 'Grid Size',
    type: 'number', min: 16, max: 512, step: 16, default: 128,
    help: 'Width/height of cell grid',
    group: 'Composition',
  },
  density: {
    name: 'Initial Density',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0.3,
    help: 'Proportion of cells alive at start',
    group: 'Composition',
  },
  iterations: {
    name: 'Iterations',
    type: 'number', min: 1, max: 500, step: 1, default: 100,
    help: 'Simulation steps (static / non-animated render only)',
    group: 'Composition',
  },
  wrapEdges: {
    name: 'Wrap Edges',
    type: 'boolean', default: true,
    help: 'Torus topology — edges wrap around',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['binary', 'age', 'trails'],
    default: 'binary',
    help: 'binary: two-colour | age: alive cells coloured by how long they have lived | trails: dying cells leave a fading afterimage',
    group: 'Color',
  },
  stepsPerFrame: {
    name: 'Steps / Frame',
    type: 'number', min: 1, max: 10, step: 1, default: 1,
    help: 'GoL steps advanced per animation frame — higher = faster simulation',
    group: 'Flow/Motion',
  },
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------
export const gameOfLife: Generator = {
  id: 'game-of-life',
  family: 'cellular',
  styleName: 'Game of Life',
  definition: "Conway's Game of Life cellular automaton with emergent patterns and live animation",
  algorithmNotes:
    'Each cell is alive or dead. Rules: a live cell with 2–3 neighbours survives; a dead cell with exactly 3 neighbours is born. In animation mode the grid evolves continuously with persistent state. The "age" colour mode tints long-lived stable structures differently from newborn cells; "trails" leaves a fading glow wherever cells have died.',
  parameterSchema,
  defaultParams: {
    gridSize: 128, density: 0.3, iterations: 100, wrapEdges: true,
    colorMode: 'binary', stepsPerFrame: 1,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const { gridSize, density, wrapEdges } = params;
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // ── Static render (original batch path) ────────────────────────────────
    if (time === 0) {
      const cellSize = Math.max(1, Math.floor(width / gridSize));
      clearCanvas(ctx, width, height, '#000000');
      const rng = new SeededRNG(seed);
      const grid = Array(gridSize).fill(0).map(() =>
        Array(gridSize).fill(0).map(() => (rng.random() < density ? 1 : 0)),
      );
      for (let iter = 0; iter < params.iterations; iter++) {
        const newGrid = grid.map(row => [...row]);
        for (let y = 0; y < gridSize; y++) {
          for (let x = 0; x < gridSize; x++) {
            let neighbors = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                let ny = y + dy, nx = x + dx;
                if (wrapEdges) {
                  ny = (ny + gridSize) % gridSize;
                  nx = (nx + gridSize) % gridSize;
                } else {
                  if (ny < 0 || ny >= gridSize || nx < 0 || nx >= gridSize) continue;
                }
                neighbors += grid[ny][nx];
              }
            }
            newGrid[y][x] = grid[y][x]
              ? (neighbors === 2 || neighbors === 3 ? 1 : 0)
              : (neighbors === 3 ? 1 : 0);
          }
        }
        grid.splice(0, grid.length, ...newGrid);
      }
      const color1 = palette.colors[1] || '#ffffff';
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          if (grid[y][x]) drawRect(ctx, x * cellSize, y * cellSize, cellSize, cellSize, color1);
        }
      }
      return;
    }

    // ── Animation mode: persistent state ───────────────────────────────────
    const key = animKey(seed, gridSize, density, wrapEdges);
    if (!_anim || _anim.key !== key) {
      const { grid, age } = initGrid(seed, gridSize, density);
      _anim = { key, grid, age, size: gridSize };
    }

    const stepsPerFrame = Math.max(1, (params.stepsPerFrame ?? 1) | 0);
    for (let s = 0; s < stepsPerFrame; s++) {
      stepGrid(_anim.grid, _anim.age, _anim.size, wrapEdges);
    }

    // Render via ImageData for performance
    const colors = palette.colors.map(hexToRgb);
    const aliveColor = colors[Math.min(1, colors.length - 1)];
    const colorMode = params.colorMode || 'binary';
    const { grid, age, size } = _anim;
    const cellW = width / size;
    const cellH = height / size;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let cy = 0; cy < size; cy++) {
      const y0 = Math.floor(cy * cellH);
      const y1 = Math.floor((cy + 1) * cellH);
      for (let cx = 0; cx < size; cx++) {
        const i = cy * size + cx;
        const a = age[i];
        const alive = grid[i];
        let r: number, g: number, b: number;

        if (colorMode === 'binary') {
          if (alive) { [r, g, b] = aliveColor; }
          else { r = 8; g = 8; b = 8; }
        } else if (colorMode === 'age') {
          if (alive) {
            // Young = first palette color, old = last palette color
            const t = Math.min(1, a / 120);
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci);
            const i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            r = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
            g = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
            b = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
          } else { r = 8; g = 8; b = 8; }
        } else {
          // trails
          if (alive) {
            [r, g, b] = aliveColor;
          } else if (a < 0) {
            // Fade from alive color to dark over 30 frames
            const t = Math.max(0, 1 + a / 30);
            r = (8 + (aliveColor[0] - 8) * t) | 0;
            g = (8 + (aliveColor[1] - 8) * t) | 0;
            b = (8 + (aliveColor[2] - 8) * t) | 0;
          } else { r = 8; g = 8; b = 8; }
        }

        const x0 = Math.floor(cx * cellW);
        const x1 = Math.floor((cx + 1) * cellW);
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            const idx = (py * width + px) * 4;
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return (params.gridSize * params.gridSize) / (4 - params.density * 2);
  },
};
