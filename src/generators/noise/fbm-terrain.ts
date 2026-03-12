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
    min: 0.25,
    max: 3.0,
    step: 0.05,
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
    const pScale   = params.scale ?? 2;
    const pOctaves = params.octaves ?? 4;
    const pLac     = params.lacunarity ?? 2.0;
    const pGain    = params.gain ?? 0.5;
    const contrast = params.contrast ?? 1;
    const invContrast = 1 / contrast;
    const doWarp   = warpStrength > 0;
    const isRidged    = style === 'ridged';
    const isTerraced  = style === 'terraced';
    const colorMode = params.colorMode ?? 'height';
    const isGradient = colorMode === 'gradient';
    const t = time * speed;

    // Precompute rotation for 'rotate' mode
    const isDrift  = animMode === 'drift';
    const isRotate = animMode === 'rotate';
    const rotAngle = isRotate ? t * 0.1 : 0;
    const rotCos = Math.cos(rotAngle);
    const rotSin = Math.sin(rotAngle);
    const nCenter = 2 * pScale;

    // Scale multiplier for 'pulse' mode
    const pulseMul = animMode === 'pulse' ? 1 + 0.2 * Math.sin(t * 0.4) : 1;
    const scaleX = 4 * pScale * pulseMul / width;
    const scaleY = 4 * pScale * pulseMul / height;
    const driftX = isDrift ? t * 0.04 : 0;
    const driftY = isDrift ? t * 0.027 : 0;

    // Pre-compute palette as flat RGB
    const nColors = palette.colors.length;
    const colR = new Uint8Array(nColors);
    const colG = new Uint8Array(nColors);
    const colB = new Uint8Array(nColors);
    for (let i = 0; i < nColors; i++) {
      const hex = palette.colors[i];
      const n = parseInt(hex.charAt(0) === '#' ? hex.slice(1) : hex, 16) || 0;
      colR[i] = (n >> 16) & 255;
      colG[i] = (n >> 8) & 255;
      colB[i] = n & 255;
    }
    const palMax = nColors - 1;

    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : Math.max(1, Math.round(Math.max(width, height) / 1080));
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Inline noise sampling for a pixel
    const sampleValue = (px: number, py: number): number => {
      let nx = px * scaleX + driftX;
      let ny = py * scaleY + driftY;

      if (isRotate) {
        const dx = nx - nCenter, dy = ny - nCenter;
        nx = nCenter + dx * rotCos - dy * rotSin;
        ny = nCenter + dx * rotSin + dy * rotCos;
      }

      if (doWarp) {
        const wnx = nx * warpScale, wny = ny * warpScale;
        nx += warpStrength * warpNoise.fbm(wnx, wny, 3, 2.0, 0.5);
        ny += warpStrength * warpNoise.fbm(wnx + 5.2, wny + 1.3, 3, 2.0, 0.5);
      }

      let value = noise.fbm(nx, ny, pOctaves, pLac, pGain);

      if (isRidged) {
        const ridge = 1 - Math.abs(value);
        value = ridge * ridge;
      } else if (isTerraced) {
        value = (value + 1) * 0.5;
        value = Math.floor(value * terraceLevels) / terraceLevels;
      } else {
        value = (value + 1) * 0.5;
      }

      value = Math.max(0, Math.min(1, value));
      if (contrast !== 1) value = Math.pow(value, invContrast);
      return value;
    };

    if (isGradient) {
      // Two-pass only for gradient mode
      const values = new Float32Array(width * height);
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const val = sampleValue(x, y);
          for (let dy = 0; dy < step && y + dy < height; dy++)
            for (let dx = 0; dx < step && x + dx < width; dx++)
              values[(y + dy) * width + (x + dx)] = val;
        }
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const vC = values[y * width + x];
          const vR = x < width - 1 ? values[y * width + x + 1] : vC;
          const vD = y < height - 1 ? values[(y + 1) * width + x] : vC;
          const gx = vR - vC, gy = vD - vC;
          const v = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 20);

          const ci = v * palMax;
          const c0 = ci | 0, c1 = Math.min(palMax, c0 + 1), f = ci - c0;
          const idx = (y * width + x) * 4;
          data[idx]     = (colR[c0] + (colR[c1] - colR[c0]) * f) | 0;
          data[idx + 1] = (colG[c0] + (colG[c1] - colG[c0]) * f) | 0;
          data[idx + 2] = (colB[c0] + (colB[c1] - colB[c0]) * f) | 0;
          data[idx + 3] = 255;
        }
      }
    } else {
      // Single pass for height mode
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const v = sampleValue(x, y);
          const ci = v * palMax;
          const c0 = ci | 0, c1 = Math.min(palMax, c0 + 1), f = ci - c0;
          const pr = (colR[c0] + (colR[c1] - colR[c0]) * f) | 0;
          const pg = (colG[c0] + (colG[c1] - colG[c0]) * f) | 0;
          const pb = (colB[c0] + (colB[c1] - colB[c0]) * f) | 0;

          for (let dy = 0; dy < step && y + dy < height; dy++) {
            for (let dx = 0; dx < step && x + dx < width; dx++) {
              const idx = ((y + dy) * width + (x + dx)) * 4;
              data[idx] = pr; data[idx + 1] = pg; data[idx + 2] = pb; data[idx + 3] = 255;
            }
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  },

  estimateCost(params) {
    return params.octaves * 100;
  },
};
