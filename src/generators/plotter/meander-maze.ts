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
    help: 'maze: carved labyrinth | meander: serpentine Greek-key fill',
    group: 'Composition',
  },
  algorithm: {
    name: 'Algorithm',
    type: 'select',
    options: ['dfs', 'kruskal', 'binary-tree', 'sidewinder'],
    default: 'dfs',
    help: 'dfs: long winding corridors | kruskal: uniform random | binary-tree: diagonal bias | sidewinder: horizontal runs',
    group: 'Composition',
  },
  wallStyle: {
    name: 'Wall Style',
    type: 'select',
    options: ['straight', 'rounded', 'wobbly'],
    default: 'straight',
    help: 'straight: crisp grid | rounded: smooth corners | wobbly: noise-perturbed organic lines',
    group: 'Texture',
  },
  showSolution: {
    name: 'Show Solution',
    type: 'boolean',
    default: false,
    help: 'Highlight the path from top-left to bottom-right',
    group: 'Texture',
  },
  fillCells: {
    name: 'Fill Cells',
    type: 'boolean',
    default: false,
    help: 'Color-fill each cell by BFS distance — creates a heatmap effect',
    group: 'Color',
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
    help: 'palette-distance: BFS distance drives gradient | palette-zone: diagonal zone | palette-noise: FBM tint',
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

// ── Maze generation algorithms ──────────────────────────────────────────

interface MazeWalls { wallH: boolean[][]; wallV: boolean[][] }

function generateMazeDFS(cols: number, rows: number, rng: SeededRNG): MazeWalls {
  const wallH = Array.from({ length: rows - 1 }, () => new Array(cols).fill(true));
  const wallV = Array.from({ length: rows }, () => new Array(cols - 1).fill(true));
  const visited = new Uint8Array(cols * rows);
  const stack: number[] = [0];
  visited[0] = 1;
  const dx = [0, 1, 0, -1], dy = [-1, 0, 1, 0];

  while (stack.length > 0) {
    const curr = stack[stack.length - 1];
    const cx = curr % cols, cy = (curr / cols) | 0;
    const nbrs: [number, number][] = [];
    for (let dir = 0; dir < 4; dir++) {
      const nx = cx + dx[dir], ny = cy + dy[dir];
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !visited[ny * cols + nx])
        nbrs.push([ny * cols + nx, dir]);
    }
    if (nbrs.length === 0) { stack.pop(); continue; }
    const [next, dir] = rng.pick(nbrs);
    const nx = cx + dx[dir], ny = cy + dy[dir];
    if (dir === 0 && ny >= 0) wallH[ny][cx] = false;
    else if (dir === 1 && cx < cols - 1) wallV[cy][cx] = false;
    else if (dir === 2 && cy < rows - 1) wallH[cy][cx] = false;
    else if (dir === 3 && nx >= 0) wallV[cy][nx] = false;
    visited[next] = 1;
    stack.push(next);
  }
  return { wallH, wallV };
}

function generateMazeKruskal(cols: number, rows: number, rng: SeededRNG): MazeWalls {
  const wallH = Array.from({ length: rows - 1 }, () => new Array(cols).fill(true));
  const wallV = Array.from({ length: rows }, () => new Array(cols - 1).fill(true));
  // Union-find
  const parent = new Int32Array(cols * rows).fill(-1);
  function find(x: number): number { while (parent[x] >= 0) x = parent[x]; return x; }
  function union(a: number, b: number): boolean {
    const ra = find(a), rb = find(b);
    if (ra === rb) return false;
    if (parent[ra] < parent[rb]) { parent[ra] += parent[rb]; parent[rb] = ra; }
    else { parent[rb] += parent[ra]; parent[ra] = rb; }
    return true;
  }
  // Collect all edges, shuffle, process
  const edges: [number, number, boolean, number, number][] = []; // [cell1, cell2, isHoriz, r, c]
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols; c++)
      edges.push([r * cols + c, (r + 1) * cols + c, true, r, c]);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols - 1; c++)
      edges.push([r * cols + c, r * cols + c + 1, false, r, c]);
  const shuffled = rng.shuffle(edges);
  for (const [a, b, isH, r, c] of shuffled) {
    if (union(a, b)) {
      if (isH) wallH[r][c] = false; else wallV[r][c] = false;
    }
  }
  return { wallH, wallV };
}

