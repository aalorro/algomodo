/**
 * Shared Voronoi utilities — spatial grid acceleration, flat Float64Array site storage,
 * numeric metric dispatch. Used by all Voronoi family generators.
 */
import { SeededRNG } from '../../core/rng';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SiteGrid {
  cells: Int32Array;
  offsets: Int32Array;
  counts: Int32Array;
  size: number;       // grid cells per axis
  invW: number;       // 1/canvasWidth  (for normalisation)
  invH: number;       // 1/canvasHeight
}

// Metric constants — avoid per-pixel string comparison
export const METRIC_EUCLIDEAN = 0;
export const METRIC_MANHATTAN = 1;
export const METRIC_CHEBYSHEV = 2;

// ── Helpers ─────────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function metricFromName(name: string): number {
  if (name === 'Manhattan' || name === 'manhattan') return METRIC_MANHATTAN;
  if (name === 'Chebyshev' || name === 'chebyshev') return METRIC_CHEBYSHEV;
  return METRIC_EUCLIDEAN;
}

// ── Site generation — flat Float64Array [x0,y0, x1,y1, …] in pixel space ──

export function jitteredGridFlat(count: number, w: number, h: number, rng: SeededRNG): Float64Array {
  const cols = Math.ceil(Math.sqrt(count * (w / h)));
  const rows = Math.ceil(count / cols);
  const cw = w / cols, ch = h / rows;
  const out = new Float64Array(count * 2);
  let idx = 0;
  for (let r = 0; r < rows && idx < count * 2; r++) {
    for (let c = 0; c < cols && idx < count * 2; c++) {
      out[idx++] = (c + 0.2 + rng.random() * 0.6) * cw;
      out[idx++] = (r + 0.2 + rng.random() * 0.6) * ch;
    }
  }
  while (idx < count * 2) { out[idx++] = rng.random() * w; out[idx++] = rng.random() * h; }
  return out;
}

// ── Animation — Lissajous drift per site ────────────────────────────────────

export function animateSitesFlat(
  base: Float64Array, count: number, amp: number, speed: number, time: number,
): Float64Array {
  const out = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    const ph = i * 2.39996;
    const i2 = i * 2;
    out[i2]     = base[i2]     + Math.cos(time * speed + ph) * amp;
    out[i2 + 1] = base[i2 + 1] + Math.sin(time * speed * 1.3 + ph * 1.7) * amp;
  }
  return out;
}

// ── Spatial grid — O(~20) lookups instead of O(n) ───────────────────────────

export function buildSiteGrid(sites: Float64Array, count: number, w: number, h: number): SiteGrid {
  const gs = Math.max(4, Math.ceil(Math.sqrt(count)));
  const n = gs * gs;
  const invW = gs / w, invH = gs / h;

  const counts = new Int32Array(n);
  for (let i = 0; i < count; i++) {
    const gx = Math.min(gs - 1, Math.max(0, (sites[i * 2] * invW) | 0));
    const gy = Math.min(gs - 1, Math.max(0, (sites[i * 2 + 1] * invH) | 0));
    counts[gy * gs + gx]++;
  }

  const offsets = new Int32Array(n);
  for (let i = 1; i < n; i++) offsets[i] = offsets[i - 1] + counts[i - 1];

  const total = offsets[n - 1] + counts[n - 1];
  const cells = new Int32Array(total);
  const pos = new Int32Array(n);

  for (let i = 0; i < count; i++) {
    const gx = Math.min(gs - 1, Math.max(0, (sites[i * 2] * invW) | 0));
    const gy = Math.min(gs - 1, Math.max(0, (sites[i * 2 + 1] * invH) | 0));
    const ci = gy * gs + gx;
    cells[offsets[ci] + pos[ci]] = i;
    pos[ci]++;
  }

  return { cells, offsets, counts, size: gs, invW: 1 / w, invH: 1 / h };
}

// ── Grid-accelerated nearest-neighbor (f1 + f2) ────────────────────────────

/** Returns nearest site index, d1 (nearest dist), d2 (2nd nearest dist). */
export function findNearest(
  x: number, y: number,
  sites: Float64Array, grid: SiteGrid,
  metric: number,
): { nearest: number; d1: number; d2: number } {
  const gs = grid.size;
  const gx = Math.min(gs - 1, Math.max(0, (x * grid.invW * gs) | 0));
  const gy = Math.min(gs - 1, Math.max(0, (y * grid.invH * gs) | 0));

  let d1 = Infinity, d2 = Infinity, nearest = 0;
  const useSquared = metric === METRIC_EUCLIDEAN;

  const ylo = gy > 1 ? gy - 2 : 0;
  const yhi = gy < gs - 2 ? gy + 2 : gs - 1;
  const xlo = gx > 1 ? gx - 2 : 0;
  const xhi = gx < gs - 2 ? gx + 2 : gs - 1;

  for (let cy = ylo; cy <= yhi; cy++) {
    const rowOff = cy * gs;
    for (let cx = xlo; cx <= xhi; cx++) {
      const ci = rowOff + cx;
      const off = grid.offsets[ci];
      const cnt = grid.counts[ci];
      for (let k = 0; k < cnt; k++) {
        const si = grid.cells[off + k];
        const si2 = si * 2;
        const dx = x - sites[si2];
        const dy = y - sites[si2 + 1];
        let d: number;
        if (useSquared) {
          d = dx * dx + dy * dy;
        } else if (metric === METRIC_MANHATTAN) {
          d = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
        } else {
          d = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy);
        }
        if (d < d1) { d2 = d1; d1 = d; nearest = si; }
        else if (d < d2) { d2 = d; }
      }
    }
  }

  // Convert squared distances back to actual distances for Euclidean
  if (useSquared) { d1 = Math.sqrt(d1); d2 = Math.sqrt(d2); }

  return { nearest, d1, d2 };
}

