// Deterministic seeded random number generator
// Based on xorshift128+ for high quality pseudo-random numbers

export class SeededRNG {
  private x: number;
  private y: number;
  private z: number;
  private w: number;

  constructor(seed: number) {
    this.x = seed;
    this.y = seed ^ 123456;
    this.z = seed ^ 789012;
    this.w = seed ^ 345678;
    
    // Warm up the generator
    for (let i = 0; i < 100; i++) {
      this.next();
    }
  }

  private next(): number {
    let t = this.x ^ (this.x << 11);
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = this.w ^ (this.w >>> 19) ^ t ^ (t >>> 8);
    return (this.w >>> 0) / 0x100000000;
  }

  // Returns random number between 0 and 1
  random(): number {
    return this.next();
  }

  // Returns random integer between min and max (inclusive)
  integer(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  // Returns random number in range [min, max)
  range(min: number, max: number): number {
    return this.random() * (max - min) + min;
  }

  // Gaussian distribution
  gaussian(mean: number = 0, stdDev: number = 1): number {
    const u1 = this.random();
    const u2 = this.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * stdDev + mean;
  }

  // Random point on a unit circle
  randomAngle(): number {
    return this.random() * Math.PI * 2;
  }

  // Random point in a circle
  randomPointInCircle(radius: number = 1): [number, number] {
    const angle = this.randomAngle();
    const r = Math.sqrt(this.random()) * radius;
    return [Math.cos(angle) * r, Math.sin(angle) * r];
  }

  // Random point in unit square
  randomPoint(): [number, number] {
    return [this.random(), this.random()];
  }

  // Shuffle array in place using Fisher-Yates
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.integer(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Pick random element from array
  pick<T>(array: T[]): T {
    return array[this.integer(0, array.length - 1)];
  }

  // Pick n random elements
  pickN<T>(array: T[], n: number): T[] {
    return this.shuffle(array).slice(0, n);
  }
}

// Optimised 2D gradient noise with inlined helpers and typed permutation table
export class SimplexNoise {
  private readonly p: Int32Array;

  constructor(seed: number) {
    const rng = new SeededRNG(seed);

    // Build permutation (same sort-based shuffle to preserve seed-to-output determinism)
    const perm = Array(256).fill(0).map((_, i) => i).sort(() => rng.random() - 0.5);
    const p = new Int32Array(512);
    for (let i = 0; i < 256; i++) { p[i] = perm[i]; p[i + 256] = perm[i]; }
    this.p = p;
  }

  noise2D(x: number, y: number): number {
    const p = this.p;

    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const xi = floorX & 255;
    const yi = floorY & 255;

    const xf = x - floorX;
    const yf = y - floorY;

    // Inline fade (quintic smoothstep)
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

    const aa = p[p[xi] + yi];
    const ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi];
    const bb = p[p[xi + 1] + yi + 1];

    // Inline grad for all 4 corners
    let h: number, gu: number, gv: number;

    h = aa & 15;
    gu = h < 8 ? xf : yf;
    gv = h < 8 ? yf : xf;
    const g00 = ((h & 1) === 0 ? gu : -gu) + ((h & 2) === 0 ? gv : -gv);

    const xf1 = xf - 1;
    h = ba & 15;
    gu = h < 8 ? xf1 : yf;
    gv = h < 8 ? yf : xf1;
    const g10 = ((h & 1) === 0 ? gu : -gu) + ((h & 2) === 0 ? gv : -gv);

    const yf1 = yf - 1;
    h = ab & 15;
    gu = h < 8 ? xf : yf1;
    gv = h < 8 ? yf1 : xf;
    const g01 = ((h & 1) === 0 ? gu : -gu) + ((h & 2) === 0 ? gv : -gv);

    h = bb & 15;
    gu = h < 8 ? xf1 : yf1;
    gv = h < 8 ? yf1 : xf1;
    const g11 = ((h & 1) === 0 ? gu : -gu) + ((h & 2) === 0 ? gv : -gv);

    // Inline lerp (bilinear interpolation)
    const nx0 = g00 + u * (g10 - g00);
    const nx1 = g01 + u * (g11 - g01);
    return nx0 + v * (nx1 - nx0);
  }

  // Fractional Brownian Motion
  fbm(x: number, y: number, octaves: number = 4, lacunarity: number = 2.0, gain: number = 0.5): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;

    // Precompute normalisation: geometric series (1 - g^n) / (1 - g)
    const maxValue = gain === 1 ? octaves : (1 - Math.pow(gain, octaves)) / (1 - gain);

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}
