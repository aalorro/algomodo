import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { getGenerator } from '../core/registry';
import { applyGrain, applyVignette, applyDither, applyPosterize } from '../renderers/canvas2d/utils';

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
  const fpsRef = useRef({ frames: 0, lastTime: 0, fps: 0 });
  const animationRef = useRef<number>();
  const overlayAnimRef = useRef<number>();
  const lastFrameTimeRef = useRef(0);
  const mouseRef = useRef({ x: 0.5, y: 0.5, inside: false });
  const ripplesRef = useRef<Ripple[]>([]);

  const {
    canvasSettings,
    selectedGeneratorId,
    seed,
    params,
    palette,
    quality,
    isAnimating,
    animationFps,
    postFX,
    sourceImage,
    setSourceImage,
    interactionEnabled,
  } = useStore();

  // Decode source image data-URL → HTMLImageElement
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!sourceImage) { setLoadedImage(null); return; }
    const img = new Image();
    img.onload = () => setLoadedImage(img);
    img.onerror = () => setLoadedImage(null);
    img.src = sourceImage;
  }, [sourceImage]);

  // ── Image ingestion helpers ─────────────────────────────────────────────────
  const readFileAsDataUrl = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setSourceImage(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const loadFromUrl = async (url: string) => {
    // Try fetch first (works when server sends CORS headers)
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Not an image');
      const reader = new FileReader();
      reader.onload = (e) => setSourceImage(e.target?.result as string);
      reader.readAsDataURL(blob);
      return;
    } catch { /* fall through */ }

    // Fallback: load as <img> with crossOrigin (works for same-origin or CORS-enabled CDNs)
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        setSourceImage(c.toDataURL());
      } catch {
        alert('Could not read image — the server may block cross-origin access.');
      }
    };
    img.onerror = () => alert('Failed to load image from URL.');
    img.src = url;
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

  // ── Art canvas: generator rendering ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = canvasSettings.devicePixelRatio || 2;
    canvas.width = canvasSettings.width * dpr;
    canvas.height = canvasSettings.height * dpr;

    const overlay = overlayCanvasRef.current;
    if (overlay) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const generator = getGenerator(selectedGeneratorId);
    if (!generator) {
      console.warn(`Generator not found: ${selectedGeneratorId}`);
      return;
    }

    const finalParams: Record<string, any> = { ...generator.defaultParams, ...params };
    if (loadedImage) finalParams._sourceImage = loadedImage;

    try {
      const fpsInterval = 1000 / animationFps;
      let time = 0;

      const render = (timestamp: number) => {
        time = timestamp / 1000;

        if (generator.renderCanvas2D) {
          generator.renderCanvas2D(ctx, finalParams, seed, palette, quality, time);
        }

        if (!isAnimating) {
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
        }

        if (showFPS && isAnimating) {
          const now = performance.now();
          fpsRef.current.frames++;
          if (now >= fpsRef.current.lastTime + 1000) {
            fpsRef.current.fps = fpsRef.current.frames;
            fpsRef.current.frames = 0;
            fpsRef.current.lastTime = now;
          }
          ctx.fillStyle = '#00ff00';
          ctx.font = '14px monospace';
          ctx.fillText(`${fpsRef.current.fps} / ${animationFps} fps`, 10, 20);
        }
      };

      const animate = (timestamp: number) => {
        const elapsed = timestamp - lastFrameTimeRef.current;
        if (elapsed >= fpsInterval) {
          lastFrameTimeRef.current = timestamp - (elapsed % fpsInterval);
          render(timestamp);
        }
        animationRef.current = requestAnimationFrame(animate);
      };

      if (isAnimating) {
        lastFrameTimeRef.current = 0;
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Show progress bar, then defer the blocking render by two rAF ticks so
        // the browser has a chance to paint the bar before the thread is occupied.
        setIsRendering(true);
        animationRef.current = requestAnimationFrame(() => {
          animationRef.current = requestAnimationFrame(() => {
            try {
              render(0);
            } catch (err) {
              console.error('Rendering error:', err);
              ctx.fillStyle = '#ff0000';
              ctx.font = '14px monospace';
              ctx.fillText('Render Error', 10, 20);
            } finally {
              setIsRendering(false);
            }
          });
        });
      }
    } catch (error) {
      console.error('Rendering setup error:', error);
      ctx.fillStyle = '#ff0000';
      ctx.font = '14px monospace';
      ctx.fillText('Render Error', 10, 20);
      setIsRendering(false);
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      setIsRendering(false);
    };
  }, [canvasSettings, selectedGeneratorId, seed, params, palette, quality, isAnimating, animationFps, postFX, showFPS, loadedImage]);

  // ── Overlay canvas: spotlight + ripple interaction ──────────────────────────
  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    if (!interactionEnabled) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      return;
    }

    const getCanvasPos = (clientX: number, clientY: number) => {
      const rect = overlay.getBoundingClientRect();
      return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
    };

    const onMouseMove = (e: MouseEvent) => {
      const { x, y } = getCanvasPos(e.clientX, e.clientY);
      mouseRef.current = { x, y, inside: true };
    };
    const onMouseLeave = () => { mouseRef.current.inside = false; };
    const onMouseDown = (e: MouseEvent) => {
      const { x, y } = getCanvasPos(e.clientX, e.clientY);
      ripplesRef.current.push({ x, y, startTime: performance.now() });
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const { x, y } = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      mouseRef.current = { x, y, inside: true };
    };
    const onTouchStart = (e: TouchEvent) => {
      const { x, y } = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
      mouseRef.current = { x, y, inside: true };
      ripplesRef.current.push({ x, y, startTime: performance.now() });
    };
    const onTouchEnd = () => { mouseRef.current.inside = false; };

    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseleave', onMouseLeave);
    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('touchmove', onTouchMove, { passive: false });
    overlay.addEventListener('touchstart', onTouchStart);
    overlay.addEventListener('touchend', onTouchEnd);

    // Reset state when interaction is re-enabled
    mouseRef.current = { x: 0.5, y: 0.5, inside: false };
    ripplesRef.current = [];

    const drawOverlay = (timestamp: number) => {
      const w = overlay.width, h = overlay.height;
      ctx.clearRect(0, 0, w, h);

      if (mouseRef.current.inside) {
        const mx = mouseRef.current.x * w, my = mouseRef.current.y * h;
        const grad = ctx.createRadialGradient(mx, my, w * 0.1, mx, my, w * 0.65);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      ripplesRef.current = ripplesRef.current.filter(r => timestamp - r.startTime < RIPPLE_DURATION);
      for (const ripple of ripplesRef.current) {
        const age = (timestamp - ripple.startTime) / RIPPLE_DURATION;
        ctx.save();
        ctx.strokeStyle = `rgba(255,255,255,${(1 - age) * 0.85})`;
        ctx.lineWidth = Math.max(1, 2.5 * (1 - age));
        ctx.beginPath();
        ctx.arc(ripple.x * w, ripple.y * h, age * w * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      overlayAnimRef.current = requestAnimationFrame(drawOverlay);
    };

    overlayAnimRef.current = requestAnimationFrame(drawOverlay);

    return () => {
      if (overlayAnimRef.current) cancelAnimationFrame(overlayAnimRef.current);
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseleave', onMouseLeave);
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('touchmove', onTouchMove);
      overlay.removeEventListener('touchstart', onTouchStart);
      overlay.removeEventListener('touchend', onTouchEnd);
    };
  }, [interactionEnabled]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Art canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-lg bg-black border border-gray-700"
        style={{ aspectRatio: '1 / 1' }}
      />

      {/* Interaction overlay (mouse/touch effects) */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full rounded-lg"
        style={{ aspectRatio: '1 / 1' }}
      />

      {/* Render progress bar */}
      {isRendering && (
        <div
          className="absolute bottom-0 left-0 rounded-b-lg pointer-events-none z-20"
          style={{
            height: '30px',
            background: 'rgba(57, 255, 20, 0.95)',
            boxShadow: '0 0 18px rgba(57, 255, 20, 1), 0 0 40px rgba(57, 255, 20, 0.7)',
            animation: 'render-progress 700ms ease-out forwards',
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

    </div>
  );
};
