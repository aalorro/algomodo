// Canvas 2D rendering utilities and helpers

export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string = '#000000'
) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill?: string,
  stroke?: string,
  lineWidth: number = 1
) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string = '#ffffff',
  lineWidth: number = 1
) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  stroke: string = '#ffffff',
  lineWidth: number = 1,
  closed: boolean = false
) {
  if (points.length < 2) return;
  
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  
  if (closed) ctx.closePath();
  ctx.stroke();
}

export function drawRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill?: string,
  stroke?: string,
  lineWidth: number = 1
) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
  }
  
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x, y, width, height);
  }
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string = '#ffffff',
  fontSize: number = 16,
  fontFamily: string = 'Arial'
) {
  ctx.fillStyle = fill;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillText(text, x, y);
}

export function applyGrain(
  _ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  amount: number
) {
  if (amount <= 0) return imageData;

  const data = imageData.data;
  const scale = amount * 255;
  // Fast LCG (linear congruential generator) — ~10x faster than Math.sin per pixel
  let rng = (Math.random() * 0x7fffffff) | 0;

  for (let i = 0; i < data.length; i += 4) {
    rng = (rng * 1664525 + 1013904223) | 0;
    const grain = ((rng >>> 16) / 65535) * scale;
    data[i] += grain;
    data[i + 1] += grain;
    data[i + 2] += grain;
  }

  return imageData;
}

export function applyVignette(
  _ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  width: number,
  height: number,
  amount: number
) {
  if (amount <= 0) return imageData;

  const data = imageData.data;
  const cx = width / 2;
  const cy = height / 2;
  // Use squared distance — avoids 4.7M sqrt calls at 2160×2160
  const maxD2 = cx * cx + cy * cy;
  const invMaxD2 = amount / maxD2;

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy2;
      // Squared falloff: visually similar to linear, much cheaper
      const vignette = Math.max(0, 1 - d2 * invMaxD2);

      const idx = (y * width + x) * 4;
      data[idx] *= vignette;
      data[idx + 1] *= vignette;
      data[idx + 2] *= vignette;
    }
  }

  return imageData;
}

export function applyDither(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  levels: number = 2
) {
  const data = imageData.data;
  const step = 255 / (levels - 1);
  
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] / step) * step;
    data[i + 1] = Math.round(data[i + 1] / step) * step;
    data[i + 2] = Math.round(data[i + 2] / step) * step;
  }
  
  return imageData;
}

export function applyPosterize(
  imageData: ImageData,
  bits: number
) {
  const data = imageData.data;
  const mask = 255 << (8 - bits);
  
  for (let i = 0; i < data.length; i += 4) {
    data[i] &= mask;
    data[i + 1] &= mask;
    data[i + 2] &= mask;
  }
  
  return imageData;
}
