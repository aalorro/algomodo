import type { Generator, Palette, ParameterSchema } from '../../types';
import { SeededRNG, SimplexNoise } from '../../core/rng';
import { createShader, createProgram, createTexture, createFramebuffer, hexToVec4, createQuadVAO, drawFullscreenQuad, setUniforms } from '../../renderers/webgl2/utils';

const parameterSchema: ParameterSchema = {
  scale: {
    name: 'Scale',
    type: 'number',
    min: 0.2,
    max: 10,
    step: 0.1,
    default: 2,
    help: 'Base frequency of noise',
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves',
    type: 'number',
    min: 1,
    max: 8,
    step: 1,
    default: 4,
    help: 'Number of noise layers',
    group: 'Composition',
  },
  lacunarity: {
    name: 'Lacunarity',
    type: 'number',
    min: 1.5,
    max: 3.5,
    step: 0.1,
    default: 2.0,
    help: 'Frequency multiplier per octave',
    group: 'Geometry',
  },
  gain: {
    name: 'Gain',
    type: 'number',
    min: 0.2,
    max: 0.9,
    step: 0.05,
    default: 0.5,
    help: 'Amplitude multiplier per octave',
    group: 'Geometry',
  },
  warpStrength: {
    name: 'Warp Strength',
    type: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    default: 0.5,
    help: 'Domain warping intensity',
    group: 'Composition',
  },
  warpScale: {
    name: 'Warp Scale',
    type: 'number',
    min: 0.2,
    max: 10,
    step: 0.1,
    default: 2,
    help: 'Size of warping pattern',
    group: 'Composition',
  },
  contrast: {
    name: 'Contrast',
    type: 'number',
    min: 0.5,
    max: 2,
    step: 0.1,
    default: 1,
    help: 'Increase or decrease variation',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['height', 'gradient'],
    default: 'height',
    help: 'How colors map to height values',
    group: 'Color',
  },
};

export const fbmTerrain: Generator = {
  id: 'fbm-terrain',
  family: 'noise',
  styleName: 'FBM Terrain',
  definition: 'Generates natural-looking terrain using Fractal Brownian Motion noise with optional domain warping',
  algorithmNotes: 'FBM combines multiple octaves of Simplex noise at different scales. Domain warping distorts the noise coordinates for more organic patterns.',
  parameterSchema,
  defaultParams: {
    scale: 2,
    octaves: 4,
    lacunarity: 2.0,
    gain: 0.5,
    warpStrength: 0.5,
    warpScale: 2,
    contrast: 1,
    colorMode: 'height',
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: false,

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const width = gl.canvas.width;
    const height = gl.canvas.height;

    const vertexShader = createShader(
      gl,
      `#version 300 es
      precision highp float;
      
      in vec2 position;
      out vec2 uv;
      
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        uv = (position + 1.0) * 0.5;
      }`,
      gl.VERTEX_SHADER
    );

    const fragmentShader = createShader(
      gl,
      `#version 300 es
      precision highp float;
      
      uniform float time;
      uniform float scale;
      uniform float octaves;
      uniform float lacunarity;
      uniform float gain;
      uniform float warpStrength;
      uniform float warpScale;
      uniform float contrast;
      uniform int colorMode;
      uniform vec4 colors[5];
      uniform int colorCount;
      
      in vec2 uv;
      out vec4 outColor;
      
      // Simplex noise
      float noise(vec2 p) {
        vec3 a = fract(vec3(p.xyx) * vec3(1.0, 157.0, 113.0));
        a += dot(a, a.yzx + 23.0);
        return fract((a.x + a.y) * a.z);
      }
      
      float fbm(vec2 p, float freq, float amp, float lacunariity, float gaain, int iter) {
        float value = 0.0;
        float maxVal = 0.0;
        for(int i = 0; i < 8; i++) {
          if(i >= iter) break;
          value += amp * noise(p * freq);
          maxVal += amp;
          freq *= lacunariity;
          amp *= gaain;
        }
        return value / maxVal;
      }
      
      void main() {
        vec2 p = uv * 4.0;
        float n = fbm(p, scale, 1.0, lacunarity, gain, int(octaves));
        n = pow(n, 1.0 / contrast);
        
        vec3 col = mix(colors[0].rgb, colors[1].rgb, n);
        if(n > 0.7) col = mix(col, colors[4].rgb, n - 0.7);
        
        outColor = vec4(col, 1.0);
      }`,
      gl.FRAGMENT_SHADER
    );

    const program = createProgram(gl, vertexShader, fragmentShader);
    const vao = createQuadVAO(gl, program);

    const colorVec4: any[] = palette.colors.map(c => hexToVec4(c));
    
    setUniforms(gl, program, {
      time: time || 0,
      scale: params.scale,
      octaves: params.octaves,
      lacunarity: params.lacunarity,
      gain: params.gain,
      warpStrength: params.warpStrength,
      warpScale: params.warpScale,
      contrast: params.contrast,
      colorMode: params.colorMode === 'height' ? 0 : 1,
      colors: colorVec4,
      colorCount: Math.min(5, palette.colors.length),
    });

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawFullscreenQuad(gl, vao, width, height);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteProgram(program);
  },

  renderCanvas2D(ctx, params, seed, palette, quality) {
    const noise = new SimplexNoise(seed);
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = (x / width) * 4 * params.scale;
        const ny = (y / height) * 4 * params.scale;

        let value = noise.fbm(nx, ny, params.octaves, params.lacunarity, params.gain);
        value = Math.pow(value, 1 / params.contrast);
        value = Math.max(0, Math.min(1, value));

        const colorIdx = Math.floor(value * (palette.colors.length - 1));
        const nextColorIdx = Math.min(colorIdx + 1, palette.colors.length - 1);
        const t = value * (palette.colors.length - 1) - colorIdx;

        const color1 = hexToColor(palette.colors[colorIdx]);
        const color2 = hexToColor(palette.colors[nextColorIdx]);

        const idx = (y * width + x) * 4;
        data[idx] = Math.round(color1[0] * (1 - t) + color2[0] * t);
        data[idx + 1] = Math.round(color1[1] * (1 - t) + color2[1] * t);
        data[idx + 2] = Math.round(color1[2] * (1 - t) + color2[2] * t);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  estimateCost(params) {
    return params.octaves * 100;
  },
};

function hexToColor(hex: string | undefined): [number, number, number] {
  if (!hex || typeof hex !== 'string') {
    return [128, 128, 128]; // default gray
  }
  const cleanHex = hex.startsWith('#') ? hex : '#' + hex;
  const r = parseInt(cleanHex.slice(1, 3), 16) || 128;
  const g = parseInt(cleanHex.slice(3, 5), 16) || 128;
  const b = parseInt(cleanHex.slice(5, 7), 16) || 128;
  return [r, g, b];
}
