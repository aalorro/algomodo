import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const BG: Record<string, string> = { white: '#f8f8f5', cream: '#f2ead8', dark: '#0e0e0e' };

const parameterSchema: ParameterSchema = {
  cellSize: {
    name: 'Cell Size',
    type: 'number', min: 12, max: 80, step: 2, default: 30,
    help: 'Size of each maze cell in pixels',
    group: 'Composition',
  },
  margin: {
    name: 'Margin',
    type: 'number', min: 0.01, max: 0.12, step: 0.01, default: 0.04,
    help: 'Border margin as fraction of canvas',
    group: 'Composition',
  },
  style: {
    name: 'Style',
    type: 'select',
    options: ['maze', 'meander'],
    default: 'maze',
    help: 'maze: DFS recursive backtracker | meander: serpentine Greek-key fill',
    group: 'Composition',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number', min: 0.5, max: 4, step: 0.25, default: 1.25,
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['monochrome', 'palette-distance', 'palette-zone', 'palette-noise'],
    default: 'palette-distance',
    help: 'palette-distance: BFS distance from origin drives gradient | palette-zone: diagonal zone coloring | palette-noise: FBM tint',
    group: 'Color',
  },
  background: {
    name: 'Background',
    type: 'select',
    options: ['white', 'cream', 'dark'],
    default: 'cream',
    group: 'Color',
  },
};

// wallH[row][col]: horizontal wall below cell (row,col), between rows row and row+1
// wallV[row][col]: vertical wall right of cell (row,col), between cols col and col+1
function generateMaze(
  cols: number,
  rows: number,
  rng: SeededRNG,
): { wallH: boolean[][]; wallV: boolean[][] } {
  // All walls start present
  const wallH: boolean[][] = Array.from({ length: rows - 1 }, () =>
    new Array(cols).fill(true),
  );
  const wallV: boolean[][] = Array.from({ length: rows }, () =>
    new Array(cols - 1).fill(true),
  );

  const visited = new Uint8Array(cols * rows);
  const stack: number[] = [0];
  visited[0] = 1;

  // N=0, E=1, S=2, W=3
  const dx = [0, 1, 0, -1];
  const dy = [-1, 0, 1, 0];

  while (stack.length > 0) {
    const curr = stack[stack.length - 1];
    const cx = curr % cols;
    const cy = (curr / cols) | 0;

    // Collect unvisited neighbours
    const nbrs: [number, number][] = [];
    for (let dir = 0; dir < 4; dir++) {
      const nx = cx + dx[dir];
      const ny = cy + dy[dir];
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !visited[ny * cols + nx]) {
        nbrs.push([ny * cols + nx, dir]);
      }
    }

    if (nbrs.length === 0) {
      stack.pop();
      continue;
    }

    const [next, dir] = rng.pick(nbrs);
    const nx = cx + dx[dir];
    const ny = cy + dy[dir];

    // Carve wall between curr and next
    if (dir === 0 && ny >= 0) wallH[ny][cx] = false;       // N → remove wallH below ny
    else if (dir === 1 && cx < cols - 1) wallV[cy][cx] = false;  // E → remove wallV right of cx
    else if (dir === 2 && cy < rows - 1) wallH[cy][cx] = false;  // S → remove wallH below cy
    else if (dir === 3 && nx >= 0) wallV[cy][nx] = false;        // W → remove wallV right of nx

    visited[next] = 1;
    stack.push(next);
  }

  return { wallH, wallV };
}

