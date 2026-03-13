import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const parameterSchema: ParameterSchema = {
  noiseScale: {
    name: 'Noise Scale', type: 'number', min: 1, max: 10, step: 0.5, default: 3,
    help: 'Spatial frequency of base noise field',
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 8, step: 1, default: 4,
    help: 'FBM octave count — more = finer detail',
    group: 'Composition',
  },
  displaceAmount: {
    name: 'Displace', type: 'number', min: 0, max: 1, step: 0.05, default: 0.4,
    help: 'Coordinate displacement warp strength',
    group: 'Geometry',
  },
  edgeIntensity: {
    name: 'Edge Intensity', type: 'number', min: 0, max: 1, step: 0.05, default: 0.5,
    help: 'Sobel edge detection strength',
    group: 'Texture',
  },
  quantizeLevels: {
    name: 'Quantize Levels', type: 'number', min: 2, max: 16, step: 1, default: 6,
    help: 'Posterization step count',
    group: 'Texture',
  },
  opChain: {
    name: 'Op Chain', type: 'select',
    options: ['noise-edge', 'noise-displace', 'noise-feedback', 'full-chain'],
    default: 'full-chain',
    help: 'noise-edge: noise→edge | noise-displace: noise→warp | noise-feedback: domain warp | full-chain: all ops',
    group: 'Composition',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 2, step: 0.05, default: 0.5,
    help: 'Animation drift speed',
    group: 'Flow/Motion',
  },
  reactivity: {
    name: 'Audio Reactivity', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0,
    help: 'Sensitivity to audio input (0 = none)',
    group: 'Flow/Motion',
  },
};

