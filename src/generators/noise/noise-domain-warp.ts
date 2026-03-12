import type { Generator, ParameterSchema } from '../../types';
import { SimplexNoise } from '../../core/rng';

const parameterSchema: ParameterSchema = {
  scale: {
    name: 'Scale', type: 'number', min: 0.5, max: 8, step: 0.5, default: 2.0,
    group: 'Composition',
  },
  octaves: {
    name: 'Octaves', type: 'number', min: 1, max: 8, step: 1, default: 5,
    help: 'Octaves for the final readout noise',
    group: 'Composition',
  },
  warpStrength: {
    name: 'Warp Strength', type: 'number', min: 0.0, max: 4.0, step: 0.1, default: 1.5,
    help: 'How far coordinates are displaced by the warp field — higher = more folded and tangled',
    group: 'Composition',
  },
  warpOctaves: {
    name: 'Warp Octaves', type: 'number', min: 1, max: 6, step: 1, default: 3,
    help: 'Complexity of the warp field itself — more octaves = finer warp detail',
    group: 'Geometry',
  },
  iterations: {
    name: 'Iterations', type: 'select', options: ['1', '2', '3'], default: '1',
    help: '1: single warp | 2: double warp — more folded | 3: triple warp — extremely complex interlocked filaments',
    group: 'Geometry',
  },
  readoutStyle: {
    name: 'Readout Style', type: 'select', options: ['smooth', 'ridged', 'turbulent'], default: 'smooth',
    help: 'How the final noise value is shaped — smooth: standard fBm | ridged: sharp ridge lines | turbulent: abs-value creases',
    group: 'Texture',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['palette', 'bands'], default: 'palette',
    group: 'Color',
  },
  bandCount: {
    name: 'Band Count', type: 'number', min: 2, max: 24, step: 1, default: 8,
    help: 'Number of quantized contour bands (bands mode only)',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['drift', 'rotate', 'flow'], default: 'flow',
    help: 'drift: translate uniformly | rotate: spin sample coordinates | flow: warp field morphs independently',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3.0, step: 0.1, default: 0.5,
    group: 'Flow/Motion',
  },
};

