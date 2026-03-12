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
  animMode: {
    name: 'Anim Mode',
    type: 'select',
    options: ['drift', 'rotate', 'pulse'],
    default: 'drift',
    help: 'drift: pan through the noise field | rotate: slowly spin the sample coordinates | pulse: oscillating zoom breath',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed',
    type: 'number',
    min: 0.1,
    max: 3.0,
    step: 0.1,
    default: 0.5,
    help: 'Animation speed multiplier',
    group: 'Flow/Motion',
  },
  style: {
    name: 'Style',
    type: 'select',
    options: ['smooth', 'ridged', 'terraced'],
    default: 'smooth',
    help: 'smooth: standard fBm | ridged: sharp mountain ridges | terraced: plateau contour steps',
    group: 'Geometry',
  },
  terraceLevels: {
    name: 'Terrace Levels',
    type: 'number',
    min: 4,
    max: 20,
    step: 1,
    default: 8,
    help: 'Number of height steps (terraced mode only)',
    group: 'Geometry',
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
    style: 'smooth',
    terraceLevels: 8,
    contrast: 1,
    colorMode: 'height',
    animMode: 'drift',
    speed: 0.5,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

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

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noise = new SimplexNoise(seed);
    const warpNoise = new SimplexNoise(seed + 42);
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    const animMode = params.animMode ?? 'drift';
    const speed    = params.speed    ?? 0.5;
    const style    = params.style    ?? 'smooth';
    const terraceLevels = params.terraceLevels ?? 8;
    const warpStrength  = params.warpStrength  ?? 0.5;
    const warpScale     = params.warpScale     ?? 2;
    const t = time * speed;

    // Precompute rotation for 'rotate' mode
    const rotAngle = animMode === 'rotate' ? t * 0.1 : 0;
    const rotCos = Math.cos(rotAngle);
    const rotSin = Math.sin(rotAngle);
    const nCenter = 2 * params.scale;

    // Scale multiplier for 'pulse' mode — oscillates ±20 %
    const pulseMul = animMode === 'pulse' ? 1 + 0.2 * Math.sin(t * 0.4) : 1;

    const colorMode = params.colorMode ?? 'height';

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Helper to compute noise value at a given pixel coordinate
    const sampleNoise = (px: number, py: number): number => {
      let nx = (px / width) * 4 * params.scale * pulseMul;
      let ny = (py / height) * 4 * params.scale * pulseMul;

      if (animMode === 'drift') {
        nx += t * 0.04;
        ny += t * 0.027;
      } else if (animMode === 'rotate') {
        const dx = nx - nCenter, dy = ny - nCenter;
        nx = nCenter + dx * rotCos - dy * rotSin;
        ny = nCenter + dx * rotSin + dy * rotCos;
      }

      if (warpStrength > 0) {
        const wx = warpNoise.fbm(nx * warpScale, ny * warpScale, 3, 2.0, 0.5);
        const wy = warpNoise.fbm(nx * warpScale + 5.2, ny * warpScale + 1.3, 3, 2.0, 0.5);
        nx += warpStrength * wx;
        ny += warpStrength * wy;
      }

      let value = noise.fbm(nx, ny, params.octaves, params.lacunarity, params.gain);

      if (style === 'ridged') {
        const ridge = 1 - Math.abs(value);
        value = ridge * ridge;
      } else if (style === 'terraced') {
        value = (value + 1) * 0.5;
        value = Math.floor(value * terraceLevels) / terraceLevels;
      } else {
        value = (value + 1) * 0.5;
      }

      return Math.pow(Math.max(0, Math.min(1, value)), 1 / params.contrast);
    };

    // First pass: compute height values
    const values = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        values[y * width + x] = sampleNoise(x, y);
      }
    }

    // Second pass: color based on colorMode
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v: number;
        if (colorMode === 'gradient') {
          // Color by gradient magnitude (steepness)
          const vC = values[y * width + x];
          const vR = x < width - 1 ? values[y * width + x + 1] : vC;
          const vD = y < height - 1 ? values[(y + 1) * width + x] : vC;
          const dx = vR - vC;
          const dy = vD - vC;
          v = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 20);
        } else {
          v = values[y * width + x];
        }

        const colorIdx = Math.floor(v * (palette.colors.length - 1));
        const nextColorIdx = Math.min(colorIdx + 1, palette.colors.length - 1);
        const colorT = v * (palette.colors.length - 1) - colorIdx;

        const color1 = hexToColor(palette.colors[colorIdx]);
        const color2 = hexToColor(palette.colors[nextColorIdx]);

        const idx = (y * width + x) * 4;
        data[idx] = Math.round(color1[0] * (1 - colorT) + color2[0] * colorT);
        data[idx + 1] = Math.round(color1[1] * (1 - colorT) + color2[1] * colorT);
        data[idx + 2] = Math.round(color1[2] * (1 - colorT) + color2[2] * colorT);
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
