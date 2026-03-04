import GIF from 'gif.js';

export interface RecordingOptions {
  duration: number; // seconds
  fps: number;
  width: number;
  height: number;
  quality?: 'low' | 'medium' | 'high';
}

export class CanvasRecorder {
  private frames: HTMLCanvasElement[] = [];
  private isRecording = false;
  private startTime = 0;
  private lastFrameTime = 0;
  private frameInterval = 0;
  private recordCanvas: HTMLCanvasElement;
  private recordCtx: CanvasRenderingContext2D;

  constructor(options: RecordingOptions) {
    this.frameInterval = 1000 / options.fps;
    this.recordCanvas = document.createElement('canvas');
    this.recordCanvas.width = options.width;
    this.recordCanvas.height = options.height;
    this.recordCtx = this.recordCanvas.getContext('2d')!;
  }

  startRecording(sourceCanvas: HTMLCanvasElement, duration: number) {
    this.isRecording = true;
    this.frames = [];
    this.startTime = performance.now();
    const endTime = this.startTime + duration * 1000;
    this.lastFrameTime = this.startTime;

    const recordFrame = (now: number) => {
      if (!this.isRecording || now > endTime) {
        this.isRecording = false;
        console.log(`Recording stopped. Total frames: ${this.frames.length}`);
        return;
      }

      const timeSinceLastFrame = now - this.lastFrameTime;
      if (timeSinceLastFrame >= this.frameInterval) {
        try {
          const sourceCtx = sourceCanvas.getContext('2d');
          if (sourceCtx) {
            // Copy source to recording canvas
            this.recordCtx.drawImage(sourceCanvas, 0, 0);
            
            // Store frame as canvas
            const frameCanvas = document.createElement('canvas');
            frameCanvas.width = this.recordCanvas.width;
            frameCanvas.height = this.recordCanvas.height;
            const frameCtx = frameCanvas.getContext('2d');
            if (frameCtx) {
              frameCtx.drawImage(this.recordCanvas, 0, 0);
              this.frames.push(frameCanvas);
              console.log(`Captured frame ${this.frames.length} at ${((now - this.startTime) / 1000).toFixed(2)}s`);
            }
          }
        } catch (error) {
          console.error('Error capturing frame:', error);
        }
        this.lastFrameTime = now;
      }

      requestAnimationFrame(recordFrame);
    };

    requestAnimationFrame(recordFrame);
  }

  stopRecording() {
    this.isRecording = false;
  }

  async exportGIF(width: number, height: number, fps: number = 24): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.frames || this.frames.length === 0) {
          reject(new Error('No frames recorded'));
          return;
        }

        console.log(`Creating GIF with ${this.frames.length} frames at ${width}x${height} (${fps}fps)...`);

        const gif = new GIF({
          workers: 1,
          quality: 10,
          width,
          height,
          workerScript: '/gif.worker.js',
        }) as any;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d')!;

        for (let i = 0; i < this.frames.length; i++) {
          const frameCanvas = this.frames[i];
          tempCtx.drawImage(frameCanvas, 0, 0, width, height);
          gif.addFrame(tempCanvas, { delay: 1000 / fps, copy: true });
          if ((i + 1) % 10 === 0) {
            console.log(`Added frame ${i + 1}/${this.frames.length}`);
          }
        }

        let finished = false;
        let timedOut = false;

        const onFinish = (blob: Blob) => {
          finished = true;
          console.log('GIF finished event fired');
          if (blob && blob.size > 0) {
            console.log(`GIF blob size: ${(blob.size / 1024).toFixed(2)}KB`);
            resolve(blob);
          } else {
            reject(new Error('Generated GIF is empty'));
          }
        };

        const onError = (error: any) => {
          console.error('GIF encoding error event:', error);
          if (!finished && !timedOut) {
            reject(new Error(`GIF encoding failed: ${error?.message || 'Unknown error'}`));
          }
        };

        gif.on('finished', onFinish);
        gif.on('error', onError);

        console.log('Starting GIF render...');
        gif.render();

        // Set timeout to 30 seconds (should be enough with downscaling)
        const timeoutId = setTimeout(() => {
          timedOut = true;
          if (!finished) {
            console.error('GIF encoding timeout after 30 seconds');
            reject(new Error('GIF encoding timeout - try shorter duration or simpler animation'));
          }
        }, 30000);

      } catch (error) {
        console.error('GIF export error:', error);
        reject(error);
      }
    });
  }

  async exportWebM(width: number, height: number, fps: number = 30): Promise<Blob> {
    return new Promise((resolve, reject) => {
      // Collect all chunks
      const chunks: Blob[] = [];

      // Create a canvas for drawing frames
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;

      try {
        // Get supported mime type
        const mimeTypes = [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
        ];

        let selectedMimeType = '';
        for (const mimeType of mimeTypes) {
          if (MediaRecorder.isTypeSupported(mimeType)) {
            selectedMimeType = mimeType;
            break;
          }
        }

        if (!selectedMimeType) {
          reject(new Error('No supported video codec found'));
          return;
        }

        const stream = tempCanvas.captureStream(fps);
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: selectedMimeType,
          videoBitsPerSecond: 5000000,
        });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: selectedMimeType });
          resolve(blob);
        };

        mediaRecorder.onerror = (e) => {
          reject(new Error(`MediaRecorder error: ${(e as any).error}`));
        };

        // Draw frames to canvas
        mediaRecorder.start();
        const ctx = tempCanvas.getContext('2d')!;
        let frameIndex = 0;

        const drawNextFrame = () => {
          if (frameIndex < this.frames.length) {
            ctx.drawImage(this.frames[frameIndex], 0, 0);
            frameIndex++;
            setTimeout(drawNextFrame, 1000 / fps);
          } else {
            mediaRecorder.stop();
          }
        };

        drawNextFrame();
      } catch (error) {
        reject(error);
      }
    });
  }

  getFrameCount() {
    return this.frames.length;
  }

  clearFrames() {
    this.frames = [];
  }
}
