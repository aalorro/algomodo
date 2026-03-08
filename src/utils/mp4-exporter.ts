import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Generator, Palette } from '../types';
import { applyGrain, applyVignette, applyDither, applyPosterize } from '../renderers/canvas2d/utils';

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
  maxDuration: number; // seconds
  sourceImage?: HTMLImageElement | null;
  onProgress?: (pct: number, elapsedSeconds: number) => void;
  abortSignal?: AbortSignal;
}

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function exportMp4(options: Mp4ExportOptions): Promise<Blob> {
  const {
    generator, params, seed, palette, quality, postFX,
    width, height, fps, maxDuration, sourceImage,
    onProgress, abortSignal,
  } = options;

  if (!isWebCodecsSupported()) {
    throw new Error('WebCodecs API is not supported in this browser.');
  }

  if (!generator.renderCanvas2D) {
    throw new Error('Generator does not support Canvas2D rendering.');
  }

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
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  });

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

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      console.error('VideoEncoder error:', err);
    },
  });
  encoder.configure(encoderConfig);

  // Precompute PostFX flags
  const hasPostFX =
    postFX.grain > 0 || postFX.vignette > 0 ||
    postFX.dither >= 2 || postFX.posterize >= 1;

  // Render loop
  const maxFrames = Math.ceil(maxDuration * fps);
  const frameDuration = Math.round(1_000_000 / fps); // microseconds per frame
  let frameIndex = 0;

  try {
    while (frameIndex < maxFrames) {
      if (abortSignal?.aborted) {
        throw new DOMException('Export cancelled', 'AbortError');
      }

      // time > 0 triggers animation mode in all generators
      const time = (frameIndex + 1) / fps;

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
      while (encoder.encodeQueueSize > 10) {
        await new Promise(r => setTimeout(r, 1));
      }

      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
      frame.close();

      frameIndex++;

      // Check for generator completion signal
      if (result === true) {
        onProgress?.(100, frameIndex / fps);
        break;
      }

      // Report progress
      onProgress?.(Math.round((frameIndex / maxFrames) * 100), frameIndex / fps);

      // Yield to UI thread every 10 frames
      if (frameIndex % 10 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Flush encoder and finalize
    await encoder.flush();
    encoder.close();
    muxer.finalize();

    const buffer = (muxer.target as ArrayBufferTarget).buffer;
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (err) {
    // Clean up encoder on error
    try { encoder.close(); } catch { /* ignore */ }
    throw err;
  }
}
