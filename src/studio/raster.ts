import type { Cel, Doc } from './model';

export type Point = { x: number; y: number };

export function linePoints(a: Point, b: Point, visit: (x: number, y: number) => void) {
  let x0 = a.x;
  let y0 = a.y;
  const dx = Math.abs(b.x - x0);
  const dy = -Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1;
  const sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x0, y0);
    if (x0 === b.x && y0 === b.y) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function rectPoints(a: Point, b: Point, filled: boolean, visit: (x: number, y: number) => void) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (filled || x === x0 || x === x1 || y === y0 || y === y1) visit(x, y);
    }
  }
}

export function ellipsePoints(a: Point, b: Point, filled: boolean, visit: (x: number, y: number) => void) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 0.5;
  const ry = (y1 - y0) / 2 + 0.5;
  const inside = (x: number, y: number) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    return nx * nx + ny * ny <= 1;
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) visit(x, y);
    }
  }
}

export function stamp(cel: Cel, w: number, h: number, x: number, y: number, size: number, value: number): boolean {
  const off = Math.floor((size - 1) / 2);
  let changed = false;
  for (let j = 0; j < size; j++) {
    const py = y - off + j;
    if (py < 0 || py >= h) continue;
    for (let i = 0; i < size; i++) {
      const px = x - off + i;
      if (px < 0 || px >= w) continue;
      const n = py * w + px;
      if (cel[n] !== value) {
        cel[n] = value;
        changed = true;
      }
    }
  }
  return changed;
}

export function sameCel(a: Cel | undefined, b: Cel): boolean {
  if (!a) return !b.some((v) => v !== 0);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function floodFill(cel: Cel, w: number, h: number, x: number, y: number, value: number, contiguous: boolean): boolean {
  const target = cel[y * w + x];
  if (target === value) return false;
  if (!contiguous) {
    for (let i = 0; i < cel.length; i++) if (cel[i] === target) cel[i] = value;
    return true;
  }
  const stack = [y * w + x];
  while (stack.length) {
    const n = stack.pop()!;
    if (cel[n] !== target) continue;
    cel[n] = value;
    const px = n % w;
    if (px > 0) stack.push(n - 1);
    if (px < w - 1) stack.push(n + 1);
    if (n >= w) stack.push(n - w);
    if (n < w * (h - 1)) stack.push(n + w);
  }
  return true;
}

export function shiftCel(src: Cel, w: number, h: number, dx: number, dy: number): Cel {
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < w) out[y * w + x] = src[sy * w + sx];
    }
  }
  return out;
}

export function flipCel(src: Cel, w: number, h: number, horizontal: boolean): Cel {
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = horizontal ? src[y * w + (w - 1 - x)] : src[(h - 1 - y) * w + x];
    }
  }
  return out;
}

export function resizeCel(src: Cel, w: number, h: number, nw: number, nh: number, ox: number, oy: number): Cel {
  const out = new Uint32Array(nw * nh);
  for (let y = 0; y < h; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= nh) continue;
    for (let x = 0; x < w; x++) {
      const tx = x + ox;
      if (tx >= 0 && tx < nw) out[ty * nw + tx] = src[y * w + x];
    }
  }
  return out;
}

function celImage(cel: Cel, w: number, h: number): ImageData {
  return new ImageData(new Uint8ClampedArray(cel.buffer, cel.byteOffset, cel.byteLength), w, h);
}

const scratch = document.createElement('canvas');
const scratchCtx = scratch.getContext('2d')!;

type CelOverride = { frame: number; layerId: string; cel: Cel } | null;

export function composeFrame(target: HTMLCanvasElement, doc: Doc, frame: number, override: CelOverride = null) {
  if (target.width !== doc.width || target.height !== doc.height) {
    target.width = doc.width;
    target.height = doc.height;
  }
  if (scratch.width !== doc.width || scratch.height !== doc.height) {
    scratch.width = doc.width;
    scratch.height = doc.height;
  }
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, doc.width, doc.height);
  const cels = doc.frames[frame]?.cels;
  if (!cels) return;
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity === 0) continue;
    const cel = override && override.frame === frame && override.layerId === layer.id ? override.cel : cels[layer.id];
    if (!cel) continue;
    scratchCtx.putImageData(celImage(cel, doc.width, doc.height), 0, 0);
    ctx.globalAlpha = layer.opacity / 100;
    ctx.drawImage(scratch, 0, 0);
  }
  ctx.globalAlpha = 1;
}

export function renderCel(target: HTMLCanvasElement, cel: Cel | undefined, w: number, h: number) {
  if (target.width !== w || target.height !== h) {
    target.width = w;
    target.height = h;
  }
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (cel) ctx.putImageData(celImage(cel, w, h), 0, 0);
}

export function topPixel(doc: Doc, frame: number, x: number, y: number): number {
  const cels = doc.frames[frame]?.cels;
  if (!cels) return 0;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (!layer.visible) continue;
    const v = cels[layer.id]?.[y * doc.width + x];
    if (v && v >>> 24) return v;
  }
  return 0;
}

export function frameToDataUrl(doc: Doc, frame: number, maxSide = 0): string {
  const canvas = document.createElement('canvas');
  composeFrame(canvas, doc, frame);
  if (!maxSide || Math.max(doc.width, doc.height) <= maxSide) return canvas.toDataURL('image/png');
  const s = maxSide / Math.max(doc.width, doc.height);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(doc.width * s));
  out.height = Math.max(1, Math.round(doc.height * s));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
