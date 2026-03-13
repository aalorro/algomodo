import type { Generator, ParameterSchema } from '../../types';
import { SeededRNG } from '../../core/rng';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TAU = Math.PI * 2;

const parameterSchema: ParameterSchema = {
  bandCount: {
    name: 'Bands', type: 'number', min: 8, max: 128, step: 8, default: 32,
    help: 'Frequency band count',
    group: 'Composition',
  },
  style: {
    name: 'Style', type: 'select',
    options: ['bars', 'radial', 'rings', 'waveform'],
    default: 'bars',
    help: 'bars: vertical EQ | radial: spoke burst | rings: concentric | waveform: continuous wave',
    group: 'Composition',
  },
  reactivity: {
    name: 'Reactivity', type: 'number', min: 0.1, max: 2, step: 0.1, default: 1.0,
    help: 'Amplitude scaling factor',
    group: 'Flow/Motion',
  },
  beatRate: {
    name: 'Beat Rate', type: 'number', min: 0.5, max: 4, step: 0.25, default: 1.5,
    help: 'Simulated beat frequency (Hz)',
    group: 'Flow/Motion',
  },
  smoothing: {
    name: 'Smoothing', type: 'number', min: 0, max: 0.95, step: 0.05, default: 0.5,
    help: 'Temporal smoothing of spectrum',
    group: 'Texture',
  },
  symmetry: {
    name: 'Symmetry', type: 'boolean', default: false,
    help: 'Mirror the visualization',
    group: 'Geometry',
  },
  speed: {
    name: 'Speed', type: 'number', min: 0.25, max: 3, step: 0.25, default: 1,
    help: 'Overall animation speed',
    group: 'Flow/Motion',
  },
};

/** Synthesize a deterministic spectrum from seed + time */
function synthesizeSpectrum(
  bandCount: number, seed: number, time: number,
  reactivity: number, smoothing: number, beatRate: number,
): Float32Array {
  const rng = new SeededRNG(seed);
  const amplitudes = new Float32Array(bandCount);
  const HARMONICS = 4;

  // Pre-generate per-band harmonic data from seed
  const phases: number[] = [];
  const amps: number[] = [];
  const freqs: number[] = [];
  for (let i = 0; i < bandCount * HARMONICS; i++) {
    phases.push(rng.random() * TAU);
    amps.push(rng.range(0.15, 1.0));
    freqs.push(rng.range(0.3, 2.5));
  }

  for (let i = 0; i < bandCount; i++) {
    let v = 0;
    const freqBias = (i + 1) / bandCount; // higher bands = higher visual freq
    for (let k = 0; k < HARMONICS; k++) {
      const idx = i * HARMONICS + k;
      v += amps[idx] * Math.sin(time * freqs[idx] + phases[idx] + freqBias * 3);
    }
    v = Math.abs(v) / HARMONICS;

    // Simple temporal smoothing approximation (average over short window)
    if (smoothing > 0) {
      const dt = 0.016; // ~60fps
      let smoothed = v;
      for (let s = 1; s <= 3; s++) {
        let vs = 0;
        const ts = time - s * dt;
        for (let k = 0; k < HARMONICS; k++) {
          const idx = i * HARMONICS + k;
          vs += amps[idx] * Math.sin(ts * freqs[idx] + phases[idx] + freqBias * 3);
        }
        vs = Math.abs(vs) / HARMONICS;
        smoothed += vs * smoothing;
      }
      v = smoothed / (1 + 3 * smoothing);
    }

    amplitudes[i] = v * reactivity;
  }

  // Beat pulse
  const beat = Math.pow(Math.max(0, Math.sin(time * beatRate * Math.PI)), 8);
  for (let i = 0; i < bandCount; i++) {
    amplitudes[i] *= (1 + beat * 1.8);
    amplitudes[i] = Math.min(1.5, amplitudes[i]);
  }

  return amplitudes;
}