function generateMazeBinaryTree(cols: number, rows: number, rng: SeededRNG): MazeWalls {
  const wallH = Array.from({ length: rows - 1 }, () => new Array(cols).fill(true));
  const wallV = Array.from({ length: rows }, () => new Array(cols - 1).fill(true));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const canN = r > 0, canW = c > 0;
      if (canN && canW) {
        if (rng.random() < 0.5) wallH[r - 1][c] = false; else wallV[r][c - 1] = false;
      } else if (canN) wallH[r - 1][c] = false;
      else if (canW) wallV[r][c - 1] = false;
    }
  }
  return { wallH, wallV };
}

function generateMazeSidewinder(cols: number, rows: number, rng: SeededRNG): MazeWalls {
  const wallH = Array.from({ length: rows - 1 }, () => new Array(cols).fill(true));
  const wallV = Array.from({ length: rows }, () => new Array(cols - 1).fill(true));
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    for (let c = 0; c < cols; c++) {
      if (r === 0) {
        if (c < cols - 1) wallV[r][c] = false; // first row: carve right
      } else {
        const closeRun = c === cols - 1 || rng.random() < 0.5;
        if (closeRun) {
          const pick = runStart + Math.floor(rng.random() * (c - runStart + 1));
          wallH[r - 1][pick] = false; // carve north from random cell in run
          runStart = c + 1;
        } else {
          wallV[r][c] = false; // carve east
        }
      }
    }
  }
  return { wallH, wallV };
}

function generateMaze(cols: number, rows: number, rng: SeededRNG, algorithm: string): MazeWalls {
  switch (algorithm) {
    case 'kruskal': return generateMazeKruskal(cols, rows, rng);
    case 'binary-tree': return generateMazeBinaryTree(cols, rows, rng);
    case 'sidewinder': return generateMazeSidewinder(cols, rows, rng);
    default: return generateMazeDFS(cols, rows, rng);
  }
}

// BFS from cell 0
function bfs(cols: number, rows: number, wallH: boolean[][], wallV: boolean[][]): Int32Array {
  const dist = new Int32Array(cols * rows).fill(-1);
  const q: number[] = [0];
  dist[0] = 0;
  const dx = [0, 1, 0, -1], dy = [-1, 0, 1, 0];
  let head = 0;
  while (head < q.length) {
    const curr = q[head++];
    const cx = curr % cols, cy = (curr / cols) | 0;
    for (let dir = 0; dir < 4; dir++) {
      const nx = cx + dx[dir], ny = cy + dy[dir];
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      let passable = false;
      if (dir === 0 && cy > 0) passable = !wallH[cy - 1][cx];
      else if (dir === 1 && cx < cols - 1) passable = !wallV[cy][cx];
      else if (dir === 2 && cy < rows - 1) passable = !wallH[cy][cx];
      else if (dir === 3 && cx > 0) passable = !wallV[cy][cx - 1];
      if (passable) {
        const ni = ny * cols + nx;
        if (dist[ni] === -1) { dist[ni] = dist[curr] + 1; q.push(ni); }
      }
    }
  }
  return dist;
}

