import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { SVGPathBuilder } from '../../renderers/svg/builder';

const parameterSchema: ParameterSchema = {
  radius: {
    name: 'Radius (R)',
    type: 'number',
    min: 10,
    max: 500,
    step: 10,
    default: 200,
    help: 'Fixed circle radius',
    group: 'Geometry',
  },
  smallRadius: {
    name: 'Small Radius (r)',
    type: 'number',
    min: 10,
    max: 250,
    step: 10,
    default: 120,
    help: 'Rolling circle radius',
    group: 'Geometry',
  },
  distance: {
    name: 'Distance (d)',
    type: 'number',
    min: 0,
    max: 500,
    step: 10,
    default: 100,
    help: 'Distance from center of rolling circle',
    group: 'Geometry',
  },
  turns: {
    name: 'Turns',
    type: 'number',
    min: 1,
    max: 50,
    step: 1,
    default: 10,
    help: 'Number of complete rotations',
    group: 'Composition',
  },
  strokeWidth: {
    name: 'Stroke Width',
    type: 'number',
    min: 0.5,
    max: 10,
    step: 0.5,
    default: 2,
    help: 'Line thickness',
    group: 'Texture',
  },
  speed: {
    name: 'Speed',
    type: 'number',
    min: 0.05,
    max: 2,
    step: 0.05,
    default: 0.3,
    help: 'Rotation speed when animated',
    group: 'Flow/Motion',
  },
  layering: {
    name: 'Layers',
    type: 'number',
    min: 1,
    max: 8,
    step: 1,
    default: 1,
    help: 'Number of overlaid spirographs',
    group: 'Composition',
  },
};

export const spirograph: Generator = {
  id: 'spirograph',
  family: 'geometry',
  styleName: 'Spirograph',
  definition: 'Creates mathematical spiral patterns using hypotrochoid and epitrochoid equations',
  algorithmNotes: 'A spirograph traces the path of a point on a rolling circle inside or outside a fixed circle. The classic mathematical curves are beautiful and deterministic.',
  parameterSchema,
  defaultParams: {
    radius: 200,
    smallRadius: 120,
    distance: 100,
    turns: 10,
    strokeWidth: 2,
    speed: 0.3,
    layering: 1,
  },
  supportsVector: true,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderVector(params, seed, palette) {
    const builder = new SVGPathBuilder();
    const rng = new SeededRNG(seed);
    const centerX = 540;
    const centerY = 540;

    for (let layer = 0; layer < params.layering; layer++) {
      const R = params.radius;
      const r = params.smallRadius;
      const d = params.distance;
      const color = palette.colors[layer % palette.colors.length];

      const steps = 1000 * params.turns;
      const points: [number, number][] = [];

      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2 * params.turns;
        
        const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
        const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);

        points.push([centerX + x, centerY + y]);
      }

      builder.addPolyline(points, color, undefined, params.strokeWidth);
    }

    return builder.getPaths();
  },

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Animated rotation: phase offset advances over time
    const phaseOffset = time * (params.speed ?? 0.3);

    for (let layer = 0; layer < params.layering; layer++) {
      const R = params.radius;
      const r = params.smallRadius;
      const d = params.distance;
      const color = palette.colors[layer % palette.colors.length];
      // Each layer rotates at a slightly different rate for depth
      const layerPhase = phaseOffset * (1 + layer * 0.15);

      const steps = 1000 * params.turns;
      ctx.strokeStyle = color;
      ctx.lineWidth = params.strokeWidth;
      ctx.beginPath();

      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * Math.PI * 2 * params.turns;
        const x = (R - r) * Math.cos(t + layerPhase) + d * Math.cos(((R - r) / r) * t + layerPhase);
        const y = (R - r) * Math.sin(t + layerPhase) - d * Math.sin(((R - r) / r) * t + layerPhase);

        if (i === 0) {
          ctx.moveTo(centerX + x, centerY + y);
        } else {
          ctx.lineTo(centerX + x, centerY + y);
        }
      }

      ctx.stroke();
    }
  },

  renderWebGL2(gl, params, seed, palette, quality) {
    // Fallback to canvas2d-like rendering with WebGL
    const canvas = gl.canvas as HTMLCanvasElement;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const ctx = tempCanvas.getContext('2d')!;
    
    this.renderCanvas2D!(ctx, params, seed, palette, quality);
    
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
    
    // Render texture to screen
    const vertices = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ]);
    
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    
    const vertexShaderSource = `
      attribute vec2 position;
      attribute vec2 texCoord;
      varying vec2 vTexCoord;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        vTexCoord = texCoord;
      }
    `;
    
    const fragmentShaderSource = `
      precision mediump float;
      uniform sampler2D tex;
      varying vec2 vTexCoord;
      void main() {
        gl_FragColor = texture2D(tex, vTexCoord);
      }
    `;
    
    const program = gl.createProgram()!;
    const vShader = gl.createShader(gl.VERTEX_SHADER)!;
    const fShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    
    gl.shaderSource(vShader, vertexShaderSource);
    gl.compileShader(vShader);
    gl.shaderSource(fShader, fragmentShaderSource);
    gl.compileShader(fShader);
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.linkProgram(program);
    gl.useProgram(program);
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },

  estimateCost(params) {
    return params.turns * params.layering * 50;
  },
};
