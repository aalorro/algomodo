import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function getDist(metric: string, ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  if (metric === 'Manhattan') return dx + dy;
  if (metric === 'Chebyshev') return Math.max(dx, dy);
  return Math.sqrt(dx * dx + dy * dy);
}

function jitteredGrid(count: number, w: number, h: number, rng: SeededRNG): [number, number][] {
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const pts: [number, number][] = [];
  for (let r = 0; r < rows && pts.length < count; r++) {
    for (let c = 0; c < cols && pts.length < count; c++) {
      pts.push([(c + 0.2 + rng.random() * 0.6) * cw, (r + 0.2 + rng.random() * 0.6) * ch]);
    }
  }
  while (pts.length < count) pts.push([rng.random() * w, rng.random() * h]);
  return pts;
}

function animateSites(base: [number, number][], amp: number, speed: number, time: number): [number, number][] {
  return base.map(([bx, by], i) => {
    const ph = i * 2.39996;
    return [bx + Math.cos(time * speed + ph) * amp, by + Math.sin(time * speed * 1.3 + ph * 1.7) * amp];
  });
}

const parameterSchema: ParameterSchema = {
  cellCount: {
    name: 'Cell Count',
    type: 'number', min: 5, max: 150, step: 5, default: 40,
    group: 'Composition',
  },
  relaxationSteps: {
    name: 'Relaxation',
    type: 'number', min: 0, max: 8, step: 1, default: 3,
    help: 'Lloyd relaxation passes for more even cell distribution',
    group: 'Geometry',
  },
  tiltAmount: {
    name: 'Tilt Amount',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.65,
    help: 'How far cell normals deviate from vertical (0 = flat, 1 = maximum tilt)',
    group: 'Geometry',
  },
  lightAngle: {
    name: 'Light Angle',
    type: 'number', min: 0, max: 360, step: 5, default: 225,
    help: 'Horizontal direction of the light source in degrees (0=right, 90=down, 180=left, 270=up)',
    group: 'Geometry',
  },
  lightElevation: {
    name: 'Light Elevation',
    type: 'number', min: 5, max: 85, step: 5, default: 50,
    help: 'Vertical elevation of the light above the horizon in degrees',
    group: 'Geometry',
  },
  ambient: {
    name: 'Ambient',
    type: 'number', min: 0, max: 0.6, step: 0.05, default: 0.15,
    help: 'Minimum brightness in shadowed areas',
    group: 'Color',
  },
  specular: {
    name: 'Specular',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.45,
    help: 'Brightness of specular highlight on facing facets',
    group: 'Color',
  },
  shininess: {
    name: 'Shininess',
    type: 'number', min: 2, max: 64, step: 2, default: 12,
    help: 'Specular highlight sharpness — higher = smaller, harder glint',
    group: 'Texture',
  },
  borderWidth: {
    name: 'Border Width',
    type: 'number', min: 0, max: 4, step: 0.5, default: 1,
    group: 'Geometry',
  },
  colorMode: {
    name: 'Color Mode',
    type: 'select',
    options: ['By Index', 'By Position', 'By Normal-Z'],
    default: 'By Index',
    help: 'By Normal-Z: palette maps to how steeply each cell faces the viewer',
    group: 'Color',
  },
  distanceMetric: {
    name: 'Distance Metric',
    type: 'select',
    options: ['Euclidean', 'Manhattan', 'Chebyshev'],
    default: 'Euclidean',
    group: 'Geometry',
  },
  animSpeed: {
    name: 'Anim Speed',
    type: 'number', min: 0, max: 2, step: 0.05, default: 0.5,
    help: 'Controls both light rotation speed and site drift speed',
    group: 'Flow/Motion',
  },
  animAmp: {
    name: 'Site Drift',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0,
    help: '0 = only light rotates; >0 = cells also drift',
    group: 'Flow/Motion',
  },
};

