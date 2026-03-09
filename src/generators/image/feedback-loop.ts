import type { Generator, ParameterSchema } from '../../types';

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  iterations: {
    name: 'Iterations',
    type: 'number',
    min: 1,
    max: 20,
    step: 1,
    default: 8,
    help: 'Number of feedback iterations',
    group: 'Composition',
  },
  zoomAmount: {
    name: 'Zoom',
    type: 'number',
    min: 0.9,
    max: 1.1,
    step: 0.005,
    default: 1.02,
    help: 'Scale factor per iteration',
    group: 'Geometry',
  },
  rotateAngle: {
    name: 'Rotation',
    type: 'number',
    min: -15,
    max: 15,
    step: 0.5,
    default: 3,
    help: 'Rotation angle in degrees per iteration',
    group: 'Geometry',
  },
  shiftX: {
    name: 'Shift X',
    type: 'number',
    min: -20,
    max: 20,
    step: 1,
    default: 0,
    help: 'Horizontal pixel shift per iteration',
    group: 'Geometry',
  },
  shiftY: {
    name: 'Shift Y',
    type: 'number',
    min: -20,
    max: 20,
    step: 1,
    default: 0,
    help: 'Vertical pixel shift per iteration',
    group: 'Geometry',
  },
  mirror: {
    name: 'Mirror Fold',
    type: 'select',
    options: ['none', 'horizontal', 'vertical', 'kaleidoscope'],
    default: 'none',
    help: 'none: normal · horizontal/vertical: flip alternating iterations · kaleidoscope: 4-fold symmetry fold',
    group: 'Geometry',
  },
  blendMode: {
    name: 'Blend Mode',
    type: 'select',
    options: ['lighter', 'multiply', 'screen', 'overlay', 'difference', 'exclusion', 'color-dodge', 'hard-light'],
    default: 'lighter',
    group: 'Color',
  },
  decay: {
    name: 'Decay',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.85,
    help: 'RGB brightness multiplier per iteration (lower = faster fade)',
    group: 'Color',
  },
  colorShift: {
    name: 'Color Shift',
    type: 'select',
    options: ['none', 'hue-rotate', 'palette-tint'],
    default: 'hue-rotate',
    help: 'none: no color change · hue-rotate: shift hue per iteration · palette-tint: tint with palette colors',
    group: 'Color',
  },
  chromatic: {
    name: 'Chromatic Aberration',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.1,
    default: 0,
    help: 'Offset RGB channels per iteration for a prismatic fringing effect',
    group: 'Texture',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number',
    min: 0.1,
    max: 3,
    step: 0.1,
    default: 1,
    help: 'Controls oscillation speed of rotation and zoom during animation',
    group: 'Flow/Motion',
  },
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const feedbackLoop: Generator = {
  id: 'feedback-loop',
  family: 'image',
  styleName: 'Feedback Loop',
  definition: 'Creates fractal-like recursive imagery by repeatedly compositing the source image with geometric transforms and blending',
  algorithmNotes: 'Uses offscreen canvas double-buffering with hardware-accelerated 2D transforms. Each iteration applies translate-rotate-scale-shift, optional mirror folding, optional decay, palette tinting or hue rotation, chromatic aberration, and compositing with a configurable blend mode. Animation sinusoidally oscillates rotation and zoom.',
  parameterSchema,
  defaultParams: {
    iterations: 8,
    zoomAmount: 1.02,
    rotateAngle: 3,
    shiftX: 0,
    shiftY: 0,
    mirror: 'none',
    blendMode: 'lighter',
    decay: 0.85,
    colorShift: 'hue-rotate',
    chromatic: 0,
    animSpeed: 1,
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

    const iterations = Math.max(1, Math.min(20, params.iterations | 0));
    const blendMode: GlobalCompositeOperation = params.blendMode ?? 'lighter';
    const decay = params.decay ?? 0.85;
    const colorShift = params.colorShift ?? 'hue-rotate';
    const mirror = params.mirror ?? 'none';
    const chromatic = params.chromatic ?? 0;
    const animSpeed = params.animSpeed ?? 1;
    const t = time * animSpeed;
    const palColors = palette.colors.map(hexToRgb);

    // Animate rotation and zoom with richer oscillation
    const baseRotate = (params.rotateAngle ?? 3) * Math.PI / 180;
    const baseZoom = params.zoomAmount ?? 1.02;
    const rotate = baseRotate * (1 + 0.3 * Math.sin(t * 0.7) + 0.1 * Math.sin(t * 1.3));
    const zoom = baseZoom + 0.01 * Math.sin(t * 0.5) + 0.005 * Math.sin(t * 0.9);
    const shiftX = (params.shiftX ?? 0) + (time > 0 ? 2 * Math.sin(t * 0.35) : 0);
    const shiftY = (params.shiftY ?? 0) + (time > 0 ? 2 * Math.cos(t * 0.28) : 0);

    // Create two offscreen canvases for double-buffering
    const offA = document.createElement('canvas');
    offA.width = w; offA.height = h;
    const ctxA = offA.getContext('2d')!;

    const offB = document.createElement('canvas');
    offB.width = w; offB.height = h;
    const ctxB = offB.getContext('2d')!;

    // Draw source into buffer A (cover-fit)
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    ctxA.drawImage(img,
      (w - img.naturalWidth * scale) / 2,
      (h - img.naturalHeight * scale) / 2,
      img.naturalWidth * scale,
      img.naturalHeight * scale
    );

    // Apply initial mirror fold to source
    if (mirror === 'kaleidoscope') {
      applyKaleidoscopeFold(ctxA, w, h);
    }

    // Accumulator on the main context
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(offA, 0, 0);

    const cxc = w / 2;
    const cyc = h / 2;

    for (let i = 0; i < iterations; i++) {
      // Apply transform: draw A onto B with transform
      ctxB.clearRect(0, 0, w, h);
      ctxB.save();
      ctxB.translate(cxc, cyc);
      ctxB.rotate(rotate);
      ctxB.scale(zoom, zoom);

      // Mirror fold on alternating iterations
      if (mirror === 'horizontal' && i % 2 === 1) {
        ctxB.scale(-1, 1);
      } else if (mirror === 'vertical' && i % 2 === 1) {
        ctxB.scale(1, -1);
      }

      ctxB.translate(-cxc + shiftX, -cyc + shiftY);
      ctxB.drawImage(offA, 0, 0);
      ctxB.restore();

      // Apply kaleidoscope fold after transform
      if (mirror === 'kaleidoscope') {
        applyKaleidoscopeFold(ctxB, w, h);
      }

      // Apply decay + chromatic aberration + palette tinting (all pixel-level)
      if (decay < 1 || chromatic > 0 || colorShift === 'palette-tint') {
        const imageData = ctxB.getImageData(0, 0, w, h);
        const d = imageData.data;

        // Chromatic aberration: offset R and B channels
        if (chromatic > 0) {
          const offset = Math.round((i + 1) * chromatic * 3);
          if (offset > 0) {
            // Shift red channel right and blue channel left
            for (let py = 0; py < h; py++) {
              const rowStart = py * w * 4;
              // Shift red right
              for (let px = w - 1; px >= offset; px--) {
                d[rowStart + px * 4] = d[rowStart + (px - offset) * 4];
              }
              // Shift blue left
              for (let px = 0; px < w - offset; px++) {
                d[rowStart + px * 4 + 2] = d[rowStart + (px + offset) * 4 + 2];
              }
            }
          }
        }

        // Decay and palette tinting
        for (let j = 0; j < d.length; j += 4) {
          if (decay < 1) {
            d[j]     = d[j] * decay;
            d[j + 1] = d[j + 1] * decay;
            d[j + 2] = d[j + 2] * decay;
          }
          // Palette tint: blend pixel color toward palette color for this iteration
          if (colorShift === 'palette-tint') {
            const [pr, pg, pb] = palColors[i % palColors.length];
            const tintStrength = 0.15;
            d[j]     = d[j] * (1 - tintStrength) + pr * tintStrength;
            d[j + 1] = d[j + 1] * (1 - tintStrength) + pg * tintStrength;
            d[j + 2] = d[j + 2] * (1 - tintStrength) + pb * tintStrength;
          }
        }

        ctxB.putImageData(imageData, 0, 0);
      }

      // Apply hue rotation via CSS filter on composite
      if (colorShift === 'hue-rotate') {
        ctxB.save();
        ctxB.globalCompositeOperation = 'source-atop';
        ctxB.filter = `hue-rotate(${(i + 1) * 15}deg)`;
        ctxB.drawImage(offB, 0, 0);
        ctxB.restore();
      }

      // Composite into main canvas
      ctx.save();
      ctx.globalCompositeOperation = blendMode;
      ctx.drawImage(offB, 0, 0);
      ctx.restore();

      // Feed B back into A
      ctxA.clearRect(0, 0, w, h);
      ctxA.drawImage(offB, 0, 0);
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.07, 0.07, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    const iterations = params.iterations ?? 8;
    return 300 + iterations * 80;
  },
};

/** Apply 4-fold symmetry: mirror left→right and top→bottom */
function applyKaleidoscopeFold(tctx: CanvasRenderingContext2D, w: number, h: number) {
  const hw = w / 2, hh = h / 2;
  // Take top-left quadrant and mirror it into all four
  const quadrant = tctx.getImageData(0, 0, hw, hh);

  // Create a temp canvas for the quadrant
  const tmp = document.createElement('canvas');
  tmp.width = hw; tmp.height = hh;
  const tmpCtx = tmp.getContext('2d')!;
  tmpCtx.putImageData(quadrant, 0, 0);

  // Clear and redraw with mirroring
  tctx.clearRect(0, 0, w, h);

  // Top-left: original
  tctx.drawImage(tmp, 0, 0);

  // Top-right: horizontal flip
  tctx.save();
  tctx.translate(w, 0);
  tctx.scale(-1, 1);
  tctx.drawImage(tmp, 0, 0);
  tctx.restore();

  // Bottom-left: vertical flip
  tctx.save();
  tctx.translate(0, h);
  tctx.scale(1, -1);
  tctx.drawImage(tmp, 0, 0);
  tctx.restore();

  // Bottom-right: both flips
  tctx.save();
  tctx.translate(w, h);
  tctx.scale(-1, -1);
  tctx.drawImage(tmp, 0, 0);
  tctx.restore();
}