export const proceduralVfx: Generator = {
  id: 'procedural-vfx',
  family: 'procedural',
  styleName: 'Procedural VFX',
  definition: 'TouchDesigner-style texture operations: noise → displacement → quantize → edge detect → palette color ramp',
  algorithmNotes:
    'Generates FBM noise that drifts over time. An operations chain is applied: domain-warp displacement warps sample coordinates via a secondary noise field, quantization posterizes values, Sobel edge detection highlights contours, and palette mapping colorizes the result. Chain mode selects which stages run.',
  parameterSchema,
  defaultParams: {
    noiseScale: 3, octaves: 4, displaceAmount: 0.4, edgeIntensity: 0.5,
    quantizeLevels: 6, opChain: 'full-chain', speed: 0.5, reactivity: 1.0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : 2;

    const noiseScale = params.noiseScale ?? 3;
    const octaves = Math.max(1, params.octaves ?? 4) | 0;
    const rx = params.reactivity ?? 1.0;
    const audioBass = (params._audioBass ?? 0) * rx;
    const audioHigh = (params._audioHigh ?? 0) * rx;

    const displaceAmt = (params.displaceAmount ?? 0.4) + audioBass * 0.5;
    const edgeInt = (params.edgeIntensity ?? 0.5) + audioHigh * 0.4;
    const qLevels = Math.max(2, params.quantizeLevels ?? 6) | 0;
    const opChain = params.opChain || 'full-chain';
    const spd = params.speed ?? 0.5;
    const t = time * spd;

    const doDisplace = opChain === 'noise-displace' || opChain === 'full-chain';
    const doEdge = opChain === 'noise-edge' || opChain === 'full-chain';
    const doFeedback = opChain === 'noise-feedback' || opChain === 'full-chain';

    const noise = new SimplexNoise(seed);
    const noise2 = doDisplace ? new SimplexNoise(seed + 77) : null;

    // Flatten palette to typed array for fast lookup
    const rawColors = palette.colors.map(hexToRgb);
    const nC = rawColors.length;
    const colorR = new Uint8Array(nC);
    const colorG = new Uint8Array(nC);
    const colorB = new Uint8Array(nC);
    for (let i = 0; i < nC; i++) {
      colorR[i] = rawColors[i][0]; colorG[i] = rawColors[i][1]; colorB[i] = rawColors[i][2];
    }

    const invW = noiseScale / w;
    const invH = noiseScale / h;
    const driftX = t * 0.04;
    const driftY = t * 0.027;
    const displaceAmt2 = displaceAmt * 2;
    const invQLevels = 1 / qLevels;

    const cols = Math.ceil(w / step);
    const rows = Math.ceil(h / step);
    const valBuf = new Float32Array(cols * rows);

    // Compute value buffer
    for (let gy = 0; gy < rows; gy++) {
      const py = gy * step;
      const rowOff = gy * cols;
      for (let gx = 0; gx < cols; gx++) {
        const px = gx * step;
        let nx = px * invW + driftX;
        let ny = py * invH + driftY;

        if (doDisplace) {
          const nx07 = nx * 0.7;
          const ny07 = ny * 0.7;
          nx += noise2!.noise2D(nx07 + t * 0.02, ny07) * displaceAmt2;
          ny += noise2!.noise2D(nx07 + 31.7, ny07 + t * 0.015) * displaceAmt2;
        }

        if (doFeedback) {
          nx += noise.noise2D(nx + 5.2, ny + 1.3) * 0.8;
          ny += noise.noise2D(nx + 9.1, ny + 4.7) * 0.8;
        }

        let v = octaves === 1
          ? noise.noise2D(nx, ny)
          : noise.fbm(nx, ny, octaves, 2.0, 0.5);

        v = v * 0.5 + 0.5;
        v = (v * qLevels | 0) * invQLevels;

        valBuf[rowOff + gx] = v;
      }
    }

    // Edge detection (Sobel) — skip if not needed
    let edgeBuf: Float32Array | null = null;
    if (doEdge && edgeInt > 0) {
      edgeBuf = new Float32Array(cols * rows);
      for (let gy = 1; gy < rows - 1; gy++) {
        const rowPrev = (gy - 1) * cols;
        const rowCurr = gy * cols;
        const rowNext = (gy + 1) * cols;
        for (let gx = 1; gx < cols - 1; gx++) {
          const tl = valBuf[rowPrev + gx - 1];
          const tc = valBuf[rowPrev + gx];
          const tr = valBuf[rowPrev + gx + 1];
          const ml = valBuf[rowCurr + gx - 1];
          const mr = valBuf[rowCurr + gx + 1];
          const bl = valBuf[rowNext + gx - 1];
          const bc = valBuf[rowNext + gx];
          const br = valBuf[rowNext + gx + 1];

          const gxVal = -tl - 2 * ml - bl + tr + 2 * mr + br;
          const gyVal = -tl - 2 * tc - tr + bl + 2 * bc + br;
          edgeBuf[rowCurr + gx] = Math.sqrt(gxVal * gxVal + gyVal * gyVal);
        }
      }
    }

    // Render to image data using Uint32Array for fast writes
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;
    const buf32 = new Uint32Array(data.buffer);
    data[0] = 1; data[1] = 2; data[2] = 3; data[3] = 4;
    const isLE = buf32[0] === 0x04030201;

    const hasEdge = edgeBuf !== null && edgeInt > 0;
    const edgeIntInv = 1 - edgeInt;
    const nCm1 = nC - 1;

    for (let gy = 0; gy < rows; gy++) {
      const py = gy * step;
      const rowOff = gy * cols;
      for (let gx = 0; gx < cols; gx++) {
        const px = gx * step;
        let v = valBuf[rowOff + gx];

        if (hasEdge) {
          const edge = edgeBuf![rowOff + gx] * 3;
          v = v * edgeIntInv + (edge < 1 ? edge : 1) * edgeInt;
        }

        if (v < 0) v = 0; else if (v > 1) v = 1;

        // Map to palette with interpolation
        const ci = v * nCm1;
        const i0 = ci | 0;
        const i1 = i0 < nCm1 ? i0 + 1 : nCm1;
        const f = ci - i0;
        const r = (colorR[i0] + (colorR[i1] - colorR[i0]) * f) | 0;
        const g = (colorG[i0] + (colorG[i1] - colorG[i0]) * f) | 0;
        const b = (colorB[i0] + (colorB[i1] - colorB[i0]) * f) | 0;

        const pixel = isLE
          ? (0xFF000000 | (b << 16) | (g << 8) | r)
          : ((r << 24) | (g << 16) | (b << 8) | 0xFF);

        // Fill step×step block
        if (step === 1) {
          buf32[py * w + px] = pixel;
        } else {
          const maxDy = Math.min(step, h - py);
          const maxDx = Math.min(step, w - px);
          for (let dy = 0; dy < maxDy; dy++) {
            const rowBase = (py + dy) * w + px;
            for (let dx = 0; dx < maxDx; dx++) {
              buf32[rowBase + dx] = pixel;
            }
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round((params.octaves ?? 4) * 120 + ((params.edgeIntensity ?? 0.5) > 0 ? 200 : 0));
  },
};
