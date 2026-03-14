import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { getGenerator, getAllGenerators } from '../core/registry';
import { applyGrain, applyVignette, applyDither, applyPosterize } from '../renderers/canvas2d/utils';
import { loadImageFromUrl } from '../utils/imageUrl';
import { AudioProcessor } from '../utils/audio';
import type { OverlaySettings } from '../types';
import { OVERLAY_EXCLUDED_FAMILIES } from '../types';

interface CanvasRendererProps {
  showFPS?: boolean;
}

interface Ripple {
  x: number; // 0-1 normalised
  y: number;
  startTime: number;
}

const RIPPLE_DURATION = 900; // ms

export const CanvasRenderer: React.FC<CanvasRendererProps> = ({ showFPS = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef({ frames: 0, lastTime: 0, fps: 0, lastRenderedFps: -1 });
  const animationRef = useRef<number | undefined>(undefined);
  const overlayAnimRef = useRef<number | undefined>(undefined);
  const lastFrameTimeRef = useRef(0);
  const mouseRef = useRef({ x: 0.5, y: 0.5, inside: false });
  const ripplesRef = useRef<Ripple[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timeBaseRef = useRef(0);       // RAF timestamp offset for smooth resume
  const animTimeRef = useRef(0);       // current animation time in seconds
  const [isSaving, setIsSaving] = useState(false);
  const audioRef = useRef<AudioProcessor | null>(null);

  const {
    canvasSettings,
    selectedGeneratorId,
    seed,
    params,
    palette,
    quality,
    isAnimating,
    pausedTime,
    animationFps,
    setAnimating,
    setPausedTime,
    randomizeParams,
    selectGenerator,
    postFX,
    sourceImage,
    setSourceImage,
    audioFile,
    setAudioFile,
    setAudioFileName,
    setAudioProgress,
    setAudioDuration,
    audioSeekTo,
    setAudioSeekTo,
    interactionEnabled,
    recordingDuration,
    undo,
    redo,
    renderKey,
    forceReload,
    clearCanvas,
    overlayImage,
    overlaySettings,
  } = useStore(useShallow(s => ({
    canvasSettings: s.canvasSettings,
    selectedGeneratorId: s.selectedGeneratorId,
    seed: s.seed,
    params: s.params,
    palette: s.palette,
    quality: s.quality,
    isAnimating: s.isAnimating,
    pausedTime: s.pausedTime,
    animationFps: s.animationFps,
    setAnimating: s.setAnimating,
    setPausedTime: s.setPausedTime,
    randomizeParams: s.randomizeParams,
    selectGenerator: s.selectGenerator,
    postFX: s.postFX,
    sourceImage: s.sourceImage,
    setSourceImage: s.setSourceImage,
    audioFile: s.audioFile,
    setAudioFile: s.setAudioFile,
    setAudioFileName: s.setAudioFileName,
    setAudioProgress: s.setAudioProgress,
    setAudioDuration: s.setAudioDuration,
    audioSeekTo: s.audioSeekTo,
    setAudioSeekTo: s.setAudioSeekTo,
    interactionEnabled: s.interactionEnabled,
    recordingDuration: s.recordingDuration,
    undo: s.undo,
    redo: s.redo,
    renderKey: s.renderKey,
    forceReload: s.forceReload,
    clearCanvas: s.clearCanvas,
    overlayImage: s.overlayImage,
    overlaySettings: s.overlaySettings,
  })));

  // Decode source image data-URL → HTMLImageElement
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!sourceImage) { setLoadedImage(null); return; }
    const img = new Image();
    img.onload = () => setLoadedImage(img);
    img.onerror = () => setLoadedImage(null);
    img.src = sourceImage;
  }, [sourceImage]);

  // Decode overlay image data-URL → HTMLImageElement
  const [loadedOverlayImage, setLoadedOverlayImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!overlayImage) { setLoadedOverlayImage(null); return; }
    const img = new Image();
    img.onload = () => setLoadedOverlayImage(img);
    img.onerror = () => setLoadedOverlayImage(null);
    img.src = overlayImage;
  }, [overlayImage]);

  // Decode audio file → AudioProcessor
  useEffect(() => {
    if (!audioFile) {
      audioRef.current?.dispose();
      audioRef.current = null;
      return;
    }
    const processor = new AudioProcessor();
    let cancelled = false;
    processor.loadFile(audioFile).then(() => {
      if (!cancelled) {
        audioRef.current = processor;
        setAudioDuration(processor.getDuration());
        setAudioProgress(0);
      }
    });
    return () => {
      cancelled = true;
      processor.dispose();
      if (audioRef.current === processor) audioRef.current = null;
    };
  }, [audioFile]);

  // Handle audio seek requests from sidebar slider
  useEffect(() => {
    if (audioSeekTo == null || !audioRef.current) return;
    const dur = audioRef.current.getDuration();
    if (dur <= 0) return;
    const offset = audioSeekTo * dur;
    if (audioRef.current.isPlaying()) {
      audioRef.current.play(offset);
    } else {
      // Update the paused offset so resume starts here
      audioRef.current.pause();
      audioRef.current.play(offset);
      audioRef.current.pause();
    }
    setAudioProgress(audioSeekTo);
    setAudioSeekTo(null);
  }, [audioSeekTo]);

  // ── Image ingestion helpers ─────────────────────────────────────────────────
  const readFileAsDataUrl = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setSourceImage(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const loadFromUrl = (url: string) => {
    loadImageFromUrl(url, (dataUrl) => setSourceImage(dataUrl));
  };

  // ── Drag-and-drop ───────────────────────────────────────────────────────────
  const [isRendering, setIsRendering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the container itself, not a child element
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // Prefer file drop
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('audio/')) {
      setAudioFile(file);
      setAudioFileName(file.name);
      return;
    }
    if (file?.type.startsWith('image/')) {
      readFileAsDataUrl(file);
      return;
    }

    // URL drop (dragging an image from a webpage)
    const url =
      e.dataTransfer.getData('text/uri-list') ||
      e.dataTransfer.getData('text/plain');
    if (/^https?:\/\//i.test(url)) {
      loadFromUrl(url);
    }
  };

  // ── Clipboard paste ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Image blob in clipboard (screenshot, copy-image in browser)
      const items = Array.from(e.clipboardData?.items ?? []);
      const imgItem = items.find(it => it.type.startsWith('image/'));
      if (imgItem) {
        const blob = imgItem.getAsFile();
        if (blob) readFileAsDataUrl(blob);
        return;
      }

      // Text that looks like a URL — load directly
      const text = (e.clipboardData?.getData('text/plain') ?? '').trim();
      if (/^https?:\/\//i.test(text)) {
        loadFromUrl(text);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []); // stable: only reads stable setters

  // ── Refs for mutable render data (animation reads from these, not closures) ──
  const renderDataRef = useRef({
    selectedGeneratorId, seed, params, palette, quality, postFX, showFPS, animationFps, loadedImage, renderKey,
    loadedOverlayImage, overlaySettings,
  });
  // Update individual properties instead of allocating a new object every render
  const rd = renderDataRef.current;
  rd.selectedGeneratorId = selectedGeneratorId;
  rd.seed = seed;
  rd.params = params;
  rd.palette = palette;
  rd.quality = quality;
  rd.postFX = postFX;
  rd.showFPS = showFPS;
  rd.animationFps = animationFps;
  rd.loadedImage = loadedImage;
  rd.renderKey = renderKey;
  rd.loadedOverlayImage = loadedOverlayImage;
  rd.overlaySettings = overlaySettings;

  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const staticTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Canvas sizing effect — only when dimensions change ──────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = canvasSettings.devicePixelRatio || 2;
    const newW = canvasSettings.width * dpr;
    const newH = canvasSettings.height * dpr;

    if (canvasSizeRef.current.w === newW && canvasSizeRef.current.h === newH) return;
    canvasSizeRef.current = { w: newW, h: newH };

    canvas.width = newW;
    canvas.height = newH;

    const overlay = overlayCanvasRef.current;
    if (overlay) {
      overlay.width = newW;
      overlay.height = newH;
    }
  }, [canvasSettings]);

  // ── Overlay image compositing helper ────────────────────────────────────────
  const drawOverlay = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    settings: OverlaySettings,
    generatorFamily: string | undefined,
  ) => {
    if (!img || settings.opacity <= 0) return;
    if (generatorFamily && OVERLAY_EXCLUDED_FAMILIES.has(generatorFamily)) return;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.save();
    ctx.globalAlpha = settings.opacity;
    ctx.globalCompositeOperation = settings.blendMode;

    // Translate to center, rotate, then draw cover-fit
    ctx.translate(w / 2, h / 2);
    if (settings.angle !== 0) {
      ctx.rotate((settings.angle * Math.PI) / 180);
    }

    // Cover-fit: scale image to cover the canvas
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);

    ctx.restore();
  };

  // ── Static render — shared logic ────────────────────────────────────────────
  const doStaticRender = (renderTime?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!selectedGeneratorId) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const generator = getGenerator(selectedGeneratorId);
    if (!generator?.renderCanvas2D) return;

    const finalParams: Record<string, any> = { ...generator.defaultParams, ...params };
    if (loadedImage) finalParams._sourceImage = loadedImage;
    finalParams._renderKey = renderKey;
    // Inject audio data if available
    if (audioRef.current?.isPlaying()) {
      finalParams._audioData = audioRef.current.getFrequencyData(finalParams.bandCount ?? 32);
      finalParams._audioBass = audioRef.current.getBassEnergy();
      finalParams._audioMid = audioRef.current.getMidEnergy();
      finalParams._audioHigh = audioRef.current.getHighEnergy();
    }

    // Use paused time if provided, otherwise 0 for static renders
    const time = renderTime ?? pausedTime ?? 0;

    try {
      generator.renderCanvas2D!(ctx, finalParams, seed, palette, quality, time);

      // Apply PostFX
      const hasPostFX =
        postFX.grain > 0 || postFX.vignette > 0 ||
        postFX.dither >= 2 || postFX.posterize >= 1;
      if (hasPostFX) {
        const w = ctx.canvas.width, h = ctx.canvas.height;
        let imageData = ctx.getImageData(0, 0, w, h);
        if (postFX.grain > 0) imageData = applyGrain(ctx, imageData, postFX.grain);
        if (postFX.vignette > 0) imageData = applyVignette(ctx, imageData, w, h, postFX.vignette);
        if (postFX.dither >= 2) imageData = applyDither(ctx, imageData, postFX.dither);
        if (postFX.posterize >= 1) imageData = applyPosterize(imageData, postFX.posterize);
        ctx.putImageData(imageData, 0, 0);
      }

      // Apply overlay image
      if (loadedOverlayImage) {
        drawOverlay(ctx, loadedOverlayImage, overlaySettings, generator.family);
      }
    } catch (err) {
      console.error('Rendering error:', err);
      ctx.fillStyle = '#ff0000';
      ctx.font = '14px monospace';
      ctx.fillText('Render Error', 10, 20);
    }
  };

  // ── Static render effect (debounced) — only when NOT animating ──────────────
  const prevGeneratorIdRef = useRef(selectedGeneratorId);
  useEffect(() => {
    if (isAnimating) return;

    const generatorChanged = prevGeneratorIdRef.current !== selectedGeneratorId;
    prevGeneratorIdRef.current = selectedGeneratorId;

    // Defer render when generator changes so the UI stays responsive
    // (old art remains visible until new render completes)
    if (generatorChanged) {
      setIsRendering(true);
      animationRef.current = requestAnimationFrame(() => {
        doStaticRender();
        setIsRendering(false);
      });
      return;
    }

    // Debounce parameter/slider changes
    clearTimeout(staticTimerRef.current);
    staticTimerRef.current = setTimeout(() => {
      setIsRendering(true);
      animationRef.current = requestAnimationFrame(() => {
        doStaticRender();
        setIsRendering(false);
      });
    }, 80);

    return () => {
      clearTimeout(staticTimerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      setIsRendering(false);
    };
  }, [selectedGeneratorId, seed, params, palette, quality, postFX, loadedImage, isAnimating, pausedTime, renderKey, loadedOverlayImage, overlaySettings]);

  // ── Animation loop effect — long-lived, reads from refs ─────────────────────
  useEffect(() => {
    if (!isAnimating) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    lastFrameTimeRef.current = 0;
    fpsRef.current = { frames: 0, lastTime: 0, fps: 0, lastRenderedFps: -1 };
    // Reset time base so first frame calculates it with resume offset
    timeBaseRef.current = 0;

    const resumeFrom = useStore.getState().pausedTime ?? 0;

    // Sync audio playback — always start from beginning
    if (audioRef.current) {
      audioRef.current.play(0);
      setAudioProgress(0);
    }

    const animate = (timestamp: number) => {
      // On first frame, set the time base so animation continues from paused time
      if (timeBaseRef.current === 0) {
        timeBaseRef.current = timestamp / 1000 - resumeFrom;
      }
      const animTime = timestamp / 1000 - timeBaseRef.current;
      animTimeRef.current = animTime;

      const rd = renderDataRef.current;
      const fpsInterval = 1000 / rd.animationFps;
      const elapsed = timestamp - lastFrameTimeRef.current;

      if (elapsed >= fpsInterval) {
        lastFrameTimeRef.current = timestamp - (elapsed % fpsInterval);

        const generator = rd.selectedGeneratorId ? getGenerator(rd.selectedGeneratorId) : undefined;
        if (generator?.renderCanvas2D) {
          const finalParams: Record<string, any> = { ...generator.defaultParams, ...rd.params };
          if (rd.loadedImage) finalParams._sourceImage = rd.loadedImage;
          finalParams._renderKey = rd.renderKey;
          // Inject real-time audio data + update progress
          if (audioRef.current?.isPlaying()) {
            finalParams._audioData = audioRef.current.getFrequencyData(finalParams.bandCount ?? 32);
            finalParams._audioBass = audioRef.current.getBassEnergy();
            finalParams._audioMid = audioRef.current.getMidEnergy();
            finalParams._audioHigh = audioRef.current.getHighEnergy();
            const dur = audioRef.current.getDuration();
            if (dur > 0) setAudioProgress(audioRef.current.getCurrentOffset() / dur);
          }
          generator.renderCanvas2D(ctx, finalParams, rd.seed, rd.palette, rd.quality, animTime);

          // Apply overlay image during animation
          if (rd.loadedOverlayImage) {
            drawOverlay(ctx, rd.loadedOverlayImage, rd.overlaySettings, generator.family);
          }
        }

        if (rd.showFPS) {
          const now = performance.now();
          fpsRef.current.frames++;
          if (now >= fpsRef.current.lastTime + 1000) {
            fpsRef.current.fps = fpsRef.current.frames;
            fpsRef.current.frames = 0;
            fpsRef.current.lastTime = now;
          }
          // Only update overlay text styling once per FPS update
          if (fpsRef.current.lastRenderedFps !== fpsRef.current.fps) {
            fpsRef.current.lastRenderedFps = fpsRef.current.fps;
          }
          ctx.fillStyle = '#39ff14';
          ctx.font = 'bold 48px monospace';
          ctx.shadowColor = '#39ff14';
          ctx.shadowBlur = 10;
          ctx.fillText(`${fpsRef.current.lastRenderedFps} / ${rd.animationFps} fps`, 16, 36);
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      audioRef.current?.pause();
    };
  }, [isAnimating, renderKey]);

  // ── Overlay canvas: spotlight + ripple interaction (idle-aware) ──────────────
  const overlayRunningRef = useRef(false);

  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    if (!interactionEnabled) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      overlayRunningRef.current = false;
      return;
    }

    const getCanvasPos = (clientX: number, clientY: number) => {
      const rect = overlay.getBoundingClientRect();
      return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
    };

    // Start the overlay loop only when needed
    const ensureOverlayLoop = () => {
      if (overlayRunningRef.current) return;
      overlayRunningRef.current = true;
      overlayAnimRef.current = requestAnimationFrame(drawOverlay);
    };

    const onMouseMove = (e: MouseEvent) => {
      const { x, y } = getCanvasPos(e.clientX, e.clientY);
      mouseRef.current = { x, y, inside: true };
      ensureOverlayLoop();
    };
    const onMouseLeave = () => { mouseRef.current.inside = false; };
    const onMouseDown = (e: MouseEvent) => {
      const { x, y } = getCanvasPos(e.clientX, e.clientY);
      ripplesRef.current.push({ x, y, startTime: performance.now() });
      ensureOverlayLoop();
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const { x, y } = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      mouseRef.current = { x, y, inside: true };
      ensureOverlayLoop();
    };
    const onTouchStart = (e: TouchEvent) => {
      const { x, y } = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      mouseRef.current = { x, y, inside: true };
      ripplesRef.current.push({ x, y, startTime: performance.now() });
      ensureOverlayLoop();
    };
    const onTouchEnd = () => { mouseRef.current.inside = false; };

    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseleave', onMouseLeave);
    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('touchmove', onTouchMove, { passive: false });
    overlay.addEventListener('touchstart', onTouchStart);
    overlay.addEventListener('touchend', onTouchEnd);

    mouseRef.current = { x: 0.5, y: 0.5, inside: false };
    ripplesRef.current = [];
    overlayRunningRef.current = false;

    function drawOverlay(timestamp: number) {
      const w = overlay!.width, h = overlay!.height;
      ctx!.clearRect(0, 0, w, h);

      if (mouseRef.current.inside) {
        const mx = mouseRef.current.x * w, my = mouseRef.current.y * h;
        const grad = ctx!.createRadialGradient(mx, my, w * 0.1, mx, my, w * 0.65);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx!.fillStyle = grad;
        ctx!.fillRect(0, 0, w, h);
      }

      ripplesRef.current = ripplesRef.current.filter(r => timestamp - r.startTime < RIPPLE_DURATION);
      for (const ripple of ripplesRef.current) {
        const age = (timestamp - ripple.startTime) / RIPPLE_DURATION;
        ctx!.save();
        ctx!.strokeStyle = `rgba(255,255,255,${(1 - age) * 0.85})`;
        ctx!.lineWidth = Math.max(1, 2.5 * (1 - age));
        ctx!.beginPath();
        ctx!.arc(ripple.x * w, ripple.y * h, age * w * 0.42, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.restore();
      }

      // Stop the loop when nothing to draw — saves CPU when idle
      if (!mouseRef.current.inside && ripplesRef.current.length === 0) {
        overlayRunningRef.current = false;
        return;
      }

      overlayAnimRef.current = requestAnimationFrame(drawOverlay);
    }

    return () => {
      if (overlayAnimRef.current) cancelAnimationFrame(overlayAnimRef.current);
      overlayRunningRef.current = false;
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseleave', onMouseLeave);
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('touchmove', onTouchMove);
      overlay.removeEventListener('touchstart', onTouchStart);
      overlay.removeEventListener('touchend', onTouchEnd);
    };
  }, [interactionEnabled]);

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const exportSize = 1080;

    if (!selectedGeneratorId) return;
    const generator = getGenerator(selectedGeneratorId);
    if (!generator) return;
    const finalParams: Record<string, any> = { ...generator.defaultParams, ...params };

    if (!isAnimating) {
      // Static or paused: render at 1080x1080 on offscreen canvas, save PNG
      const exportTime = pausedTime ?? 0;
      const offscreen = document.createElement('canvas');
      offscreen.width = exportSize;
      offscreen.height = exportSize;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;
      if (generator.renderCanvas2D) {
        generator.renderCanvas2D(offCtx, finalParams, seed, palette, quality, exportTime);
      }
      // Apply PostFX
      const hasPostFX =
        postFX.grain > 0 || postFX.vignette > 0 ||
        postFX.dither >= 2 || postFX.posterize >= 1;
      if (hasPostFX) {
        let imageData = offCtx.getImageData(0, 0, exportSize, exportSize);
        if (postFX.grain > 0) imageData = applyGrain(offCtx, imageData, postFX.grain);
        if (postFX.vignette > 0) imageData = applyVignette(offCtx, imageData, exportSize, exportSize, postFX.vignette);
        if (postFX.dither >= 2) imageData = applyDither(offCtx, imageData, postFX.dither);
        if (postFX.posterize >= 1) imageData = applyPosterize(imageData, postFX.posterize);
        offCtx.putImageData(imageData, 0, 0);
      }
      // Apply overlay image to export
      if (loadedOverlayImage) {
        drawOverlay(offCtx, loadedOverlayImage, overlaySettings, generator.family);
      }
      const link = document.createElement('a');
      link.download = `algomodo-${timestamp}.png`;
      link.href = offscreen.toDataURL('image/png');
      link.click();
      return;
    }

    // Animating: record WebM at 1080x1080 on offscreen canvas
    const mimeTypes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeTypes.find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      alert('Your browser does not support WebM video recording.');
      return;
    }

    setIsSaving(true);

    const offscreen = document.createElement('canvas');
    offscreen.width = exportSize;
    offscreen.height = exportSize;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) { setIsSaving(false); return; }

    const chunks: Blob[] = [];
    const stream = offscreen.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
    });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      cancelAnimationFrame(recordAnimId);
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `algomodo-${timestamp}.webm`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      mediaRecorderRef.current = null;
      setIsSaving(false);
    };

    recorder.onerror = () => {
      cancelAnimationFrame(recordAnimId);
      console.error('MediaRecorder error');
      mediaRecorderRef.current = null;
      setIsSaving(false);
    };

    // Render animation loop on the offscreen canvas while recording
    let recordAnimId = 0;
    const fpsInterval = 1000 / 30;
    let lastFrame = 0;
    const renderLoop = (ts: number) => {
      const elapsed = ts - lastFrame;
      if (elapsed >= fpsInterval) {
        lastFrame = ts - (elapsed % fpsInterval);
        if (generator.renderCanvas2D) {
          generator.renderCanvas2D(offCtx, finalParams, seed, palette, quality, ts / 1000);
        }
        // Apply overlay image to recording
        if (loadedOverlayImage) {
          drawOverlay(offCtx, loadedOverlayImage, overlaySettings, generator.family);
        }
      }
      recordAnimId = requestAnimationFrame(renderLoop);
    };

    recorder.start(100);
    recordAnimId = requestAnimationFrame(renderLoop);
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, recordingDuration * 1000);
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full flex items-center justify-center"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Art canvas */}
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full rounded-lg bg-black border border-gray-700"
        style={{ aspectRatio: `${canvasSettings.width} / ${canvasSettings.height}` }}
      />

      {/* Interaction overlay (mouse/touch effects) */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 m-auto max-w-full max-h-full rounded-lg"
        style={{ aspectRatio: `${canvasSettings.width} / ${canvasSettings.height}` }}
      />

      {/* Render progress bar — only visible after 1s delay (compositor-driven) */}
      {isRendering && (
        <div
          className="absolute bottom-0 left-0 w-full rounded-b-lg pointer-events-none z-20"
          style={{
            height: '6px',
            background: '#39ff14',
            boxShadow: '0 0 12px #39ff14, 0 0 30px rgba(57, 255, 20, 0.6)',
            transformOrigin: 'left',
            willChange: 'transform, opacity',
            animation: 'render-progress-slow 6s linear 1s both',
          }}
        />
      )}

      {/* Drag-over indicator */}
      {isDragging && (
        <div className="absolute inset-0 z-20 rounded-lg border-2 border-dashed border-blue-400 bg-blue-950/60 flex flex-col items-center justify-center pointer-events-none">
          <svg className="w-10 h-10 text-blue-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-blue-300 font-semibold text-sm">Drop image or URL</p>
        </div>
      )}

      {/* Bottom Canvas Buttons */}
      <div className="absolute bottom-4 lg:bottom-24 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
        <div className="flex gap-3">
          <button
            onClick={undo}
            className="px-3 py-2 bg-gray-500/60 hover:bg-gray-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all"
            title="Undo"
          >
            ↩ UNDO
          </button>
          <button
            onClick={() => {
              if (isAnimating) {
                // Playing → Pause: capture current time and stop
                setPausedTime(animTimeRef.current);
                setAnimating(false);
              } else {
                // Stopped or Paused → Play/Resume
                setAnimating(true);
              }
            }}
            className="px-4 py-2 bg-blue-500/60 hover:bg-blue-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all"
          >
            {isAnimating ? '⏸ PAUSE' : pausedTime !== null ? '▶ RESUME' : '▶ ANIMATE'}
          </button>
          {pausedTime !== null && !isAnimating && (
            <button
              onClick={() => { setPausedTime(null); timeBaseRef.current = 0; }}
              className="px-3 py-2 bg-gray-500/60 hover:bg-gray-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all"
              title="Stop and reset to static"
            >
              STOP
            </button>
          )}
          <button
            onClick={() => selectedGeneratorId && randomizeParams(getGenerator(selectedGeneratorId)?.parameterSchema || {})}
            className="px-4 py-2 bg-blue-500/60 hover:bg-blue-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all"
          >
            🎲 RANDOM
          </button>
          <button
            onClick={redo}
            className="px-3 py-2 bg-gray-500/60 hover:bg-gray-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all"
            title="Redo"
          >
            REDO ↪
          </button>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              const all = getAllGenerators().filter(g => g.family !== 'image');
              const pick = all[Math.floor(Math.random() * all.length)];
              if (pick) selectGenerator(pick.id);
            }}
            className="px-5 py-2 bg-purple-500/60 hover:bg-purple-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all"
          >
            ✨ SURPRISE ME
          </button>
          <button
            onClick={forceReload}
            className="px-5 py-2 bg-blue-500/60 hover:bg-blue-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all"
            title="Re-render with same settings"
          >
            🔄 RELOAD
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 bg-green-500/60 hover:bg-green-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? '💾 SAVING...' : '💾 SAVE'}
          </button>
          <button
            onClick={clearCanvas}
            className="px-5 py-2 bg-red-500/60 hover:bg-red-600/70 backdrop-blur text-white font-semibold rounded-lg transition-all"
          >
            CLEAR
          </button>
        </div>
        <p className="text-white/60 text-sm font-medium pointer-events-none" style={{ textShadow: '-1px -1px 0 rgba(0,0,0,0.6), 1px -1px 0 rgba(0,0,0,0.6), -1px 1px 0 rgba(0,0,0,0.6), 1px 1px 0 rgba(0,0,0,0.6)' }}>
          {selectedGeneratorId ? getGenerator(selectedGeneratorId)?.styleName : ''}
        </p>
      </div>

    </div>
  );
};
