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
    quantizeLevels: 6, opChain: 'full-chain', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const step = quality === 'draft' ? 4 : quality === 'ultra' ? 1 : 2;

    const noiseScale = params.noiseScale ?? 3;
    const octaves = Math.max(1, params.octaves ?? 4) | 0;
    // Audio reactivity
    const audioBass = params._audioBass ?? 0;
    const audioHigh = params._audioHigh ?? 0;

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
    const noise2 = new SimplexNoise(seed + 77);

    // Parse palette
    const colors = palette.colors.map(hexToRgb);
    const nC = colors.length;

    const invW = noiseScale / w;
    const invH = noiseScale / h;
    const driftX = t * 0.04;
    const driftY = t * 0.027;

    // Compute value buffer (needed for edge detection)
    const cols = Math.ceil(w / step);
    const rows = Math.ceil(h / step);
    const valBuf = new Float32Array(cols * rows);

    for (let gy = 0; gy < rows; gy++) {
      const py = gy * step;
      for (let gx = 0; gx < cols; gx++) {
        const px = gx * step;
        let nx = px * invW + driftX;
        let ny = py * invH + driftY;

        // Displacement warp
        if (doDisplace) {
          const dx = noise2.noise2D(nx * 0.7 + t * 0.02, ny * 0.7) * displaceAmt * 2;
          const dy = noise2.noise2D(nx * 0.7 + 31.7, ny * 0.7 + t * 0.015) * displaceAmt * 2;
          nx += dx;
          ny += dy;
        }

        // Domain warp feedback
        if (doFeedback) {
          const wx = noise.noise2D(nx + 5.2, ny + 1.3) * 0.8;
          const wy = noise.noise2D(nx + 9.1, ny + 4.7) * 0.8;
          nx += wx;
          ny += wy;
        }

        // Base FBM
        let v = octaves === 1
          ? noise.noise2D(nx, ny)
          : noise.fbm(nx, ny, octaves, 2.0, 0.5);

        // Normalize to 0-1
        v = v * 0.5 + 0.5;

        // Quantize
        v = Math.floor(v * qLevels) / qLevels;

        valBuf[gy * cols + gx] = v;
      }
    }

    // Edge detection (Sobel) if needed
    let edgeBuf: Float32Array | null = null;
    if (doEdge && edgeInt > 0) {
      edgeBuf = new Float32Array(cols * rows);
      for (let gy = 1; gy < rows - 1; gy++) {
        for (let gx = 1; gx < cols - 1; gx++) {
          const tl = valBuf[(gy - 1) * cols + (gx - 1)];
          const tc = valBuf[(gy - 1) * cols + gx];
          const tr = valBuf[(gy - 1) * cols + (gx + 1)];
          const ml = valBuf[gy * cols + (gx - 1)];
          const mr = valBuf[gy * cols + (gx + 1)];
          const bl = valBuf[(gy + 1) * cols + (gx - 1)];
          const bc = valBuf[(gy + 1) * cols + gx];
          const br = valBuf[(gy + 1) * cols + (gx + 1)];

          const gxVal = -tl - 2 * ml - bl + tr + 2 * mr + br;
          const gyVal = -tl - 2 * tc - tr + bl + 2 * bc + br;
          edgeBuf[gy * cols + gx] = Math.sqrt(gxVal * gxVal + gyVal * gyVal);
        }
      }
    }

    // Render to image data
    const imgData = ctx.createImageData(w, h);
    const data = imgData.data;

    for (let gy = 0; gy < rows; gy++) {
      const py = gy * step;
      for (let gx = 0; gx < cols; gx++) {
        const px = gx * step;
        let v = valBuf[gy * cols + gx];

        // Mix with edge
        if (edgeBuf && edgeInt > 0) {
          const edge = Math.min(1, edgeBuf[gy * cols + gx] * 3);
          v = v * (1 - edgeInt) + edge * edgeInt;
        }

        v = Math.max(0, Math.min(1, v));

        // Map to palette
        const ci = v * (nC - 1);
        const i0 = Math.floor(ci);
        const i1 = Math.min(nC - 1, i0 + 1);
        const f = ci - i0;
        const c0 = colors[i0], c1 = colors[i1];
        const r = (c0[0] + (c1[0] - c0[0]) * f) | 0;
        const g = (c0[1] + (c1[1] - c0[1]) * f) | 0;
        const b = (c0[2] + (c1[2] - c0[2]) * f) | 0;

        // Fill step×step block
        for (let dy = 0; dy < step && py + dy < h; dy++) {
          for (let dx = 0; dx < step && px + dx < w; dx++) {
            const idx = ((py + dy) * w + (px + dx)) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
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
