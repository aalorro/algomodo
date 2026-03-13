import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';
import { clearCanvas } from '../../renderers/canvas2d/utils';
import {
  hexToRgb, metricFromName, jitteredGridFlat, animateSitesFlat,
  buildSiteGrid, findNearest, lloydRelax,
} from './voronoi-utils';

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
  algorithmNotes: 'Grid-accelerated Lloyd relaxation and rendering. Flat Float64Array sites with spatial grid (5×5 search). Pre-computed specular lookup table (256 entries) eliminates per-pixel Math.pow. Per-cell normals on a spherical cap; directional light with ambient + diffuse + specular.',
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
    const metric = metricFromName(params.distanceMetric || 'Euclidean');
    const steps = Math.max(0, (params.relaxationSteps ?? 3) | 0);
    const tilt = Math.max(0, Math.min(1, params.tiltAmount ?? 0.65));

    const baseSites = jitteredGridFlat(count, w, h, rng);

    const lstep = Math.max(2, Math.floor(Math.min(w, h) / 120));
    lloydRelax(baseSites, count, w, h, metric, steps, lstep);

    // Per-cell random normals (spherical cap, z-dominant)
    const normals = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      const phi = rng.random() * Math.PI * 2;
      const theta = rng.random() * tilt * Math.PI * 0.5;
      normals[i * 3]     = Math.sin(theta) * Math.cos(phi);
      normals[i * 3 + 1] = Math.sin(theta) * Math.sin(phi);
      normals[i * 3 + 2] = Math.cos(theta);
    }

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
      ? animateSitesFlat(baseSites, count, amp, params.animSpeed ?? 0.5, time)
      : baseSites;

    const grid = buildSiteGrid(sites, count, w, h);
    const colors = palette.colors.map(hexToRgb);
    const ambient = params.ambient ?? 0.15;
    const specularStr = params.specular ?? 0.45;
    const shininess = params.shininess ?? 12;
    const borderW = params.borderWidth ?? 1;
    const colorMode = params.colorMode || 'By Index';
    const pstep = quality === 'draft' ? 3 : quality === 'balanced' ? 2 : 1;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Pre-compute specular LUT to avoid per-pixel Math.pow
    const specLUT = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      specLUT[i] = specularStr * Math.pow(i / 255, shininess);
    }

    for (let y = 0; y < h; y += pstep) {
      for (let x = 0; x < w; x += pstep) {
        const { nearest, d1, d2 } = findNearest(x, y, sites, grid, metric);

        const isBorder = borderW > 0 && (d2 - d1) < borderW;
        let r: number, g: number, b: number;

        if (isBorder) {
          r = g = b = 0;
        } else {
          const ni = nearest * 3;
          const nx = normals[ni], ny2 = normals[ni + 1], nz = normals[ni + 2];

          // Phong shading
          const diffuse = Math.max(0, nx * lx + ny2 * ly + nz * lz);
          // Specular: R = 2*(N·L)*N - L, view direction = (0,0,1)
          const dotNL = nx * lx + ny2 * ly + nz * lz;
          const rz = 2 * dotNL * nz - lz;
          const specIdx = Math.max(0, Math.min(255, (Math.max(0, rz) * 255) | 0));
          const spec = specLUT[specIdx];
          const brightness = ambient + diffuse * (1 - ambient);

          // Base color
          let base: [number, number, number];
          if (colorMode === 'By Position') {
            const si2 = nearest * 2;
            const t = (sites[si2] / w + sites[si2 + 1] / h) / 2;
            const ci = t * (colors.length - 1);
            const i0 = Math.floor(ci), i1 = Math.min(colors.length - 1, i0 + 1);
            const f = ci - i0;
            base = [
              (colors[i0][0] + (colors[i1][0] - colors[i0][0]) * f) | 0,
              (colors[i0][1] + (colors[i1][1] - colors[i0][1]) * f) | 0,
              (colors[i0][2] + (colors[i1][2] - colors[i0][2]) * f) | 0,
            ];
          } else if (colorMode === 'By Normal-Z') {
            const t = nz;
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
