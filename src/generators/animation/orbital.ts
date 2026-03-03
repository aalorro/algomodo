import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  coreR: number, glowR: number,
  color: string, peakAlpha: number,
) {
  const grad = ctx.createRadialGradient(x, y, coreR * 0.2, x, y, glowR);
  grad.addColorStop(0,   hexToRgba(color, peakAlpha));
  grad.addColorStop(0.35, hexToRgba(color, peakAlpha * 0.5));
  grad.addColorStop(1,   hexToRgba(color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Keplerian orbital mechanics ─────────────────────────────────────────────
//
// Position relative to the focus (star / planet), at eccentric anomaly E:
//   lx = a*(cos(E) − e)     (semi-major, in orbit frame)
//   ly = b*sin(E)            b = a*√(1 − e²)
// Then rotate by argument-of-periapsis ω.
//
// At E=0: r = a(1−e) = periapsis ✓   At E=π: r = a(1+e) = apoapsis ✓

interface Body {
  semiMajor: number;
  ecc: number;
  omega: number;    // argument of periapsis
  phase: number;    // initial eccentric anomaly
  angSpeed: number; // rad / sim-second (already scaled by speed param)
  size: number;
  colorIdx: number;
  type: 'planet' | 'moon';
  parentIdx: number; // planet index for moons, -1 for planets
}

function posAtE(
  b: Body, E: number,
  parentX: number, parentY: number,
): [number, number] {
  const a   = b.semiMajor;
  const bb  = a * Math.sqrt(1 - b.ecc * b.ecc);
  const lx  = a * (Math.cos(E) - b.ecc);
  const ly  = bb * Math.sin(E);
  const cw  = Math.cos(b.omega), sw = Math.sin(b.omega);
  return [parentX + lx * cw - ly * sw, parentY + lx * sw + ly * cw];
}

// ─── Parameter schema ─────────────────────────────────────────────────────────

const parameterSchema: ParameterSchema = {
  bodyCount: {
    name: 'Planets',
    type: 'number', min: 1, max: 14, step: 1, default: 5,
    help: 'Number of planetary bodies',
    group: 'Composition',
  },
  moonChance: {
    name: 'Moon Chance',
    type: 'number', min: 0, max: 1, step: 0.1, default: 0.4,
    help: 'Probability that each planet hosts a moon',
    group: 'Composition',
  },
  orbitStyle: {
    name: 'Style',
    type: 'select',
    options: ['solar', 'binary'],
    default: 'solar',
    help: 'solar: single star system; binary: twin stars orbiting each other',
    group: 'Composition',
  },
  speed: {
    name: 'Speed',
    type: 'number', min: 0.1, max: 5, step: 0.1, default: 1,
    help: 'Orbital speed multiplier',
    group: 'Flow/Motion',
  },
  eccentricity: {
    name: 'Eccentricity',
    type: 'number', min: 0, max: 0.75, step: 0.05, default: 0.2,
    help: '0 = circular orbits; higher = elongated elliptical',
    group: 'Geometry',
  },
  minRadius: {
    name: 'Inner Orbit',
    type: 'number', min: 30, max: 250, step: 10, default: 80,
    group: 'Geometry',
  },
  maxRadius: {
    name: 'Outer Orbit',
    type: 'number', min: 100, max: 600, step: 10, default: 380,
    group: 'Geometry',
  },
  bodySize: {
    name: 'Body Size',
    type: 'number', min: 2, max: 24, step: 1, default: 9,
    group: 'Geometry',
  },
  glowIntensity: {
    name: 'Glow',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.65,
    help: 'Intensity of glow halos on stars and planets',
    group: 'Texture',
  },
  trailLength: {
    name: 'Trail',
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.4,
    help: 'Fraction of orbit arc shown as a fading trail behind each body',
    group: 'Texture',
  },
};

// ─── Generator ────────────────────────────────────────────────────────────────

export const orbital: Generator = {
  id: 'orbital',
  family: 'animation',
  styleName: 'Orbital Mechanics',
  definition: 'Keplerian elliptical orbits — planets, moons, and a glowing star in a living solar system',
  algorithmNotes:
    'Bodies follow true Keplerian ellipses (eccentric anomaly parametrisation). Angular speed scales ' +
    'with a^(−3/2) per Kepler\'s 3rd law, so inner planets race while outer ones drift. Moons orbit ' +
    'their parent planet with a separate ellipse. Positions are fully analytical — no stored state — so ' +
    'static and animated renders are equally sharp. Analytical trail arcs (computed backward along each ' +
    'orbit) give smooth fading histories. A radial-gradient glow and a specular highlight simulate starlight.',
  parameterSchema,
  defaultParams: {
    bodyCount: 5, moonChance: 0.4, orbitStyle: 'solar',
    speed: 1, eccentricity: 0.2,
    minRadius: 80, maxRadius: 380,
    bodySize: 9, glowIntensity: 0.65, trailLength: 0.4,
  },
  supportsVector: false,
  supportsWebGPU: false,
  supportsAnimation: true,

  renderCanvas2D(ctx, params, seed, palette, _quality, time = 0) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;

    const bodyCount    = Math.round(params.bodyCount    ?? 5);
    const moonChance   = params.moonChance   ?? 0.4;
    const orbitStyle   = (params.orbitStyle  ?? 'solar') as string;
    const speed        = params.speed        ?? 1;
    const eccentricity = params.eccentricity ?? 0.2;
    const minRadius    = params.minRadius    ?? 80;
    const maxRadius    = params.maxRadius    ?? 380;
    const bodySize     = params.bodySize     ?? 9;
    const glowInt      = params.glowIntensity ?? 0.65;
    const trailFrac    = params.trailLength  ?? 0.4;

    // ── Deep-space background (solid, every frame) ───────────────────────
    ctx.fillStyle = '#04040c';
    ctx.fillRect(0, 0, w, h);

    // Subtle star-field (deterministic scatter from seed)
    {
      const srng = new SeededRNG(seed ^ 0xdeadbeef);
      const starCount = Math.floor(w * h * 0.00015);
      for (let i = 0; i < starCount; i++) {
        const sx = srng.range(0, w);
        const sy = srng.range(0, h);
        const sb = srng.range(0.2, 0.9);
        ctx.fillStyle = `rgba(255,255,255,${sb})`;
        ctx.fillRect(sx, sy, 1, 1);
      }
    }

    // ── Build body definitions (same seed → same layout every frame) ─────
    const rng = new SeededRNG(seed);

    const planets: Body[] = [];
    const moons:   Body[] = [];

    const orbitStep = (maxRadius - minRadius) / Math.max(bodyCount, 1);

    for (let i = 0; i < bodyCount; i++) {
      const semiMajor = minRadius + orbitStep * (i + 0.5 + rng.range(-0.25, 0.25));
      const ecc       = rng.range(0, eccentricity);
      const omega     = rng.range(0, Math.PI * 2);
      const phase     = rng.range(0, Math.PI * 2);
      // Kepler's 3rd law: ω ∝ a^(−3/2); normalise so inner orbit has ω = speed
      const angSpeed  = speed * Math.pow(minRadius / semiMajor, 1.5);
      const colorIdx  = i % palette.colors.length;
      const size      = bodySize * rng.range(0.55, 1.45);

      planets.push({ semiMajor, ecc, omega, phase, angSpeed, size, colorIdx, type: 'planet', parentIdx: -1 });

      if (rng.random() < moonChance) {
        const ms  = size * rng.range(0.15, 0.42);
        const ma  = size * rng.range(2.8, 6.5);
        moons.push({
          semiMajor: ma,
          ecc:       rng.range(0, 0.28),
          omega:     rng.range(0, Math.PI * 2),
          phase:     rng.range(0, Math.PI * 2),
          angSpeed:  angSpeed * rng.range(3, 10),
          size:      ms,
          colorIdx:  (i + 2) % palette.colors.length,
          type:      'moon',
          parentIdx: i,
        });
      }
    }

    // ── Binary star positions ─────────────────────────────────────────────
    const isBinary = orbitStyle === 'binary';
    const binaryPulse = isBinary
      ? speed * Math.pow(minRadius / (minRadius * 0.55), 1.5) * 0.5 : 0;
    const binarySep = minRadius * 0.55;
    const star1x = isBinary ? cx + Math.cos(binaryPulse * time) * binarySep * 0.5 : cx;
    const star1y = isBinary ? cy + Math.sin(binaryPulse * time) * binarySep * 0.5 : cy;
    const star2x  = isBinary ? cx - Math.cos(binaryPulse * time) * binarySep * 0.5 : 0;
    const star2y  = isBinary ? cy - Math.sin(binaryPulse * time) * binarySep * 0.5 : 0;

    // ── Compute planet positions at current time ──────────────────────────
    const planetPos: [number, number][] = planets.map(p =>
      posAtE(p, p.phase + p.angSpeed * time, cx, cy)
    );

    const moonPos: [number, number][] = moons.map(m => {
      const [ppx, ppy] = planetPos[m.parentIdx];
      return posAtE(m, m.phase + m.angSpeed * time, ppx, ppy);
    });

    // ── Draw orbit path ellipses (faint) ──────────────────────────────────
    for (let i = 0; i < planets.length; i++) {
      const p  = planets[i];
      const a  = p.semiMajor;
      const b  = a * Math.sqrt(1 - p.ecc * p.ecc);
      // Centre of ellipse = focus + (−a·e) rotated by ω
      const ecx = cx - a * p.ecc * Math.cos(p.omega);
      const ecy = cy - a * p.ecc * Math.sin(p.omega);
      ctx.strokeStyle = hexToRgba(palette.colors[p.colorIdx], 0.10);
      ctx.lineWidth = 0.6;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, a, b, p.omega, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Moon orbit ellipses (centered on current planet position)
    for (let i = 0; i < moons.length; i++) {
      const m  = moons[i];
      const a  = m.semiMajor;
      const b  = a * Math.sqrt(1 - m.ecc * m.ecc);
      const [ppx, ppy] = planetPos[m.parentIdx];
      const ecx = ppx - a * m.ecc * Math.cos(m.omega);
      const ecy = ppy - a * m.ecc * Math.sin(m.omega);
      ctx.strokeStyle = hexToRgba(palette.colors[m.colorIdx], 0.08);
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, a, b, m.omega, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Draw analytical trail arcs ─────────────────────────────────────────
    //
    // Trace TRAIL_STEPS line segments backward along the orbit from the
    // current eccentric anomaly, fading opacity to zero at the tail.

    const TRAIL_STEPS = 32;

    const drawTrail = (
      body: Body,
      currentE: number,
      parentX: number, parentY: number,
      color: string,
    ) => {
      if (trailFrac <= 0) return;
      const arc = trailFrac * Math.PI; // max arc length in radians
      for (let i = 0; i < TRAIL_STEPS; i++) {
        const E0 = currentE - arc * (i + 1) / TRAIL_STEPS;
        const E1 = currentE - arc * i       / TRAIL_STEPS;
        const [x0, y0] = posAtE(body, E0, parentX, parentY);
        const [x1, y1] = posAtE(body, E1, parentX, parentY);
        const alpha = (1 - (i + 1) / TRAIL_STEPS) * 0.85;
        const lw    = body.size * 0.5 * (1 - i / TRAIL_STEPS);
        ctx.strokeStyle = hexToRgba(color, alpha);
        ctx.lineWidth   = Math.max(0.5, lw);
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    };

    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      drawTrail(p, p.phase + p.angSpeed * time, cx, cy, palette.colors[p.colorIdx]);
    }
    for (let i = 0; i < moons.length; i++) {
      const m = moons[i];
      const [ppx, ppy] = planetPos[m.parentIdx];
      drawTrail(m, m.phase + m.angSpeed * time, ppx, ppy, palette.colors[m.colorIdx]);
    }

    // ── Draw stars ────────────────────────────────────────────────────────

    const drawStar = (sx: number, sy: number, starR: number, color: string, pulse: number) => {
      // Wide corona glow
      if (glowInt > 0) {
        drawGlow(ctx, sx, sy, starR, starR * 7 * glowInt * pulse, color, 0.45 * glowInt);
        // Tighter bright ring
        drawGlow(ctx, sx, sy, starR, starR * 3 * pulse, '#ffffff', 0.3 * glowInt);
      }
      // Solid colour disc
      ctx.fillStyle = hexToRgba(color, 0.9);
      ctx.beginPath();
      ctx.arc(sx, sy, starR * pulse, 0, Math.PI * 2);
      ctx.fill();
      // White hot core
      const coreGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, starR * pulse);
      coreGrad.addColorStop(0,   'rgba(255,255,255,0.95)');
      coreGrad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
      coreGrad.addColorStop(1,   hexToRgba(color, 0));
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, starR * pulse, 0, Math.PI * 2);
      ctx.fill();
    };

    const starR  = bodySize * 1.6;
    const pulse  = 1 + 0.06 * Math.sin(time * 2.3);
    drawStar(star1x, star1y, starR, palette.colors[0], pulse);
    if (isBinary) {
      const col2 = palette.colors[Math.min(1, palette.colors.length - 1)];
      drawStar(star2x, star2y, starR * 0.8, col2, 1 + 0.06 * Math.sin(time * 2.3 + 1.4));
    }

    // ── Draw planets ─────────────────────────────────────────────────────

    const drawBody = (
      bx: number, by: number,
      bSize: number,
      color: string,
      alpha: number,
      starX: number, starY: number,
    ) => {
      // Glow halo
      if (glowInt > 0) {
        drawGlow(ctx, bx, by, bSize, bSize * 3.5 * glowInt, color, 0.6 * glowInt);
      }
      // Body disc
      ctx.fillStyle = hexToRgba(color, alpha);
      ctx.beginPath();
      ctx.arc(bx, by, bSize, 0, Math.PI * 2);
      ctx.fill();
      // Specular highlight (simulated starlight)
      const dx = starX - bx, dy = starY - by;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const hx = bx - (dx / dist) * bSize * 0.28;
      const hy = by - (dy / dist) * bSize * 0.28;
      const hgrad = ctx.createRadialGradient(hx, hy, 0, bx, by, bSize);
      hgrad.addColorStop(0,   'rgba(255,255,255,0.42)');
      hgrad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      hgrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = hgrad;
      ctx.beginPath();
      ctx.arc(bx, by, bSize, 0, Math.PI * 2);
      ctx.fill();
    };

    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const [px, py] = planetPos[i];
      drawBody(px, py, p.size, palette.colors[p.colorIdx], 0.92, star1x, star1y);
    }

    for (let i = 0; i < moons.length; i++) {
      const m = moons[i];
      const [mx, my] = moonPos[i];
      drawBody(mx, my, m.size, palette.colors[m.colorIdx], 0.80, star1x, star1y);
    }
  },

  estimateCost(params) {
    return Math.round(params.bodyCount * 150 + (params.moonChance ?? 0.4) * params.bodyCount * 80);
  },
};