export const noiseDomainWarp: Generator = {
  id: 'noise-domain-warp',
  family: 'noise',
  styleName: 'Domain Warp',
  definition: 'Iterated coordinate displacement — the sample position is offset by one fBm field before evaluating another, folding the noise into organic, turbulent swirls and interlocked filaments',
  algorithmNotes:
    'Domain warping (Inigo Quilez): instead of evaluating noise at (x, y) directly, displace the coordinates first — warpX = fBm(x, y), warpY = fBm(x+5.2, y+1.3) — then evaluate the readout noise at (x + strength·warpX, y + strength·warpY). With iterations = 2 the warped coordinates are fed back through a second warp field before the final readout, producing dramatically more folded structures. The fixed phase offsets (5.2, 1.3, 8.3, 2.8) ensure the two warp-axis noise fields are uncorrelated. The "flow" animation mode advances the warp field phase independently of the base coordinates, so the folding pattern slowly morphs in place.',
  parameterSchema,
  defaultParams: {
    scale: 2.0, octaves: 5, warpStrength: 1.5, warpOctaves: 3,
    iterations: '1', readoutStyle: 'smooth', colorMode: 'palette', bandCount: 8, animMode: 'flow', speed: 0.5,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const noiseBase = new SimplexNoise(seed);
    const noiseWarp = new SimplexNoise(seed + 7919);
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const scale        = params.scale        ?? 2.0;
    const octaves      = Math.max(1, Math.min(8, (params.octaves ?? 5) | 0));
    const warpStrength = params.warpStrength  ?? 1.5;
    const warpOctaves  = Math.max(1, Math.min(6, (params.warpOctaves ?? 3) | 0));
    const iters        = parseInt(params.iterations ?? '1', 10) || 1;
    const bandCount    = Math.max(2, (params.bandCount ?? 8) | 0);
    const t            = time * (params.speed ?? 0.5);
    const animMode     = params.animMode ?? 'flow';
    const nCenter      = 2 * scale;
    const rotAngle     = animMode === 'rotate' ? t * 0.08 : 0;
    const rotCos       = Math.cos(rotAngle), rotSin = Math.sin(rotAngle);

    const flowX = animMode === 'flow' ? t * 0.022 : 0;
    const flowY = animMode === 'flow' ? t * 0.017 : 0;

    // Hoist conditions outside loop
    const isDrift    = animMode === 'drift';
    const isRotate   = animMode === 'rotate';
    const isRidged   = (params.readoutStyle ?? 'smooth') === 'ridged';
    const isTurbulent = (params.readoutStyle ?? 'smooth') === 'turbulent';
    const isBands    = (params.colorMode ?? 'palette') === 'bands';
    const doIter2    = iters >= 2;
    const doIter3    = iters >= 3;
    const invW = 4 * scale / w;
    const invH = 4 * scale / h;
    const driftX = isDrift ? t * 0.04 : 0;
    const driftY = isDrift ? t * 0.027 : 0;
    const flowX07 = flowX * 0.7;
    const flowY07 = flowY * 0.7;
    const flowX05 = flowX * 0.5;
    const flowY05 = flowY * 0.5;

    // Pre-compute palette as flat arrays
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

    const step = quality === 'draft' ? 2 : 1;
    const img  = ctx.createImageData(w, h);
    const d    = img.data;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        let nx = x * invW + driftX;
        let ny = y * invH + driftY;
        if (isRotate) {
          const dx = nx - nCenter, dy = ny - nCenter;
          nx = nCenter + dx * rotCos - dy * rotSin;
          ny = nCenter + dx * rotSin + dy * rotCos;
        }

        // First warp pass
        const wx1 = noiseWarp.fbm(nx + flowX,       ny + flowY,       warpOctaves, 2.0, 0.5);
        const wy1 = noiseWarp.fbm(nx + 5.2 + flowX, ny + 1.3 + flowY, warpOctaves, 2.0, 0.5);
        let px = nx + warpStrength * wx1;
        let py = ny + warpStrength * wy1;

        if (doIter2) {
          const wx2 = noiseWarp.fbm(px + 8.3 + flowX07, py + 2.8 + flowY07, warpOctaves, 2.0, 0.5);
          const wy2 = noiseWarp.fbm(px + 1.7 + flowX07, py + 9.2 + flowY07, warpOctaves, 2.0, 0.5);
          px = nx + warpStrength * wx2;
          py = ny + warpStrength * wy2;
        }

        if (doIter3) {
          const wx3 = noiseWarp.fbm(px + 3.1 + flowX05, py + 7.4 + flowY05, warpOctaves, 2.0, 0.5);
          const wy3 = noiseWarp.fbm(px + 6.8 + flowX05, py + 4.5 + flowY05, warpOctaves, 2.0, 0.5);
          px = nx + warpStrength * wx3;
          py = ny + warpStrength * wy3;
        }

        // Final readout with style
        let v: number;
        const raw = noiseBase.fbm(px, py, octaves, 2.0, 0.5);
        if (isRidged) {
          const ridge = 1 - Math.abs(raw);
          v = ridge * ridge;
        } else if (isTurbulent) {
          v = Math.abs(raw);
        } else {
          v = (raw + 1) * 0.5;
        }

        if (isBands) v = Math.floor(v * bandCount) / bandCount;

        const ci = Math.max(0, Math.min(1, v)) * palMax;
        const c0 = ci | 0, c1 = Math.min(palMax, c0 + 1), frac = ci - c0;
        const pr = (colR[c0] + (colR[c1] - colR[c0]) * frac) | 0;
        const pg = (colG[c0] + (colG[c1] - colG[c0]) * frac) | 0;
        const pb = (colB[c0] + (colB[c1] - colB[c0]) * frac) | 0;

        for (let sy = 0; sy < step && y + sy < h; sy++) {
          for (let sx = 0; sx < step && x + sx < w; sx++) {
            const i = ((y + sy) * w + (x + sx)) * 4;
            d[i] = pr; d[i+1] = pg; d[i+2] = pb; d[i+3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost(params) {
    const iters = parseInt(params.iterations ?? '1', 10) || 1;
    return (((params.octaves ?? 5) + (params.warpOctaves ?? 3) * iters) * 100) | 0;
  },
};
