import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Generator, Palette } from '../types';
import { applyGrain, applyVignette, applyDither, applyPosterize } from '../renderers/canvas2d/utils';
import { analyzeAudioFrame } from './audio';

export interface Mp4ExportOptions {
  generator: Generator;
  params: Record<string, any>;
  seed: number;
  palette: Palette;
  quality: 'draft' | 'balanced' | 'ultra';
  postFX: Record<string, any>;
  width: number;
  height: number;
  fps: number;
  maxDuration: number; // seconds (used when no audio)
  sourceImage?: HTMLImageElement | null;
  onProgress?: (pct: number, elapsedSeconds: number) => void;
  abortSignal?: AbortSignal;
  // Audio options
  audioBuffer?: AudioBuffer | null;
  audioStartTime?: number; // seconds (default 0)
  audioStopTime?: number;  // seconds (default 15)
}

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Snapshot ~3000 pixel RGB values from evenly-spaced positions across the canvas.
 * Returns a Uint8Array for direct byte-by-byte comparison (no hash collisions).
 */
function canvasSnapshot(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 3000)));
  const data = ctx.getImageData(0, 0, w, h).data;
  const cols = Math.ceil(w / step);
  const rows = Math.ceil(h / step);
  const out = new Uint8Array(cols * rows * 3);
  let idx = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      out[idx++] = data[i];
      out[idx++] = data[i + 1];
      out[idx++] = data[i + 2];
    }
  }
  return out;
}

function snapshotsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Check if AudioEncoder is available (WebCodecs audio encoding).
 */
function isAudioEncoderSupported(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';
}

/**
 * Extract interleaved PCM samples from an AudioBuffer for a time range.
 * Returns a Float32Array in planar format (channel 0 samples, then channel 1, etc.).
 */
function extractAudioSamples(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
): { data: Float32Array; numberOfFrames: number; numberOfChannels: number; sampleRate: number } {
  const sr = buffer.sampleRate;
  const nCh = buffer.numberOfChannels;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample = Math.min(buffer.length, Math.ceil(endSec * sr));
  const numberOfFrames = endSample - startSample;

  const data = new Float32Array(numberOfFrames * nCh);
  for (let ch = 0; ch < nCh; ch++) {
    const channelData = buffer.getChannelData(ch);
    const offset = ch * numberOfFrames;
    for (let i = 0; i < numberOfFrames; i++) {
      data[offset + i] = channelData[startSample + i];
    }
  }

  return { data, numberOfFrames, numberOfChannels: nCh, sampleRate: sr };
}

