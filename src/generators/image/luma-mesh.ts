import type { Generator, Palette, ParameterSchema } from '../../types';

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
};

export const lumaMesh: Generator = {
  id: 'luma-mesh',
  family: 'image',
  styleName: 'Luma Mesh',
  definition: 'Triangulates the image into a low-poly mesh where each face is colored by the luminance of the source pixels',
  algorithmNotes: 'Samples the image on a regular grid, computes per-vertex luminance, then fills each triangle with the average palette color of its three vertices. Wireframe mode draws triangle edges only.',
  parameterSchema,
  defaultParams: {
    gridSize: 20,
    meshType: 'wireframe',
    colorMode: 'palette',
    lineWidth: 1,
    lumaContrast: 1.2,
    opacity: 0.85,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderCanvas2D(ctx, params, _seed, palette, _quality) {
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
    const cols = Math.max(2, gridSize | 0);
    const rows = Math.max(2, gridSize | 0);

    // Draw image to offscreen
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const offCtx = off.getContext('2d')!;
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    offCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const src = offCtx.getImageData(0, 0, w, h).data;

    // Build vertex grid: sample color at each grid point
    const cellW = w / cols;
    const cellH = h / rows;

    // vertex[row][col] → { x, y, r, g, b, luma }
    type Vertex = { x: number; y: number; r: number; g: number; b: number; luma: number };
    const verts: Vertex[][] = [];

    for (let row = 0; row <= rows; row++) {
      verts[row] = [];
      for (let col = 0; col <= cols; col++) {
        const x = col * cellW;
        const y = row * cellH;
        const px = Math.max(0, Math.min(w - 1, x | 0));
        const py = Math.max(0, Math.min(h - 1, y | 0));
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

        // Two triangles per cell: TL-TR-BL and TR-BR-BL
        const triangles: [Vertex, Vertex, Vertex][] = [
          [tl, tr, bl],
          [tr, br, bl],
        ];

        for (const [a, b, c] of triangles) {
          const ca = getColor(a);
          const cb = getColor(b);
          const cc = getColor(c);
          // Average color for fill
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
