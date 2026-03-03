import type { Generator, Palette, ParameterSchema } from '../../types';

// ─── Source image pixel cache ─────────────────────────────────────────────────
const _imgCache = new WeakMap<HTMLImageElement, { w: number; h: number; data: Uint8ClampedArray }>();
function getSourcePixels(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const c = _imgCache.get(img);
  if (c && c.w === w && c.h === h) return c.data;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const offCtx = off.getContext('2d')!;
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  offCtx.drawImage(img, (w - img.naturalWidth * scale) / 2, (h - img.naturalHeight * scale) / 2,
    img.naturalWidth * scale, img.naturalHeight * scale);
  const data = new Uint8ClampedArray(offCtx.getImageData(0, 0, w, h).data);
  _imgCache.set(img, { w, h, data });
  return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearestPaletteColor(r: number, g: number, b: number, palette: Palette): [number, number, number] {
  let best = hexToRgb(palette.colors[0]);
  let bestDist = Infinity;
  for (const c of palette.colors) {
    const [pr, pg, pb] = hexToRgb(c);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) { bestDist = d; best = [pr, pg, pb]; }
  }
  return best;
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    (a[0] + (b[0] - a[0]) * t) | 0,
    (a[1] + (b[1] - a[1]) * t) | 0,
    (a[2] + (b[2] - a[2]) * t) | 0,
  ];
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  gridSize: {
    name: 'Grid Size',
    type: 'number',
    min: 4,
    max: 80,
    step: 2,
    default: 20,
    help: 'Number of mesh columns and rows',
    group: 'Composition',
  },
  meshType: {
    name: 'Mesh Type',
    type: 'select',
    options: ['wireframe', 'filled', 'dots'],
    default: 'wireframe',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['palette', 'original', 'luma'],
    default: 'palette',
    group: 'Color',
  },
  lineWidth: {
    name: 'Line Width',
    type: 'number',
    min: 0.5,
    max: 4,
    step: 0.5,
    default: 1,
    group: 'Geometry',
  },
  lumaContrast: {
    name: 'Luma Contrast',
    type: 'number',
    min: 0.5,
    max: 3,
    step: 0.1,
    default: 1.2,
    help: 'Boost contrast of luminance before color mapping',
    group: 'Texture',
  },
  opacity: {
    name: 'Opacity',
    type: 'number',
    min: 0.1,
    max: 1,
    step: 0.05,
    default: 0.85,
    group: 'Color',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 2,
    step: 0.1,
    default: 0.5,
    help: 'Speed of the vertex displacement wave',
    group: 'Flow/Motion',
  },
  waveAmp: {
    name: 'Wave Amplitude',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.35,
    help: 'Maximum vertex displacement as a fraction of cell size',
    group: 'Flow/Motion',
  },
};

export const lumaMesh: Generator = {
  id: 'luma-mesh',
  family: 'image',
  styleName: 'Luma Mesh',
  definition: 'Triangulates the image into a low-poly mesh where each face is colored by the luminance of the source pixels',
  algorithmNotes: 'Samples the image on a regular grid, computes per-vertex luminance, then fills each triangle with the average palette color of its three vertices. During animation each vertex is displaced by a compound sine wave (different frequency and phase per axis and grid position), producing a fluid, organic rippling of the mesh geometry.',
  parameterSchema,
  defaultParams: {
    gridSize: 20,
    meshType: 'wireframe',
    colorMode: 'palette',
    lineWidth: 1,
    lumaContrast: 1.2,
    opacity: 0.85,
    animSpeed: 0.5,
    waveAmp: 0.35,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, _seed, palette, _quality, time = 0) {
    const img: HTMLImageElement | undefined = params._sourceImage;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    if (!img) {
      const fs = Math.round(w * 0.022);
      ctx.textAlign = 'center';
      ctx.font = `600 ${fs}px sans-serif`;
      ctx.fillStyle = '#aaa';
      ctx.fillText('Drag and drop your file here', w / 2, h / 2 - fs * 0.8);
      ctx.font = `${fs}px sans-serif`;
      ctx.fillStyle = '#666';
      ctx.fillText('or copy and paste (Ctrl+V) here', w / 2, h / 2 + fs * 0.8);
      ctx.textAlign = 'left';
      return;
    }

    const { gridSize, meshType, colorMode, lineWidth, lumaContrast, opacity } = params;
    const animSpeed = params.animSpeed ?? 0.5;
    const waveAmp   = params.waveAmp   ?? 0.35;
    const cols = Math.max(2, gridSize | 0);
    const rows = Math.max(2, gridSize | 0);
    const t = time * animSpeed;

    const src = getSourcePixels(img, w, h);

    const cellW = w / cols;
    const cellH = h / rows;
    const dispX  = cellW * waveAmp;
    const dispY  = cellH * waveAmp;

    type Vertex = { x: number; y: number; r: number; g: number; b: number; luma: number };
    const verts: Vertex[][] = [];

    for (let row = 0; row <= rows; row++) {
      verts[row] = [];
      for (let col = 0; col <= cols; col++) {
        // Grid position with sinusoidal displacement for animation
        const baseX = col * cellW;
        const baseY = row * cellH;
        const x = baseX + Math.sin(t * 1.3 + row * 0.55 + col * 0.3) * dispX;
        const y = baseY + Math.cos(t       + col * 0.4  + row * 0.2) * dispY;

        // Sample source pixel at the undisplaced grid position for stable colors
        const px = Math.max(0, Math.min(w - 1, baseX | 0));
        const py = Math.max(0, Math.min(h - 1, baseY | 0));
        const i = (py * w + px) * 4;
        const r = src[i], g = src[i + 1], b = src[i + 2];
        const luma = Math.min(1, ((0.299 * r + 0.587 * g + 0.114 * b) / 255) ** (1 / lumaContrast));
        verts[row][col] = { x, y, r, g, b, luma };
      }
    }

    const getColor = (v: Vertex): [number, number, number] => {
      if (colorMode === 'original') return [v.r, v.g, v.b];
      if (colorMode === 'luma') {
        const l = (v.luma * 255) | 0;
        return [l, l, l];
      }
      return nearestPaletteColor(v.r, v.g, v.b, palette);
    };

    ctx.globalAlpha = opacity;
    ctx.lineWidth = lineWidth;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tl = verts[row][col];
        const tr = verts[row][col + 1];
        const bl = verts[row + 1][col];
        const br = verts[row + 1][col + 1];

        const triangles: [Vertex, Vertex, Vertex][] = [
          [tl, tr, bl],
          [tr, br, bl],
        ];

        for (const [a, b, c] of triangles) {
          const ca = getColor(a);
          const cb = getColor(b);
          const cc = getColor(c);
          const avgColor = lerpColor(lerpColor(ca, cb, 0.5), cc, 0.333);

          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.closePath();

          if (meshType === 'filled') {
            ctx.fillStyle = `rgb(${avgColor[0]},${avgColor[1]},${avgColor[2]})`;
            ctx.fill();
          } else if (meshType === 'wireframe') {
            ctx.strokeStyle = `rgb(${avgColor[0]},${avgColor[1]},${avgColor[2]})`;
            ctx.stroke();
          } else if (meshType === 'dots') {
            for (const v of [a, b, c]) {
              const vc = getColor(v);
              ctx.beginPath();
              ctx.arc(v.x, v.y, lineWidth * 1.5, 0, Math.PI * 2);
              ctx.fillStyle = `rgb(${vc[0]},${vc[1]},${vc[2]})`;
              ctx.fill();
            }
          }
        }
      }
    }

    ctx.globalAlpha = 1;
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(params.gridSize ** 2 / 5); },
};
