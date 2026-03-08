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

// Simplex noise implementation (2D and 3D)
export class SimplexNoise {
  private permutation: number[];
  private p: number[];

  constructor(seed: number) {
    const rng = new SeededRNG(seed);
    
    this.permutation = Array(256)
      .fill(0)
      .map((_, i) => i)
      .sort(() => rng.random() - 0.5);
    
    this.p = [...this.permutation, ...this.permutation];
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 8 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise2D(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    
    const u = this.fade(xf);
    const v = this.fade(yf);
    
    const aa = this.p[this.p[xi] + yi];
    const ab = this.p[this.p[xi] + yi + 1];
    const ba = this.p[this.p[xi + 1] + yi];
    const bb = this.p[this.p[xi + 1] + yi + 1];
    
    const g00 = this.grad(aa, xf, yf);
    const g10 = this.grad(ba, xf - 1, yf);
    const g01 = this.grad(ab, xf, yf - 1);
    const g11 = this.grad(bb, xf - 1, yf - 1);
    
    const nx0 = this.lerp(u, g00, g10);
    const nx1 = this.lerp(u, g01, g11);
    return this.lerp(v, nx0, nx1);
  }

  // Fractional Brownian Motion
  fbm(x: number, y: number, octaves: number = 4, lacunarity: number = 2.0, gain: number = 0.5): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }
}
