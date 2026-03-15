/**
 * AudioProcessor — wraps Web Audio API for real-time frequency analysis.
 *
 * Lifecycle:
 *   const ap = new AudioProcessor();
 *   await ap.loadFile(file);
 *   ap.play(offsetSeconds);    // starts playback
 *   ap.getFrequencyData(32);   // call each animation frame
 *   ap.pause();                // returns current offset
 *   ap.dispose();              // cleanup
 */
export class AudioProcessor {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private gainNode: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private startTime = 0;        // ctx.currentTime when playback started
  private startOffset = 0;      // offset into buffer (for resume)
  private _isPlaying = false;
  private freqData: Uint8Array<ArrayBuffer>;
  private disposed = false;

  constructor() {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;           // → 128 frequency bins
    this.analyser.smoothingTimeConstant = 0.6;
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  async loadFile(file: File): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();
    this.audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
  }

  play(offset = 0): void {
    if (!this.audioBuffer || this.disposed) return;
    // Resume suspended AudioContext (browser autoplay policy)
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.stopSource();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.loop = true;
    this.source.connect(this.gainNode);
    this.startOffset = offset % this.audioBuffer.duration;
    this.startTime = this.ctx.currentTime;
    this.source.start(0, this.startOffset);
    this._isPlaying = true;
  }

  /** Pause playback and return the current offset (seconds into the track). */
  pause(): number {
    const offset = this.getCurrentOffset();
    this.stopSource();
    this._isPlaying = false;
    this.startOffset = offset;
    return offset;
  }

  stop(): void {
    this.stopSource();
    this._isPlaying = false;
    this.startOffset = 0;
  }

  isPlaying(): boolean {
    return this._isPlaying;
  }

  getDuration(): number {
    return this.audioBuffer?.duration ?? 0;
  }

  getCurrentOffset(): number {
    if (!this._isPlaying || !this.audioBuffer) return this.startOffset;
    const elapsed = this.ctx.currentTime - this.startTime + this.startOffset;
    return elapsed % this.audioBuffer.duration;
  }

  setVolume(v: number): void {
    this.gainNode.gain.value = Math.max(0, Math.min(1, v));
  }

  /**
   * Returns normalised (0-1) frequency amplitudes, resampled to `bandCount` bins.
   * Call once per animation frame.
   */
  getFrequencyData(bandCount: number): Float32Array {
    this.analyser.getByteFrequencyData(this.freqData);
    const bins = this.freqData.length;  // 128
    const out = new Float32Array(bandCount);

    if (bandCount >= bins) {
      // More bands requested than we have — duplicate
      for (let i = 0; i < bandCount; i++) {
        const srcIdx = Math.floor((i / bandCount) * bins);
        out[i] = this.freqData[srcIdx] / 255;
      }
    } else {
      // Fewer bands — average groups
      const binsPer = bins / bandCount;
      for (let i = 0; i < bandCount; i++) {
        const lo = Math.floor(i * binsPer);
        const hi = Math.floor((i + 1) * binsPer);
        let sum = 0;
        for (let j = lo; j < hi; j++) sum += this.freqData[j];
        out[i] = sum / ((hi - lo) * 255);
      }
    }
    return out;
  }

  /** Average energy of lowest 10% of bins (sub-bass + bass). */
  getBassEnergy(): number {
    this.analyser.getByteFrequencyData(this.freqData);
    const end = Math.max(1, Math.floor(this.freqData.length * 0.1));
    let sum = 0;
    for (let i = 0; i < end; i++) sum += this.freqData[i];
    return sum / (end * 255);
  }

  /** Average energy of bins 10%-50% (midrange). */
  getMidEnergy(): number {
    this.analyser.getByteFrequencyData(this.freqData);
    const lo = Math.floor(this.freqData.length * 0.1);
    const hi = Math.floor(this.freqData.length * 0.5);
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += this.freqData[i];
    return sum / ((hi - lo) * 255);
  }

  /** Average energy of bins 50%-100% (highs + presence). */
  getHighEnergy(): number {
    this.analyser.getByteFrequencyData(this.freqData);
    const lo = Math.floor(this.freqData.length * 0.5);
    let sum = 0;
    for (let i = lo; i < this.freqData.length; i++) sum += this.freqData[i];
    return sum / ((this.freqData.length - lo) * 255);
  }

  /** Expose the decoded AudioBuffer for offline processing (e.g. MP4 export). */
  getBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }

  dispose(): void {
    this.stopSource();
    this._isPlaying = false;
    this.disposed = true;
    this.ctx.close();
  }

  private stopSource(): void {
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Offline audio analysis — used by MP4 exporter to provide frequency data
// to generators without a real-time AudioContext.
// ---------------------------------------------------------------------------

const FFT_SIZE = 256;
const FFT_BINS = FFT_SIZE / 2; // 128

/** Pre-computed Hann window coefficients. */
const HANN = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
}

