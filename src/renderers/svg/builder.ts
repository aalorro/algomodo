// SVG path builder utilities

export class SVGPathBuilder {
  private paths: Array<{
    d: string;
    stroke?: string;
    fill?: string;
    strokeWidth?: number;
    opacity?: number;
  }> = [];

  private currentPath: string = '';
  private currentX: number = 0;
  private currentY: number = 0;


  moveTo(x: number, y: number): this {
    this.currentPath += `M ${x.toFixed(2)} ${y.toFixed(2)} `;
    this.currentX = x;
    this.currentY = y;
    return this;
  }

  lineTo(x: number, y: number): this {
    this.currentPath += `L ${x.toFixed(2)} ${y.toFixed(2)} `;
    this.currentX = x;
    this.currentY = y;
    return this;
  }

  curveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this {
    this.currentPath += `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} `;
    this.currentX = x;
    this.currentY = y;
    return this;
  }

  quadraticTo(cpx: number, cpy: number, x: number, y: number): this {
    this.currentPath += `Q ${cpx.toFixed(2)} ${cpy.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} `;
    this.currentX = x;
    this.currentY = y;
    return this;
  }

  arcTo(rx: number, ry: number, rotation: number, largeArc: boolean, sweep: boolean, x: number, y: number): this {
    const arc = largeArc ? 1 : 0;
    const dir = sweep ? 1 : 0;
    this.currentPath += `A ${rx.toFixed(2)} ${ry.toFixed(2)} ${rotation} ${arc} ${dir} ${x.toFixed(2)} ${y.toFixed(2)} `;
    this.currentX = x;
    this.currentY = y;
    return this;
  }

  circle(x: number, y: number, r: number): this {
    this.moveTo(x + r, y);
    this.arcTo(r, r, 0, true, true, x - r, y);
    this.arcTo(r, r, 0, true, true, x + r, y);
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.moveTo(x, y);
    this.lineTo(x + width, y);
    this.lineTo(x + width, y + height);
    this.lineTo(x, y + height);
    this.lineTo(x, y);
    return this;
  }

  closePath(): this {
    this.currentPath += 'Z ';
    return this;
  }

  endPath(stroke?: string, fill?: string, strokeWidth: number = 1, opacity: number = 1): this {
    if (this.currentPath.trim()) {
      this.paths.push({
        d: this.currentPath.trim(),
        stroke,
        fill,
        strokeWidth,
        opacity,
      });
    }
    this.currentPath = '';
    return this;
  }

  getPath(): string {
    return this.currentPath.trim();
  }

  getPaths() {
    return this.paths;
  }

  clear(): this {
    this.paths = [];
    this.currentPath = '';
    return this;
  }

  addPath(d: string, stroke?: string, fill?: string, strokeWidth: number = 1, opacity: number = 1): this {
    this.paths.push({ d, stroke, fill, strokeWidth, opacity });
    return this;
  }

  addCircle(x: number, y: number, r: number, fill?: string, stroke?: string, opacity: number = 1): this {
    this.paths.push({
      d: `M ${x + r} ${y} A ${r} ${r} 0 1 1 ${x - r} ${y} A ${r} ${r} 0 1 1 ${x + r} ${y} Z`,
      fill,
      stroke,
      opacity,
    });
    return this;
  }

  addLine(x1: number, y1: number, x2: number, y2: number, stroke?: string, strokeWidth: number = 1, opacity: number = 1): this {
    this.paths.push({
      d: `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
      stroke,
      strokeWidth,
      opacity,
    });
    return this;
  }

  addPolyline(points: [number, number][], stroke?: string, fill?: string, strokeWidth: number = 1, opacity: number = 1): this {
    if (points.length < 2) return this;
    let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
    }
    this.paths.push({ d, stroke, fill, strokeWidth, opacity });
    return this;
  }

  addPolygon(points: [number, number][], fill?: string, stroke?: string, strokeWidth: number = 1, opacity: number = 1): this {
    if (points.length < 3) return this;
    let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
    }
    d += ' Z';
    this.paths.push({ d, fill, stroke, strokeWidth, opacity });
    return this;
  }
}

export function generateSVG(
  paths: Array<any>,
  width: number,
  height: number,
  background: string = '#000000'
): string {
  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n`;
  svg += `<rect width="${width}" height="${height}" fill="${background}"/>\n`;
  
  for (const path of paths) {
    let attrs = `d="${path.d}"`;
    if (path.fill) attrs += ` fill="${path.fill}"`;
    else attrs += ` fill="none"`;
    if (path.stroke) attrs += ` stroke="${path.stroke}"`;
    if (path.strokeWidth) attrs += ` stroke-width="${path.strokeWidth}"`;
    if (path.opacity !== undefined && path.opacity < 1) attrs += ` opacity="${path.opacity}"`;
    
    svg += `<path ${attrs}/>\n`;
  }
  
  svg += '</svg>';
  return svg;
}

export function downloadSVG(svg: string, filename: string = 'artwork.svg') {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