export const meanderMaze: Generator = {
  id: 'plotter-meander-maze',
  family: 'plotter',
  styleName: 'Meander / Maze Fill',
  definition:
    'Space-filling paths via recursive-backtracker maze DFS or serpentine Greek-key meander',
  algorithmNotes:
    'Maze mode: DFS recursive backtracker carves a spanning tree through a grid — every remaining wall is drawn as a plotter stroke; BFS distance from the origin drives the colour gradient. Meander mode: a boustrophedon serpentine path sweeps alternating rows left/right, connected by vertical segments at the row ends, reproducing the classic Greek-key meander motif.',
  parameterSchema,
  defaultParams: {
    cellSize: 30,
    margin: 0.04,
    style: 'maze',
    lineWidth: 1.25,
    colorMode: 'palette-distance',
    background: 'cream',
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderCanvas2D(ctx, params, seed, palette) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const isDark = params.background === 'dark';
    const colors = palette.colors.map(hexToRgb);

    const margin = Math.max(0, params.margin ?? 0.04);
    const mx = w * margin;
    const my = h * margin;
    const availW = w - 2 * mx;
    const availH = h - 2 * my;

    const cellSize = Math.max(8, params.cellSize ?? 30);
    const cols = Math.max(2, Math.floor(availW / cellSize));
    const rows = Math.max(2, Math.floor(availH / cellSize));
    const cw = availW / cols;
    const ch = availH / rows;

    ctx.lineWidth = params.lineWidth ?? 1.25;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    const colorMode = params.colorMode || 'palette-distance';
    const maxDist = cols + rows;

    function getColor(col: number, row: number, dist: number): string {
      let cr: number, cg: number, cb: number;
      if (colorMode === 'monochrome') {
        [cr, cg, cb] = isDark ? [220, 220, 220] : [30, 30, 30];
      } else if (colorMode === 'palette-distance') {
        const t = Math.min(1, dist / maxDist);
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      } else if (colorMode === 'palette-zone') {
        const t = col / cols * 0.5 + row / rows * 0.5;
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      } else {
        // palette-noise
        const nv = noise.fbm(col / cols * 3 + 5, row / rows * 3 + 5, 3, 2, 0.5);
        const t = Math.max(0, nv * 0.5 + 0.5);
        const ci = t * (colors.length - 1);
        const i0 = Math.floor(ci);
        const i1 = Math.min(colors.length - 1, i0 + 1);
        const f = ci - i0;
        cr = (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0;
        cg = (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0;
        cb = (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0;
      }
      return `rgba(${cr},${cg},${cb},${isDark ? 0.85 : 0.82})`;
    }

    const style = params.style || 'maze';

    if (style === 'maze') {
      const { wallH, wallV } = generateMaze(cols, rows, rng);

      // BFS from cell (0,0) for distance-based coloring
      const dist = new Int32Array(cols * rows).fill(-1);
      const bfsQ: number[] = [0];
      dist[0] = 0;
      const dx = [0, 1, 0, -1];
      const dy = [-1, 0, 1, 0];

      while (bfsQ.length > 0) {
        const curr = bfsQ.shift()!;
        const cx = curr % cols;
        const cy = (curr / cols) | 0;

        for (let dir = 0; dir < 4; dir++) {
          const nx = cx + dx[dir];
          const ny = cy + dy[dir];
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

          let passable = false;
          if (dir === 0 && cy > 0) passable = !wallH[cy - 1][cx];
          else if (dir === 1 && cx < cols - 1) passable = !wallV[cy][cx];
          else if (dir === 2 && cy < rows - 1) passable = !wallH[cy][cx];
          else if (dir === 3 && cx > 0) passable = !wallV[cy][cx - 1];

          if (passable) {
            const ni = ny * cols + nx;
            if (dist[ni] === -1) {
              dist[ni] = dist[curr] + 1;
              bfsQ.push(ni);
            }
          }
        }
      }

      // Outer border
      ctx.strokeStyle = getColor(0, 0, 0);
      ctx.strokeRect(mx, my, availW, availH);

      // Horizontal walls (between row r and r+1)
      for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols; col++) {
          if (wallH[row][col]) {
            const d = dist[row * cols + col];
            ctx.strokeStyle = getColor(col, row, d >= 0 ? d : 0);
            ctx.beginPath();
            ctx.moveTo(mx + col * cw, my + (row + 1) * ch);
            ctx.lineTo(mx + (col + 1) * cw, my + (row + 1) * ch);
            ctx.stroke();
          }
        }
      }

      // Vertical walls (between col c and c+1)
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols - 1; col++) {
          if (wallV[row][col]) {
            const d = dist[row * cols + col];
            ctx.strokeStyle = getColor(col, row, d >= 0 ? d : 0);
            ctx.beginPath();
            ctx.moveTo(mx + (col + 1) * cw, my + row * ch);
            ctx.lineTo(mx + (col + 1) * cw, my + (row + 1) * ch);
            ctx.stroke();
          }
        }
      }
    } else {
      // Meander: boustrophedon serpentine path, segment-by-segment for coloring
      type Pt = [number, number, number, number]; // x, y, col, row
      const path: Pt[] = [];

      for (let row = 0; row < rows; row++) {
        const y = my + (row + 0.5) * ch;
        if (row % 2 === 0) {
          for (let col = 0; col <= cols; col++) {
            path.push([mx + col * cw, y, Math.min(col, cols - 1), row]);
          }
        } else {
          for (let col = cols; col >= 0; col--) {
            path.push([mx + col * cw, y, Math.max(col, 0), row]);
          }
        }
        if (row < rows - 1) {
          const col = row % 2 === 0 ? cols - 1 : 0;
          const x = row % 2 === 0 ? mx + cols * cw : mx;
          path.push([x, my + (row + 1.5) * ch, col, row + 1]);
        }
      }

      for (let i = 1; i < path.length; i++) {
        const [x1, y1, c1, r1] = path[i - 1];
        const [x2, y2] = path[i];
        const dist = r1 * cols + c1;
        ctx.strokeStyle = getColor(c1, r1, dist);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    const cell = params.cellSize ?? 30;
    const n = Math.ceil(1000 / cell) ** 2;
    return (n * 0.2) | 0;
  },
};