export async function exportMp4(options: Mp4ExportOptions): Promise<Blob> {
  const {
    generator, params, seed, palette, quality, postFX,
    width, height, fps, maxDuration, sourceImage,
    onProgress, abortSignal,
    audioBuffer, audioStartTime = 0, audioStopTime = 15,
  } = options;

  if (!isWebCodecsSupported()) {
    throw new Error('WebCodecs API is not supported in this browser.');
  }

  if (!generator.renderCanvas2D) {
    throw new Error('Generator does not support Canvas2D rendering.');
  }

  // Determine actual duration: audio range if audio provided, else maxDuration
  const hasAudio = !!audioBuffer && isAudioEncoderSupported();
  const audioDuration = hasAudio
    ? Math.min(audioStopTime - audioStartTime, audioBuffer!.duration - audioStartTime)
    : 0;
  const exportDuration = hasAudio ? Math.max(1, audioDuration) : maxDuration;

  // Create offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Build params with unique _renderKey for fresh generator state
  const renderKey = Date.now();
  const finalParams: Record<string, any> = {
    ...generator.defaultParams,
    ...params,
    _renderKey: renderKey,
  };
  if (sourceImage) finalParams._sourceImage = sourceImage;

  // Set up mp4-muxer
  const muxerOptions: any = {
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  };

  // Configure audio track if available
  if (hasAudio) {
    muxerOptions.audio = {
      codec: 'aac',
      numberOfChannels: audioBuffer!.numberOfChannels,
      sampleRate: audioBuffer!.sampleRate,
    };
  }

  const muxer = new Muxer(muxerOptions);

  // Set up VideoEncoder — try High Profile, fall back to Baseline
  let encoderConfig: VideoEncoderConfig = {
    codec: 'avc1.640028', // High Profile Level 4.0
    width,
    height,
    bitrate: 8_000_000,
    framerate: fps,
  };

  const highSupport = await VideoEncoder.isConfigSupported(encoderConfig);
  if (!highSupport.supported) {
    encoderConfig = {
      codec: 'avc1.42001f', // Baseline Profile Level 3.1
      width,
      height,
      bitrate: 8_000_000,
      framerate: fps,
    };
    const baseSupport = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!baseSupport.supported) {
      throw new Error('No supported H.264 encoder configuration found.');
    }
  }

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      console.error('VideoEncoder error:', err);
    },
  });
  videoEncoder.configure(encoderConfig);

  // Set up AudioEncoder if audio is available
  let audioEncoder: AudioEncoder | null = null;
  if (hasAudio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (err) => {
        console.error('AudioEncoder error:', err);
      },
    });

    audioEncoder.configure({
      codec: 'mp4a.40.2', // AAC-LC
      numberOfChannels: audioBuffer!.numberOfChannels,
      sampleRate: audioBuffer!.sampleRate,
      bitrate: 128_000,
    });
  }

  // Precompute PostFX flags
  const hasPostFX =
    postFX.grain > 0 || postFX.vignette > 0 ||
    postFX.dither >= 2 || postFX.posterize >= 1;

  // Render loop
  const maxFrames = Math.ceil(exportDuration * fps);
  const frameDuration = Math.round(1_000_000 / fps); // microseconds per frame
  let frameIndex = 0;

  // Stagnation detection: stop when canvas hasn't changed for 3 seconds
  const stagnationThreshold = fps * 3;
  let prevSnapshot: Uint8Array | null = null;
  let staleFrames = 0;

  try {
    while (frameIndex < maxFrames) {
      if (abortSignal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
      }

      // time > 0 triggers animation mode in all generators
      const time = (frameIndex + 1) / fps;

      // Inject offline audio analysis data for audio-reactive generators
      if (hasAudio && audioBuffer) {
        const audioTime = audioStartTime + time;
        if (audioTime <= audioStopTime) {
          const analysis = analyzeAudioFrame(
            audioBuffer,
            audioTime,
            finalParams.bandCount ?? 32,
          );
          finalParams._audioData = analysis.frequencyData;
          finalParams._audioBass = analysis.bass;
          finalParams._audioMid = analysis.mid;
          finalParams._audioHigh = analysis.high;
        }
      }

      const result = generator.renderCanvas2D(ctx, finalParams, seed, palette, quality, time);

      // Apply PostFX
      if (hasPostFX) {
        let imageData = ctx.getImageData(0, 0, width, height);
        if (postFX.grain > 0) imageData = applyGrain(ctx, imageData, postFX.grain);
        if (postFX.vignette > 0) imageData = applyVignette(ctx, imageData, width, height, postFX.vignette);
        if (postFX.dither >= 2) imageData = applyDither(ctx, imageData, postFX.dither);
        if (postFX.posterize >= 1) imageData = applyPosterize(imageData, postFX.posterize);
        ctx.putImageData(imageData, 0, 0);
      }

      // Create VideoFrame and encode
      const timestamp = frameIndex * frameDuration;
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: frameDuration,
      });

      // Backpressure: wait if encoder queue is too large
      while (videoEncoder.encodeQueueSize > 10) {
        await new Promise(r => setTimeout(r, 1));
      }

      videoEncoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
      frame.close();

      frameIndex++;

      // Check for explicit generator completion signal
      if (result === true) {
        onProgress?.(100, frameIndex / fps);
        break;
      }

      // Stagnation detection (skip when audio — audio-reactive content may look static between beats)
      if (!hasAudio && frameIndex > fps * 2 && frameIndex % 5 === 0 && !hasPostFX) {
        const snap = canvasSnapshot(ctx, width, height);
        if (prevSnapshot && snapshotsEqual(snap, prevSnapshot)) {
          staleFrames += 5;
          if (staleFrames >= stagnationThreshold) {
            console.log(`MP4 export: animation stagnated after ${(frameIndex / fps).toFixed(1)}s`);
            onProgress?.(100, frameIndex / fps);
            break;
          }
        } else {
          staleFrames = 0;
        }
        prevSnapshot = snap;
      }

      // Report progress
      onProgress?.(Math.round((frameIndex / maxFrames) * 100), frameIndex / fps);

      // Yield to UI thread every 10 frames
      if (frameIndex % 10 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Encode audio track in chunks
    if (audioEncoder && audioBuffer && hasAudio) {
      const sr = audioBuffer.sampleRate;
      const nCh = audioBuffer.numberOfChannels;
      // Trim audio to the actual exported video duration
      const actualVideoDuration = frameIndex / fps;
      const audioEnd = Math.min(audioStartTime + actualVideoDuration, audioStopTime);
      const chunkDurationSec = 0.5; // encode in 0.5s chunks
      let audioOffset = audioStartTime;

      while (audioOffset < audioEnd) {
        if (abortSignal?.aborted) {
          throw new DOMException('Export cancelled', 'AbortError');
        }

        const chunkEnd = Math.min(audioOffset + chunkDurationSec, audioEnd);
        const { data, numberOfFrames } = extractAudioSamples(audioBuffer, audioOffset, chunkEnd);

        if (numberOfFrames > 0) {
          const audioTimestamp = Math.round((audioOffset - audioStartTime) * 1_000_000);
          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: sr,
            numberOfFrames,
            numberOfChannels: nCh,
            timestamp: audioTimestamp,
            data: data.buffer as ArrayBuffer,
          });

          audioEncoder.encode(audioData);
          audioData.close();

          // Backpressure
          while (audioEncoder.encodeQueueSize > 10) {
            await new Promise(r => setTimeout(r, 1));
          }
        }

        audioOffset = chunkEnd;
      }

      await audioEncoder.flush();
      audioEncoder.close();
    }

    // Flush video encoder and finalize
    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();

    const buffer = (muxer.target as ArrayBufferTarget).buffer;
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (err) {
    // Clean up encoders on error
    try { videoEncoder.close(); } catch { /* ignore */ }
    try { audioEncoder?.close(); } catch { /* ignore */ }
    throw err;
  }
}
