import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { SVGPathBuilder } from '../../renderers/svg/builder';

const parameterSchema: ParameterSchema = {
  ax: {
    name: 'X Frequency',
    type: 'number',
    min: 1,
    max: 20,
    step: 1,
    default: 5,
    help: 'Frequency of X oscillation',
    group: 'Geometry',
  },
  ay: {
    name: 'Y Frequency',
    type: 'number',
    min: 1,
    max: 20,
    step: 1,
    default: 4,
    help: 'Frequency of Y oscillation',
    group: 'Geometry',
  },
  phase: {
    name: 'Phase',
    type: 'number',
    min: 0,
    max: 6.28,
    step: 0.1,
    default: 1.57,
    help: 'Phase offset between X and Y',
    group: 'Geometry',
  },
  samples: {
    name: 'Samples',
    type: 'number',
    min: 100,
    max: 10000,
    step: 100,
    default: 5000,
    help: 'Number of curve samples',
    group: 'Composition',
  },
  thickness: {
    name: 'Line Thickness',
    type: 'number',
    min: 0.5,
    max: 5,
    step: 0.5,
    default: 2,
    help: 'Stroke width',
    group: 'Texture',
  },
  speed: {
    name: 'Speed',
    type: 'number',
    min: 0.05,
    max: 2,
    step: 0.05,
    default: 0.5,
    help: 'Phase sweep speed — animates the Lissajous shape',
    group: 'Flow/Motion',
  },
};

export const lissajous: Generator = {
  id: 'lissajous',
  family: 'geometry',
  styleName: 'Lissajous & Harmonographs',
  definition: 'Generates beautiful mathematical curves using Lissajous figures and harmonic oscillations',
  algorithmNotes: 'Traces the path of a point moving under two sinusoidal oscillations at different frequencies with a phase offset.',
  parameterSchema,
  defaultParams: {
    ax: 5,
    ay: 4,
    phase: 1.57,
    samples: 5000,
    thickness: 2,
    speed: 0.5,
  },
  supportsVector: true,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderVector(params, seed, palette) {
    const width = 1080;
    const height = 1080;
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = Math.min(width, height) * 0.35;

    const builder = new SVGPathBuilder();
    const color = palette.colors[0];
    const points: [number, number][] = [];

    for (let i = 0; i <= params.samples; i++) {
      const t = (i / params.samples) * Math.PI * 2;
      const x = centerX + Math.sin(params.ax * t + params.phase) * scale;
      const y = centerY + Math.sin(params.ay * t) * scale;
      points.push([x, y]);
    }

    builder.addPolyline(points, color, undefined, params.thickness);
    return builder.getPaths();
  },

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = Math.min(width, height) * 0.35;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Animated phase sweep: classic Lissajous oscilloscope morphing
    const animPhase = params.phase + time * (params.speed ?? 0.5);

    // Draw with palette colors fading from first to last along the curve
    const nColors = palette.colors.length;
    const segSize = Math.ceil(params.samples / Math.max(nColors - 1, 1));

    for (let ci = 0; ci < Math.max(nColors - 1, 1); ci++) {
      ctx.strokeStyle = palette.colors[ci % nColors];
      ctx.lineWidth = params.thickness;
      ctx.beginPath();

      const iStart = ci * segSize;
      const iEnd = Math.min((ci + 1) * segSize, params.samples);

      for (let i = iStart; i <= iEnd; i++) {
        const t = (i / params.samples) * Math.PI * 2;
        const x = centerX + Math.sin(params.ax * t + animPhase) * scale;
        const y = centerY + Math.sin(params.ay * t) * scale;
        if (i === iStart) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },

  renderWebGL2(gl, params, seed, palette, quality) {
    const canvas = gl.canvas as HTMLCanvasElement;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d')!;

    this.renderCanvas2D!(ctx, params, seed, palette, quality);

    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
  },

  estimateCost(params) {
    return params.samples * 0.5;
  },
};
