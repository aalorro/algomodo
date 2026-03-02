import type { Generator, ParameterSchema } from '../../types';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paletteSample(t: number, colors: [number, number, number][]): [number, number, number] {
  const s = Math.max(0, Math.min(1, t)) * (colors.length - 1);
  const i0 = Math.floor(s), i1 = Math.min(colors.length - 1, i0 + 1), f = s - i0;
  return [
    (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
    (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
    (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
  ];
}

const parameterSchema: ParameterSchema = {
  pattern: {
    name: 'Pattern', type: 'select', options: ['lines', 'circles', 'dots', 'radial'], default: 'lines',
    help: 'Base pattern: two copies are overlaid at offset angle/position to create interference',
    group: 'Geometry',
  },
  frequency: {
    name: 'Frequency', type: 'number', min: 2, max: 60, step: 1, default: 20,
    help: 'Lines/circles per unit — higher = finer grating, more complex moiré bands',
    group: 'Geometry',
  },
  angle: {
    name: 'Angle (°)', type: 'number', min: 0, max: 90, step: 0.5, default: 5,
    help: 'Relative rotation between the two overlapping patterns — small angles → wide beating bands',
    group: 'Geometry',
  },
  offset: {
    name: 'Offset', type: 'number', min: 0, max: 50, step: 1, default: 0,
    help: 'Translational offset of the second pattern (pixels)',
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode', type: 'select', options: ['palette', 'bw', 'complement'], default: 'palette',
    help: 'palette: interference mapped to palette gradient | bw: black & white | complement: XOR colors',
    group: 'Color',
  },
  animMode: {
    name: 'Anim Mode', type: 'select', options: ['rotate', 'slide', 'zoom'], default: 'rotate',
    help: 'rotate: angle drifts continuously | slide: offset translates | zoom: frequency oscillates',
    group: 'Flow/Motion',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.1, max: 3, step: 0.1, default: 0.5,
    group: 'Flow/Motion',
  },
};

export const geoMoire: Generator = {
  id: 'geo-moire',
  family: 'geometry',
  styleName: 'Moiré',
  definition: 'Optical interference patterns produced by overlaying two identical periodic gratings at a small relative angle or offset — the beating between the two grids creates macroscopic fringe bands',
  algorithmNotes:
    'For each pixel (x,y) two scalar field values f1 and f2 are computed from the same periodic function (sin²) evaluated at rotated/offset coordinates. The interference value I = (f1 + f2)/2 is mapped to a colour. Lines: f = sin²(freq·(x·cosθ + y·sinθ)). Circles: f = sin²(freq·√(x²+y²)). Dots: f = sin²(freq·x)·sin²(freq·y). Radial: f = sin²(freq·atan2(y,x)/2π). Two copies differ by a small angle or offset; their sum modulates at the beat frequency, producing bands with spatial frequency equal to the difference of the two gratings.',
  parameterSchema,
  defaultParams: {
    pattern: 'lines', frequency: 20, angle: 5, offset: 0,
    colorMode: 'palette', animMode: 'rotate', speed: 0.5,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const pat      = params.pattern   ?? 'lines';
    const freq     = (params.frequency ?? 20) * 0.08; // scale to canvas coords
    const colorMode = params.colorMode ?? 'palette';
    const animMode  = params.animMode  ?? 'rotate';
    const t         = time * (params.speed ?? 0.5);

    let angleRad = (params.angle ?? 5) * Math.PI / 180;
    let offset   = params.offset ?? 0;
    let freqMod  = freq;

    if (animMode === 'rotate') angleRad += t * 0.04;
    else if (animMode === 'slide') offset += t * 8;
    else if (animMode === 'zoom') freqMod = freq * (1 + 0.4 * Math.sin(t * 0.6));

    const colors = palette.colors.map(hexToRgb);

    const step = quality === 'draft' || time > 0 ? 2 : 1;
    const img  = ctx.createImageData(w, h);
    const d    = img.data;

    const cosA1 = Math.cos(0),       sinA1 = Math.sin(0);
    const cosA2 = Math.cos(angleRad), sinA2 = Math.sin(angleRad);

    function field(px: number, py: number, cosA: number, sinA: number, offX: number, offY: number): number {
      const rx = (px + offX) * cosA - (py + offY) * sinA;
      const ry = (px + offX) * sinA + (py + offY) * cosA;
      if (pat === 'lines') {
        return Math.pow(Math.sin(freqMod * rx), 2);
      } else if (pat === 'circles') {
        const r = Math.sqrt(rx * rx + ry * ry);
        return Math.pow(Math.sin(freqMod * r), 2);
      } else if (pat === 'dots') {
        return Math.pow(Math.sin(freqMod * rx), 2) * Math.pow(Math.sin(freqMod * ry), 2);
      } else { // radial
        const theta = Math.atan2(ry, rx);
        return Math.pow(Math.sin(freqMod * 8 * theta), 2);
      }
    }

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const px = x - cx, py = y - cy;
        const f1 = field(px, py, cosA1, sinA1, 0, 0);
        const f2 = field(px, py, cosA2, sinA2, offset, 0);
        const I  = (f1 + f2) * 0.5; // 0–1

        let r: number, g: number, b: number;
        if (colorMode === 'bw') {
          const v = (I * 255) | 0;
          r = g = b = v;
        } else if (colorMode === 'complement') {
          // XOR-like: high where one is light and other is dark
          const diff = Math.abs(f1 - f2);
          [r, g, b] = paletteSample(diff, colors);
        } else {
          [r, g, b] = paletteSample(I, colors);
        }

        for (let sy = 0; sy < step && y + sy < h; sy++) {
          for (let sx = 0; sx < step && x + sx < w; sx++) {
            const i = ((y + sy) * w + (x + sx)) * 4;
            d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  renderWebGL2(gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); },
  estimateCost() { return 400; },
};