/** Lightweight variant — only returns nearest index (no d2 tracking). */
export function findNearestOnly(
  x: number, y: number,
  sites: Float64Array, grid: SiteGrid,
  metric: number,
): number {
  const gs = grid.size;
  const gx = Math.min(gs - 1, Math.max(0, (x * grid.invW * gs) | 0));
  const gy = Math.min(gs - 1, Math.max(0, (y * grid.invH * gs) | 0));

  let d1 = Infinity, nearest = 0;

  const ylo = gy > 1 ? gy - 2 : 0;
  const yhi = gy < gs - 2 ? gy + 2 : gs - 1;
  const xlo = gx > 1 ? gx - 2 : 0;
  const xhi = gx < gs - 2 ? gx + 2 : gs - 1;

  for (let cy = ylo; cy <= yhi; cy++) {
    const rowOff = cy * gs;
    for (let cx = xlo; cx <= xhi; cx++) {
      const ci = rowOff + cx;
      const off = grid.offsets[ci];
      const cnt = grid.counts[ci];
      for (let k = 0; k < cnt; k++) {
        const si = grid.cells[off + k];
        const si2 = si * 2;
        const dx = x - sites[si2];
        const dy = y - sites[si2 + 1];
        let d: number;
        if (metric === METRIC_EUCLIDEAN) {
          d = dx * dx + dy * dy;
        } else if (metric === METRIC_MANHATTAN) {
          d = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
        } else {
          d = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy);
        }
        if (d < d1) { d1 = d; nearest = si; }
      }
    }
  }
  return nearest;
}

// ── Grid-accelerated k-nearest ──────────────────────────────────────────────

/**
 * Finds the k nearest distances and site indices.
 * Results written into caller-provided buffers (reuse across pixels).
 * distBuf[0..k-1] = sorted distances (ascending), idxBuf[0..k-1] = site indices.
 */
export function findKNearest(
  x: number, y: number,
  sites: Float64Array, grid: SiteGrid,
  metric: number, k: number,
  distBuf: Float32Array, idxBuf: Int32Array,
): void {
  // Initialize to Infinity
  for (let i = 0; i < k; i++) { distBuf[i] = Infinity; idxBuf[i] = -1; }

  const gs = grid.size;
  const gx = Math.min(gs - 1, Math.max(0, (x * grid.invW * gs) | 0));
  const gy = Math.min(gs - 1, Math.max(0, (y * grid.invH * gs) | 0));
  const useSquared = metric === METRIC_EUCLIDEAN;

  // Wider search for k-nearest — 3 cells each direction
  const ylo = gy > 2 ? gy - 3 : 0;
  const yhi = gy < gs - 3 ? gy + 3 : gs - 1;
  const xlo = gx > 2 ? gx - 3 : 0;
  const xhi = gx < gs - 3 ? gx + 3 : gs - 1;

  const km1 = k - 1;

  for (let cy = ylo; cy <= yhi; cy++) {
    const rowOff = cy * gs;
    for (let cx = xlo; cx <= xhi; cx++) {
      const ci = rowOff + cx;
      const off = grid.offsets[ci];
      const cnt = grid.counts[ci];
      for (let j = 0; j < cnt; j++) {
        const si = grid.cells[off + j];
        const si2 = si * 2;
        const dx = x - sites[si2];
        const dy = y - sites[si2 + 1];
        let d: number;
        if (useSquared) {
          d = dx * dx + dy * dy;
        } else if (metric === METRIC_MANHATTAN) {
          d = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
        } else {
          d = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy);
        }
        if (d < distBuf[km1]) {
          distBuf[km1] = d;
          idxBuf[km1] = si;
          // Insertion sort into sorted position
          let p = km1;
          while (p > 0 && distBuf[p] < distBuf[p - 1]) {
            // Swap dist
            const td = distBuf[p]; distBuf[p] = distBuf[p - 1]; distBuf[p - 1] = td;
            // Swap idx
            const ti = idxBuf[p]; idxBuf[p] = idxBuf[p - 1]; idxBuf[p - 1] = ti;
            p--;
          }
        }
      }
    }
  }

  // Convert squared → actual for Euclidean
  if (useSquared) {
    for (let i = 0; i < k; i++) {
      if (isFinite(distBuf[i])) distBuf[i] = Math.sqrt(distBuf[i]);
    }
  }
}

// ── Lloyd relaxation (in-place mutation) ────────────────────────────────────

/**
 * Relaxes sites toward Voronoi cell centroids.
 * Mutates `sites` Float64Array in-place. Rebuilds grid each pass.
 */
export function lloydRelax(
  sites: Float64Array, count: number,
  w: number, h: number,
  metric: number, passes: number, sampleStep: number,
): void {
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const cnt = new Int32Array(count);

  for (let pass = 0; pass < passes; pass++) {
    const grid = buildSiteGrid(sites, count, w, h);
    sumX.fill(0); sumY.fill(0); cnt.fill(0);

    for (let y = 0; y < h; y += sampleStep) {
      for (let x = 0; x < w; x += sampleStep) {
        const best = findNearestOnly(x, y, sites, grid, metric);
        sumX[best] += x;
        sumY[best] += y;
        cnt[best]++;
      }
    }

    for (let i = 0; i < count; i++) {
      if (cnt[i] > 0) {
        sites[i * 2] = sumX[i] / cnt[i];
        sites[i * 2 + 1] = sumY[i] / cnt[i];
      }
    }
  }
}