export const audioReactive: Generator = {
  id: 'procedural-audio-reactive',
  family: 'procedural',
  styleName: 'Audio-Reactive',
  definition: 'Simulated audio-reactive visualization with synthesized spectrum, beat detection, and multiple display styles',
  algorithmNotes:
    'Generates a deterministic fake audio spectrum from layered sine waves seeded by the RNG. Beat detection is simulated via a sharp periodic pulse. Four visualization styles: vertical frequency bars, radial spoke burst, concentric amplitude rings, and continuous waveform. Spectrum evolves smoothly with time.',
  parameterSchema,
  defaultParams: {
    bandCount: 32, style: 'bars', reactivity: 1.0, beatRate: 1.5,
    smoothing: 0.5, symmetry: false, speed: 1,
  },
  supportsVector: false, supportsWebGPU: false, supportsAnimation: true, supportsAudio: true,

  renderCanvas2D(ctx, params, seed, palette, quality, time = 0) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const cx = w / 2, cy = h / 2;
    const minDim = Math.min(w, h);

    const bandCount = Math.max(4, params.bandCount ?? 32) | 0;
    const style = params.style || 'bars';
    const reactivity = params.reactivity ?? 1.0;
    const beatRate = params.beatRate ?? 1.5;
    const smoothing = params.smoothing ?? 0.5;
    const doSymmetry = params.symmetry ?? false;
    const spd = params.speed ?? 1;
    const t = time * spd;

    const colors = palette.colors.map(hexToRgb);
    const nC = colors.length;

    // Use real audio data when available, otherwise synthesize
    const realAudio: Float32Array | null = params._audioData ?? null;
    const audioBass = params._audioBass ?? 0;

    // Background
    const beat = realAudio
      ? Math.pow(Math.min(1, audioBass * 3), 4)
      : Math.pow(Math.max(0, Math.sin(t * beatRate * Math.PI)), 8);
    const bgBright = Math.round(8 + beat * 12);
    ctx.fillStyle = `rgb(${bgBright},${bgBright},${bgBright + 2})`;
    ctx.fillRect(0, 0, w, h);

    // Spectrum — real audio or synthetic fallback
    let spectrum: Float32Array;
    if (realAudio) {
      // Resample real audio data to match bandCount
      spectrum = new Float32Array(bandCount);
      for (let i = 0; i < bandCount; i++) {
        const srcIdx = Math.floor((i / bandCount) * realAudio.length);
        spectrum[i] = Math.min(1.5, (realAudio[srcIdx] ?? 0) * reactivity * (1 + beat * 1.5));
      }
    } else {
      spectrum = synthesizeSpectrum(bandCount, seed, t, reactivity, smoothing, beatRate);
    }

    if (style === 'bars') {
      const barW = w / (doSymmetry ? bandCount * 2 : bandCount);
      const gap = Math.max(1, barW * 0.1);

      for (let i = 0; i < bandCount; i++) {
        const amp = spectrum[i];
        const barH = amp * h * 0.75;
        const ci = Math.floor((i / bandCount) * (nC - 1));
        const c = colors[ci];

        // Bottom-up bar
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.9)`;
        const x = i * barW;
        ctx.fillRect(x + gap / 2, h - barH, barW - gap, barH);

        // Glow cap
        ctx.fillStyle = `rgba(${Math.min(255, c[0] + 80)},${Math.min(255, c[1] + 80)},${Math.min(255, c[2] + 80)},0.7)`;
        ctx.fillRect(x + gap / 2, h - barH, barW - gap, Math.max(2, minDim * 0.005));

        if (doSymmetry) {
          // Mirror from top
          ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.5)`;
          ctx.fillRect(x + gap / 2, 0, barW - gap, barH * 0.6);
        }
      }
    } else if (style === 'radial') {
      const maxR = minDim * 0.42;
      const spokeCount = doSymmetry ? bandCount * 2 : bandCount;

      ctx.lineCap = 'round';
      for (let i = 0; i < bandCount; i++) {
        const amp = spectrum[i];
        const ci = Math.floor((i / bandCount) * (nC - 1));
        const c = colors[ci];
        const len = amp * maxR;

        const drawSpoke = (angle: number) => {
          const innerR = minDim * 0.05;
          const x1 = cx + Math.cos(angle) * innerR;
          const y1 = cy + Math.sin(angle) * innerR;
          const x2 = cx + Math.cos(angle) * (innerR + len);
          const y2 = cy + Math.sin(angle) * (innerR + len);

          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.85)`;
          ctx.lineWidth = Math.max(2, (TAU * innerR) / spokeCount * 0.6);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        };

        const angle = (i / bandCount) * TAU - Math.PI / 2;
        drawSpoke(angle);
        if (doSymmetry) {
          drawSpoke(angle + Math.PI);
        }
      }
    } else if (style === 'rings') {
      const maxR = minDim * 0.45;
      ctx.lineWidth = Math.max(2, minDim * 0.004);

      for (let i = 0; i < bandCount; i++) {
        const amp = spectrum[i];
        const baseR = ((i + 1) / (bandCount + 1)) * maxR;
        const ci = Math.floor((i / bandCount) * (nC - 1));
        const c = colors[ci];

        // Draw ring with amplitude-modulated distortion
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.4 + amp * 0.5})`;
        ctx.beginPath();
        const segments = 120;
        for (let s = 0; s <= segments; s++) {
          const a = (s / segments) * TAU;
          const wobble = amp * minDim * 0.03 * Math.sin(a * (i % 5 + 2) + t * 2);
          const r = baseR + wobble;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      // waveform
      const waveCount = doSymmetry ? 2 : 1;
      ctx.lineCap = 'round';

      for (let wv = 0; wv < waveCount; wv++) {
        const yOff = wv === 0 ? 0 : 1;
        ctx.beginPath();

        for (let px = 0; px < w; px += 2) {
          const xNorm = px / w;
          let y = 0;
          for (let i = 0; i < Math.min(bandCount, 32); i++) {
            const freq = (i + 1) * 0.5;
            y += spectrum[i] * Math.sin(xNorm * freq * TAU + t * (i * 0.2 + 1));
          }
          y = y / Math.min(bandCount, 32) * h * 0.35;
          const py = cy + y * (yOff === 0 ? 1 : -1);

          if (px === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }

        // Gradient stroke
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        for (let i = 0; i < nC; i++) {
          const c = colors[i];
          grad.addColorStop(i / (nC - 1), `rgba(${c[0]},${c[1]},${c[2]},0.85)`);
        }
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(2, minDim * 0.004);
        ctx.stroke();
      }
    }
  },

  renderWebGL2(gl) {
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  },

  estimateCost(params) {
    return Math.round((params.bandCount ?? 32) * 8);
  },
};
