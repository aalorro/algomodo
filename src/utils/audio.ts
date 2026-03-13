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