/** Pre-computed cos/sin tables for DFT. */
const DFT_COS = new Float32Array(FFT_BINS * FFT_SIZE);
const DFT_SIN = new Float32Array(FFT_BINS * FFT_SIZE);
for (let k = 0; k < FFT_BINS; k++) {
  for (let n = 0; n < FFT_SIZE; n++) {
    const angle = (-2 * Math.PI * k * n) / FFT_SIZE;
    DFT_COS[k * FFT_SIZE + n] = Math.cos(angle);
    DFT_SIN[k * FFT_SIZE + n] = Math.sin(angle);
  }
}

/**
 * Extract mono samples from an AudioBuffer at a given time, applying Hann window.
 * Mixes all channels to mono.
 */
function extractWindowedSamples(
  buffer: AudioBuffer,
  timeSeconds: number,
): Float32Array {
  const sr = buffer.sampleRate;
  const centerSample = Math.floor(timeSeconds * sr);
  const halfWindow = FFT_SIZE / 2;
  const start = centerSample - halfWindow;
  const totalSamples = buffer.length;
  const nChannels = buffer.numberOfChannels;

  const windowed = new Float32Array(FFT_SIZE);
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < nChannels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }

  for (let i = 0; i < FFT_SIZE; i++) {
    const sampleIdx = start + i;
    if (sampleIdx < 0 || sampleIdx >= totalSamples) continue;
    let sum = 0;
    for (let ch = 0; ch < nChannels; ch++) {
      sum += channelData[ch][sampleIdx];
    }
    windowed[i] = (sum / nChannels) * HANN[i];
  }
  return windowed;
}

/**
 * Compute magnitude spectrum from windowed samples.
 * Returns values in 0-255 byte range, mimicking AnalyserNode.getByteFrequencyData.
 */
function computeSpectrum(samples: Float32Array): Uint8Array {
  const magnitudes = new Uint8Array(FFT_BINS);
  const minDB = -100;
  const rangeDB = 70; // -100 to -30

  for (let k = 0; k < FFT_BINS; k++) {
    let real = 0, imag = 0;
    const offset = k * FFT_SIZE;
    for (let n = 0; n < FFT_SIZE; n++) {
      real += samples[n] * DFT_COS[offset + n];
      imag += samples[n] * DFT_SIN[offset + n];
    }
    const mag = Math.sqrt(real * real + imag * imag) / FFT_SIZE;
    const db = mag > 0 ? 20 * Math.log10(mag) : -200;
    const normalized = (db - minDB) / rangeDB;
    magnitudes[k] = Math.max(0, Math.min(255, Math.round(normalized * 255)));
  }
  return magnitudes;
}

export interface OfflineAudioFrame {
  frequencyData: Float32Array;
  bass: number;
  mid: number;
  high: number;
}

/**
 * Analyze a single frame of audio offline. Returns frequency bands + energy
 * values matching the real-time AudioProcessor output format.
 */
export function analyzeAudioFrame(
  buffer: AudioBuffer,
  timeSeconds: number,
  bandCount: number,
): OfflineAudioFrame {
  const samples = extractWindowedSamples(buffer, timeSeconds);
  const spectrum = computeSpectrum(samples);
  const bins = spectrum.length; // 128

  // Resample to requested band count (same logic as AudioProcessor.getFrequencyData)
  const frequencyData = new Float32Array(bandCount);
  if (bandCount >= bins) {
    for (let i = 0; i < bandCount; i++) {
      const srcIdx = Math.floor((i / bandCount) * bins);
      frequencyData[i] = spectrum[srcIdx] / 255;
    }
  } else {
    const binsPer = bins / bandCount;
    for (let i = 0; i < bandCount; i++) {
      const lo = Math.floor(i * binsPer);
      const hi = Math.floor((i + 1) * binsPer);
      let sum = 0;
      for (let j = lo; j < hi; j++) sum += spectrum[j];
      frequencyData[i] = sum / ((hi - lo) * 255);
    }
  }

  // Energy bands (same ranges as AudioProcessor)
  const bassEnd = Math.max(1, Math.floor(bins * 0.1));
  let bassSum = 0;
  for (let i = 0; i < bassEnd; i++) bassSum += spectrum[i];
  const bass = bassSum / (bassEnd * 255);

  const midLo = Math.floor(bins * 0.1);
  const midHi = Math.floor(bins * 0.5);
  let midSum = 0;
  for (let i = midLo; i < midHi; i++) midSum += spectrum[i];
  const mid = midSum / ((midHi - midLo) * 255);

  const highLo = Math.floor(bins * 0.5);
  let highSum = 0;
  for (let i = highLo; i < bins; i++) highSum += spectrum[i];
  const high = highSum / ((bins - highLo) * 255);

  return { frequencyData, bass, mid, high };
}
