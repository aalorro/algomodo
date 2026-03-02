import type { Generator, Palette, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteColorByAngle(angle: number, palette: Palette): string {
  // Map angle [0, 2π] → palette index
  const t = (angle / (Math.PI * 2) + 1) % 1;
  const idx = Math.floor(t * palette.colors.length) % palette.colors.length;
  return palette.colors[idx];
}

function paletteColorByMagnitude(t: number, palette: Palette): string {
  const idx = Math.floor(Math.min(0.999, t) * palette.colors.length);
  return palette.colors[idx];
}

function lerpHex(hexA: string, hexB: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(hexA);
  const [br, bg, bb] = hexToRgb(hexB);
  const r = (ar + (br - ar) * t) | 0;
  const g = (ag + (bg - ag) * t) | 0;
  const b = (ab + (bb - ab) * t) | 0;
  return `rgb(${r},${g},${b})`;
}

const parameterSchema: ParameterSchema = {
  gridSpacing: {
    name: 'Grid Spacing',
    type: 'number',
    min: 6,
    max: 60,
    step: 2,
    default: 16,
    help: 'Distance between flow sample points',
    group: 'Composition',
  },
  flowLength: {
    name: 'Flow Length',
    type: 'number',
    min: 0.5,
    max: 6,
    step: 0.25,
    default: 2.0,
    help: 'Line length multiplier relative to grid spacing',
    group: 'Geometry',
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
  displayMode: {
    name: 'Display Mode',
    type: 'select',
    options: ['lines', 'arrows', 'streamlines'],
    default: 'lines',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['direction', 'magnitude', 'palette-blend'],
    default: 'direction',
    help: 'direction = hue by angle, magnitude = brightness by strength, palette-blend = mix palette colors by angle',
    group: 'Color',
  },
  showSource: {
    name: 'Show Source',
    type: 'boolean',
    default: true,
    help: 'Draw the source image dimmed behind the flow field',
    group: 'Composition',
  },
  sourceDim: {
    name: 'Source Dim',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.25,
    help: 'Opacity of the background source image',
    group: 'Color',
  },
  threshold: {
    name: 'Gradient Threshold',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.05,
    help: 'Minimum gradient magnitude to draw a line',
    group: 'Texture',
  },
};

export const opticalFlow: Generator = {
  id: 'optical-flow',
  family: 'image',
  styleName: 'Optical Flow',
  definition: 'Visualises image gradients as a vector flow field — each line points along the strongest brightness change at that location',
  algorithmNotes: 'Computes per-pixel Sobel gradients (∂L/∂x, ∂L/∂y) from the luminance channel, samples on a regular grid, and draws oriented lines/arrows whose angle encodes gradient direction and length encodes magnitude.',
  parameterSchema,
  defaultParams: {
    gridSpacing: 16,
    flowLength: 2.0,
    lineWidth: 1,
    displayMode: 'lines',
    colorMode: 'direction',
    showSource: true,
    sourceDim: 0.25,
    threshold: 0.05,
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

    const { gridSpacing, flowLength, lineWidth, displayMode, colorMode, showSource, sourceDim, threshold } = params;

    // Draw image to offscreen
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const offCtx = off.getContext('2d')!;
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    offCtx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const src = offCtx.getImageData(0, 0, w, h).data;

    // Compute luminance channel
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const b = i * 4;
      lum[i] = (0.299 * src[b] + 0.587 * src[b + 1] + 0.114 * src[b + 2]) / 255;
    }

    const lumAt = (x: number, y: number) => {
      const xi = Math.max(0, Math.min(w - 1, x | 0));
      const yi = Math.max(0, Math.min(h - 1, y | 0));
      return lum[yi * w + xi];
    };

    // Optional: draw source image dimmed
    if (showSource && sourceDim > 0) {
      ctx.globalAlpha = sourceDim;
      ctx.drawImage(off, 0, 0);
      ctx.globalAlpha = 1;
    }

    const gs = Math.max(6, gridSpacing | 0);
    const halfGs = gs / 2;
    ctx.lineWidth = lineWidth;

    // Track max magnitude for normalisation pass
    type FlowPoint = { x: number; y: number; dx: number; dy: number; mag: number; angle: number };
    const points: FlowPoint[] = [];
    let maxMag = 0;

    for (let gy = halfGs; gy < h; gy += gs) {
      for (let gx = halfGs; gx < w; gx += gs) {
        // Sobel gradient at this point
        const dx =
          -lumAt(gx - 1, gy - 1) + lumAt(gx + 1, gy - 1) +
          -2 * lumAt(gx - 1, gy) + 2 * lumAt(gx + 1, gy) +
          -lumAt(gx - 1, gy + 1) + lumAt(gx + 1, gy + 1);

        const dy =
          -lumAt(gx - 1, gy - 1) - 2 * lumAt(gx, gy - 1) - lumAt(gx + 1, gy - 1) +
          lumAt(gx - 1, gy + 1) + 2 * lumAt(gx, gy + 1) + lumAt(gx + 1, gy + 1);

        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag > maxMag) maxMag = mag;
        const angle = Math.atan2(dy, dx);
        points.push({ x: gx, y: gy, dx, dy, mag, angle });
      }
    }

    if (maxMag === 0) return;

    for (const { x, y, dx, dy, mag, angle } of points) {
      const normMag = mag / maxMag;
      if (normMag < threshold) continue;

      const len = normMag * gs * flowLength;
      const nx = dx / mag;
      const ny = dy / mag;

      // Pick color
      let color: string;
      if (colorMode === 'direction') {
        // HSL: hue by angle
        const hue = ((angle / (Math.PI * 2)) * 360 + 360) % 360;
        const lightness = 40 + normMag * 40;
        color = `hsl(${hue | 0},80%,${lightness | 0}%)`;
      } else if (colorMode === 'magnitude') {
        const v = (normMag * 255) | 0;
        color = `rgb(${v},${v},${v})`;
      } else {
        // palette-blend: interpolate between two palette colors by angle
        const t = ((angle / (Math.PI * 2)) + 1) % 1;
        const idx0 = Math.floor(t * palette.colors.length) % palette.colors.length;
        const idx1 = (idx0 + 1) % palette.colors.length;
        const frac = (t * palette.colors.length) % 1;
        color = lerpHex(palette.colors[idx0], palette.colors[idx1], frac);
      }

      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      const ex = x + nx * len;
      const ey = y + ny * len;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      if (displayMode === 'arrows') {
        // Arrowhead
        const headLen = Math.max(3, len * 0.35);
        const headAngle = 0.45;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - headLen * Math.cos(angle - headAngle),
          ey - headLen * Math.sin(angle - headAngle),
        );
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - headLen * Math.cos(angle + headAngle),
          ey - headLen * Math.sin(angle + headAngle),
        );
        ctx.stroke();
      } else if (displayMode === 'streamlines') {
        // Trace a short streamline by walking along the gradient field
        let cx = x, cy = y;
        const steps = 4;
        const stepLen = len / steps;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 0; s < steps; s++) {
          const fdx =
            -lumAt(cx - 1, cy - 1) + lumAt(cx + 1, cy - 1) +
            -2 * lumAt(cx - 1, cy) + 2 * lumAt(cx + 1, cy) +
            -lumAt(cx - 1, cy + 1) + lumAt(cx + 1, cy + 1);
          const fdy =
            -lumAt(cx - 1, cy - 1) - 2 * lumAt(cx, cy - 1) - lumAt(cx + 1, cy - 1) +
            lumAt(cx - 1, cy + 1) + 2 * lumAt(cx, cy + 1) + lumAt(cx + 1, cy + 1);
          const fm = Math.sqrt(fdx * fdx + fdy * fdy) || 1;
          cx += (fdx / fm) * stepLen;
          cy += (fdy / fm) * stepLen;
          cx = Math.max(0, Math.min(w - 1, cx));
          cy = Math.max(0, Math.min(h - 1, cy));
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) { return Math.round(5000 / ((params.gridSpacing || 16) ** 2) * 100); },
};