export const depthCells: Generator = {
  id: 'voronoi-depth',
  family: 'voronoi',
  styleName: '3D-ish',
  definition: 'Each Voronoi cell receives a random surface normal and is shaded with Phong-like diffuse and specular lighting',
  algorithmNotes: 'Per-cell normals are generated on a spherical cap controlled by Tilt Amount. A directional light (configurable angle and elevation) illuminates each facet. Ambient + diffuse + specular produces gem/crystal appearance. During animation the light orbits the scene; optionally cells also drift.',
  parameterSchema,
  defaultParams: {
    cellCount: 40, relaxationSteps: 3, tiltAmount: 0.65,
    lightAngle: 225, lightElevation: 50,
    ambient: 0.15, specular: 0.45, shininess: 12,
    borderWidth: 1, colorMode: 'By Index', distanceMetric: 'Euclidean',
    animSpeed: 0.5, animAmp: 0,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    clearCanvas(ctx, w, h, '#000000');

    const rng = new SeededRNG(seed);
    const count = Math.max(5, params.cellCount | 0);
    const metric = params.distanceMetric || 'Euclidean';
    const steps = Math.max(0, (params.relaxationSteps ?? 3) | 0);
    const tilt = Math.max(0, Math.min(1, params.tiltAmount ?? 0.65));

    let baseSites = jitteredGrid(count, w, h, rng);

    const lstep = Math.max(2, Math.floor(Math.min(w, h) / 120));
    for (let pass = 0; pass < steps; pass++) {
      const sumX = new Array(count).fill(0), sumY = new Array(count).fill(0), cnt = new Array(count).fill(0);
      for (let y = 0; y < h; y += lstep) {
        for (let x = 0; x < w; x += lstep) {
          let best = 0, bestD = Infinity;
          for (let i = 0; i < count; i++) {
            const d = getDist(metric, x, y, baseSites[i][0], baseSites[i][1]);
            if (d < bestD) { bestD = d; best = i; }
          }
          sumX[best] += x; sumY[best] += y; cnt[best]++;
        }
      }
      for (let i = 0; i < count; i++) if (cnt[i] > 0) baseSites[i] = [sumX[i] / cnt[i], sumY[i] / cnt[i]];
    }

    // Per-cell random normals (spherical cap, z-dominant)
    const normals: [number, number, number][] = Array.from({ length: count }, () => {
      const phi = rng.random() * Math.PI * 2;
      const theta = rng.random() * tilt * Math.PI * 0.5;
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.sin(theta) * Math.sin(phi);
      const nz = Math.cos(theta);
      return [nx, ny, nz];
    });

    // Animate: light orbits, sites optionally drift
    const lightAngleDeg = (params.lightAngle ?? 225) + time * (params.animSpeed ?? 0.5) * 30;
    const lightAngleRad = lightAngleDeg * Math.PI / 180;
    const lightElevRad = (params.lightElevation ?? 50) * Math.PI / 180;
    const lx = Math.cos(lightAngleRad) * Math.cos(lightElevRad);
    const ly = Math.sin(lightAngleRad) * Math.cos(lightElevRad);
    const lz = Math.sin(lightElevRad);

    const avgCellSize = Math.sqrt((w * h) / count);
    const amp = (params.animAmp ?? 0) * avgCellSize;
    const sites = amp > 0
      ? animateSites(baseSites, amp, params.animSpeed ?? 0.5, time)
      : baseSites;

    const colors = palette.colors.map(hexToRgb);
    const ambient = params.ambient ?? 0.15;
    const specularStr = params.specular ?? 0.45;
    const shininess = params.shininess ?? 12;
    const borderW = params.borderWidth ?? 1;
    const colorMode = params.colorMode || 'By Index';
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        let d1 = Infinity, d2 = Infinity, nearest = 0;
        for (let i = 0; i < count; i++) {
          const d = getDist(metric, x, y, sites[i][0], sites[i][1]);
          if (d < d1) { d2 = d1; d1 = d; nearest = i; }
          else if (d < d2) { d2 = d; }
        }

        const isBorder = borderW > 0 && (d2 - d1) < borderW;
        let r: number, g: number, b: number;

        if (isBorder) {
          r = g = b = 0;
        } else {
          const [nx, ny, nz] = normals[nearest];

          // Phong shading
          const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
          // Specular: R = 2*(N·L)*N - L, view direction = (0,0,1)
          const dotNL = nx * lx + ny * ly + nz * lz;
          const rx = 2 * dotNL * nx - lx;
          const ry = 2 * dotNL * ny - ly;
          const rz = 2 * dotNL * nz - lz;
          const spec = specularStr * Math.pow(Math.max(0, rz), shininess);
          const brightness = ambient + diffuse * (1 - ambient);

          // Base color
          let base: [number, number, number];
          if (colorMode === 'By Position') {
            const t = (sites[nearest][0] / w + sites[nearest][1] / h) / 2;
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            base = [
              (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
              (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
              (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
            ];
          } else if (colorMode === 'By Normal-Z') {
            const t = nz; // 0 = horizontal cell, 1 = faces viewer
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            base = [
              (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
              (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
              (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
            ];
          } else {
            base = colors[nearest % colors.length];
          }

          r = Math.min(255, base[0] * brightness + spec * 255) | 0;
          g = Math.min(255, base[1] * brightness + spec * 255) | 0;
          b = Math.min(255, base[2] * brightness + spec * 255) | 0;
        }

        for (let sy = 0; sy < pstep && y + sy < h; sy++) {
          for (let sx = 0; sx < pstep && x + sx < w; sx++) {
            const idx = ((y + sy) * w + (x + sx)) * 4;
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  },

  renderWebGL2(gl, params, seed, palette, quality, time) {
    const c = gl.canvas as HTMLCanvasElement;
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    this.renderCanvas2D!(tmp.getContext('2d')!, params, seed, palette, quality, time);
  },

  estimateCost: (p) => p.cellCount * (250 + (p.relaxationSteps ?? 3) * 60),
};
