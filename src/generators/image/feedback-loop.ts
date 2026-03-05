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
  blendMode: {
    name: 'Blend Mode',
    type: 'select',
    options: ['lighter', 'multiply', 'screen', 'overlay'],
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
    type: 'boolean',
    default: true,
    help: 'Apply a hue rotation each iteration',
    group: 'Color',
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

export const feedbackLoop: Generator = {
  id: 'feedback-loop',
  family: 'image',
  styleName: 'Feedback Loop',
  definition: 'Creates fractal-like recursive imagery by repeatedly compositing the source image with geometric transforms and blending',
  algorithmNotes: 'Uses offscreen canvas double-buffering with hardware-accelerated 2D transforms. Each iteration applies translate-rotate-scale-shift, optional decay (pixel-level brightness reduction), optional hue rotation, and compositing with a configurable blend mode. Animation sinusoidally oscillates rotation and zoom.',
  parameterSchema,
  defaultParams: {
    iterations: 8,
    zoomAmount: 1.02,
    rotateAngle: 3,
    shiftX: 0,
    shiftY: 0,
    blendMode: 'lighter',
    decay: 0.85,
    colorShift: true,
    animSpeed: 1,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, _seed, _palette, _quality, time = 0) {
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
    const doColorShift = params.colorShift ?? true;
    const animSpeed = params.animSpeed ?? 1;
    const t = time * animSpeed;

    // Animate rotation and zoom
    const baseRotate = (params.rotateAngle ?? 3) * Math.PI / 180;
    const baseZoom = params.zoomAmount ?? 1.02;
    const rotate = baseRotate * (1 + 0.3 * Math.sin(t * 0.7));
    const zoom = baseZoom + 0.01 * Math.sin(t * 0.5);
    const shiftX = params.shiftX ?? 0;
    const shiftY = params.shiftY ?? 0;

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

    // Accumulator on the main context
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(offA, 0, 0);

    const cx = w / 2;
    const cy = h / 2;

    for (let i = 0; i < iterations; i++) {
      // Apply transform: draw A onto B with transform
      ctxB.clearRect(0, 0, w, h);
      ctxB.save();
      ctxB.translate(cx, cy);
      ctxB.rotate(rotate);
      ctxB.scale(zoom, zoom);
      ctxB.translate(-cx + shiftX, -cy + shiftY);
      ctxB.drawImage(offA, 0, 0);
      ctxB.restore();

      // Apply decay (reduce brightness)
      if (decay < 1) {
        const imageData = ctxB.getImageData(0, 0, w, h);
        const d = imageData.data;
        for (let j = 0; j < d.length; j += 4) {
          d[j]     = d[j] * decay;
          d[j + 1] = d[j + 1] * decay;
          d[j + 2] = d[j + 2] * decay;
        }
        ctxB.putImageData(imageData, 0, 0);
      }

      // Apply hue rotation via CSS filter on composite
      if (doColorShift) {
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