// Reconstruct path from cell 0 to target using BFS distances
function solvePath(
  cols: number, rows: number, wallH: boolean[][], wallV: boolean[][],
  dist: Int32Array, target: number,
): number[] {
  const path: number[] = [target];
  let curr = target;
  const dx = [0, 1, 0, -1], dy = [-1, 0, 1, 0];
  while (curr !== 0) {
    const cx = curr % cols, cy = (curr / cols) | 0;
    for (let dir = 0; dir < 4; dir++) {
      const nx = cx + dx[dir], ny = cy + dy[dir];
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      let passable = false;
      if (dir === 0 && cy > 0) passable = !wallH[cy - 1][cx];
      else if (dir === 1 && cx < cols - 1) passable = !wallV[cy][cx];
      else if (dir === 2 && cy < rows - 1) passable = !wallH[cy][cx];
      else if (dir === 3 && cx > 0) passable = !wallV[cy][cx - 1];
      if (passable) {
        const ni = ny * cols + nx;
        if (dist[ni] === dist[curr] - 1) { path.push(ni); curr = ni; break; }
      }
    }
  }
  return path.reverse();
}

export const meanderMaze: Generator = {
  id: 'plotter-meander-maze',
  family: 'plotter',
  styleName: 'Meander / Maze Fill',
  definition: 'Space-filling paths via multiple maze algorithms or serpentine Greek-key meander',
  algorithmNotes:
    'Four maze algorithms: DFS (long corridors), Kruskal (uniform random), Binary Tree (diagonal bias), Sidewinder (horizontal runs). Wall styles: straight, rounded corners, or wobbly noise-perturbed. Optional cell fill heatmap by BFS distance and solution path overlay.',
  parameterSchema,
  defaultParams: {
    cellSize: 30, margin: 0.04, style: 'maze', algorithm: 'dfs',
    wallStyle: 'straight', showSolution: false, fillCells: false,
    lineWidth: 1.25, colorMode: 'palette-distance', background: 'cream',
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    ctx.fillStyle = BG[params.background] ?? BG.cream;
    ctx.fillRect(0, 0, w, h);

    const rng = new SeededRNG(seed);
    const noise = new SimplexNoise(seed);
    const isDark = params.background === 'dark';
    const colors = palette.colors.map(hexToRgb);

    const margin = Math.max(0, params.margin ?? 0.04);
    const mx = w * margin, my = h * margin;
    const availW = w - 2 * mx, availH = h - 2 * my;
    const cellSize = Math.max(8, params.cellSize ?? 30);
    const cols = Math.max(2, Math.floor(availW / cellSize));
    const rows = Math.max(2, Math.floor(availH / cellSize));
    const cw = availW / cols, ch = availH / rows;

    ctx.lineWidth = params.lineWidth ?? 1.25;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    const colorMode = params.colorMode || 'palette-distance';
    const wallStyle = params.wallStyle || 'straight';
    const algorithm = params.algorithm || 'dfs';
    const showSolution = params.showSolution ?? false;
    const fillCells = params.fillCells ?? false;
    const maxDist = cols + rows;

    function interpColor(t: number): [number, number, number] {
      const ct = Math.max(0, Math.min(1, t)) * (colors.length - 1);
      const i0 = Math.floor(ct), i1 = Math.min(colors.length - 1, i0 + 1);
      const f = ct - i0;
      return [
        (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
        (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
        (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
      ];
    }

    function getColor(col: number, row: number, dist: number): string {
      let cr: number, cg: number, cb: number;
      if (colorMode === 'monochrome') {
        [cr, cg, cb] = isDark ? [220, 220, 220] : [30, 30, 30];
      } else if (colorMode === 'palette-distance') {
        [cr, cg, cb] = interpColor(dist / maxDist);
      } else if (colorMode === 'palette-zone') {
        [cr, cg, cb] = interpColor(col / cols * 0.5 + row / rows * 0.5);
      } else {
        const nv = noise.fbm(col / cols * 3 + 5, row / rows * 3 + 5, 3, 2, 0.5);
        [cr, cg, cb] = interpColor(Math.max(0, nv * 0.5 + 0.5));
      }
      return `rgba(${cr},${cg},${cb},${isDark ? 0.85 : 0.82})`;
    }

    // Wobbly wall helper: perturb midpoint with noise
    function drawWall(x1: number, y1: number, x2: number, y2: number, col: number, row: number, dist: number) {
      ctx.strokeStyle = getColor(col, row, dist);

      if (wallStyle === 'rounded') {
        // Use a slight curve through a noise-offset midpoint
        const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
        const n1 = noise.noise2D(col * 0.7 + row * 0.3, row * 0.7 + col * 0.3);
        const off = (params.lineWidth ?? 1.25) * 1.5;
        // Perpendicular offset
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const px = -dy / len, py = dx / len;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(midX + px * n1 * off, midY + py * n1 * off, x2, y2);
        ctx.stroke();
      } else if (wallStyle === 'wobbly') {
        // Multi-point wobbly line
        const steps = 6;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const px = -dy / len, py = dx / len;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const bx = x1 + dx * t, by = y1 + dy * t;
          const n1 = noise.noise2D(bx * 0.03 + seed * 0.001, by * 0.03);
          const wobble = n1 * cellSize * 0.15;
          if (s < steps) ctx.lineTo(bx + px * wobble, by + py * wobble);
          else ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    const style = params.style || 'maze';

    // Animation: progressive reveal — cycle every 8 seconds then hold
    const cycleDuration = 8;
    const reveal = time > 0 ? Math.min(1, (time % (cycleDuration * 1.25)) / cycleDuration) : 1;

    if (style === 'maze') {
      const { wallH, wallV } = generateMaze(cols, rows, rng, algorithm);
      const dist = bfs(cols, rows, wallH, wallV);
      const maxBFS = Math.max(1, ...Array.from(dist));

      // Collect all walls with their BFS distance for progressive reveal
      type WallEntry = { x1: number; y1: number; x2: number; y2: number; col: number; row: number; d: number };
      const walls: WallEntry[] = [];
      for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols; col++) {
          if (wallH[row][col]) {
            const d = dist[row * cols + col];
            walls.push({
              x1: mx + col * cw, y1: my + (row + 1) * ch,
              x2: mx + (col + 1) * cw, y2: my + (row + 1) * ch,
              col, row, d: d >= 0 ? d : 0,
            });
          }
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols - 1; col++) {
          if (wallV[row][col]) {
            const d = dist[row * cols + col];
            walls.push({
              x1: mx + (col + 1) * cw, y1: my + row * ch,
              x2: mx + (col + 1) * cw, y2: my + (row + 1) * ch,
              col, row, d: d >= 0 ? d : 0,
            });
          }
        }
      }
      const wallsToDraw = Math.ceil(walls.length * reveal);

      // Fill cells with color heatmap (only revealed cells)
      if (fillCells) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const d = dist[r * cols + c];
            if (d < 0) continue;
            if (d / maxBFS > reveal) continue;
            const t = d / maxBFS;
            const [cr, cg, cb] = interpColor(t);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.25 : 0.18})`;
            ctx.fillRect(mx + c * cw, my + r * ch, cw, ch);
          }
        }
      }

      // Outer border
      ctx.strokeStyle = getColor(0, 0, 0);
      ctx.strokeRect(mx, my, availW, availH);

      // Draw walls progressively
      for (let i = 0; i < wallsToDraw; i++) {
        const wl = walls[i];
        drawWall(wl.x1, wl.y1, wl.x2, wl.y2, wl.col, wl.row, wl.d);
      }

      // Solution path overlay (only when fully revealed)
      if (showSolution && reveal >= 1) {
        const target = (rows - 1) * cols + (cols - 1);
        if (dist[target] >= 0) {
          const path = solvePath(cols, rows, wallH, wallV, dist, target);
          ctx.lineWidth = (params.lineWidth ?? 1.25) * 2.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = isDark
            ? 'rgba(255, 100, 100, 0.7)'
            : 'rgba(220, 40, 40, 0.55)';
          ctx.beginPath();
          for (let i = 0; i < path.length; i++) {
            const px = mx + (path[i] % cols + 0.5) * cw;
            const py = my + (((path[i] / cols) | 0) + 0.5) * ch;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.lineWidth = params.lineWidth ?? 1.25;
        }
      }
    } else {
      // Meander: boustrophedon serpentine path through a maze grid
      const { wallH, wallV } = generateMaze(cols, rows, rng, algorithm);
      const dist = bfs(cols, rows, wallH, wallV);
      const maxBFS = Math.max(1, ...Array.from(dist));

      // Fill cells with color heatmap (only revealed cells)
      if (fillCells) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const d = dist[r * cols + c];
            if (d < 0) continue;
            if (d / maxBFS > reveal) continue;
            const t = d / maxBFS;
            const [cr, cg, cb] = interpColor(t);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${isDark ? 0.25 : 0.18})`;
            ctx.fillRect(mx + c * cw, my + r * ch, cw, ch);
          }
        }
      }

      // Build the boustrophedon serpentine path
      type Pt = [number, number, number, number];
      const path: Pt[] = [];
      for (let row = 0; row < rows; row++) {
        const y = my + (row + 0.5) * ch;
        if (row % 2 === 0) {
          for (let col = 0; col <= cols; col++)
            path.push([mx + col * cw, y, Math.min(col, cols - 1), row]);
        } else {
          for (let col = cols; col >= 0; col--)
            path.push([mx + col * cw, y, Math.max(col, 0), row]);
        }
        if (row < rows - 1) {
          const col = row % 2 === 0 ? cols - 1 : 0;
          const x = row % 2 === 0 ? mx + cols * cw : mx;
          path.push([x, my + (row + 1.5) * ch, col, row + 1]);
        }
      }

      // Draw meander path progressively using drawWall (respects wallStyle)
      const segsToDraw = Math.ceil((path.length - 1) * reveal);
      for (let i = 1; i <= segsToDraw; i++) {
        const [x1, y1, c1, r1] = path[i - 1];
        const [x2, y2] = path[i];
        const d = dist[r1 * cols + c1];
        drawWall(x1, y1, x2, y2, c1, r1, d >= 0 ? d : 0);
      }

      // Draw maze walls on top of the meander path (uses wallStyle)
      ctx.globalAlpha = isDark ? 0.3 : 0.2;
      for (let row = 0; row < rows - 1; row++) {
        for (let col = 0; col < cols; col++) {
          if (wallH[row][col]) {
            // Only draw wall if the meander has reached this row
            if ((row + 1) / rows > reveal) continue;
            const d = dist[row * cols + col];
            drawWall(
              mx + col * cw, my + (row + 1) * ch,
              mx + (col + 1) * cw, my + (row + 1) * ch,
              col, row, d >= 0 ? d : 0,
            );
          }
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols - 1; col++) {
          if (wallV[row][col]) {
            if ((row + 1) / rows > reveal) continue;
            const d = dist[row * cols + col];
            drawWall(
              mx + (col + 1) * cw, my + row * ch,
              mx + (col + 1) * cw, my + (row + 1) * ch,
              col, row, d >= 0 ? d : 0,
            );
          }
        }
      }
      ctx.globalAlpha = 1.0;

      // Outer border
      ctx.strokeStyle = getColor(0, 0, 0);
      ctx.strokeRect(mx, my, availW, availH);

      // Solution path overlay (only when fully revealed)
      if (showSolution && reveal >= 1) {
        const target = (rows - 1) * cols + (cols - 1);
        if (dist[target] >= 0) {
          const solPath = solvePath(cols, rows, wallH, wallV, dist, target);
          ctx.lineWidth = (params.lineWidth ?? 1.25) * 2.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = isDark
            ? 'rgba(255, 100, 100, 0.7)'
            : 'rgba(220, 40, 40, 0.55)';
          ctx.beginPath();
          for (let i = 0; i < solPath.length; i++) {
            const px = mx + (solPath[i] % cols + 0.5) * cw;
            const py = my + (((solPath[i] / cols) | 0) + 0.5) * ch;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.lineWidth = params.lineWidth ?? 1.25;
        }
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.95, 0.92, 0.86, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    const cell = params.cellSize ?? 30;
    return (Math.ceil(1000 / cell) ** 2 * 0.2) | 0;
  },
};
