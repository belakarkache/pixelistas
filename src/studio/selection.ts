import type { Cel } from './model';
import { linePoints, type Point } from './raster';

export type SelectMode = 'rect' | 'lasso';

export type SelectOp = 'replace' | 'add' | 'subtract' | 'intersect';

type Bounds = { x: number; y: number; w: number; h: number };

export type Selection = { width: number; height: number; mask: Uint8Array; bounds: Bounds; outline: Path2D };

export function rectBounds(a: Point, b: Point, square: boolean): Bounds {
  let ex = b.x;
  let ey = b.y;
  if (square) {
    const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ex = a.x + (Math.sign(b.x - a.x) || 1) * d;
    ey = a.y + (Math.sign(b.y - a.y) || 1) * d;
  }
  const x = Math.min(a.x, ex);
  const y = Math.min(a.y, ey);
  return { x, y, w: Math.abs(ex - a.x) + 1, h: Math.abs(ey - a.y) + 1 };
}

function finalize(mask: Uint8Array, width: number, height: number): Selection | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const bounds = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  return { width, height, mask, bounds, outline: traceOutline(mask, width, height, bounds) };
}

export function selectRect(width: number, height: number, r: Bounds): Selection | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.w);
  const y1 = Math.min(height, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) return null;
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + x1);
  return finalize(mask, width, height);
}

export const selectAll = (width: number, height: number) => selectRect(width, height, { x: 0, y: 0, w: width, h: height });

export function selectLasso(width: number, height: number, points: Point[]): Selection | null {
  if (!points.length) return null;
  const mask = new Uint8Array(width * height);
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) mask[y * width + x] = 1;
  };
  const n = points.length;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const xs: number[] = [];
  for (let y = Math.max(0, minY); y <= Math.min(height - 1, maxY); y++) {
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i]));
      const to = Math.min(width - 1, Math.floor(xs[i + 1]));
      if (to >= from) mask.fill(1, y * width + from, y * width + to + 1);
    }
  }
  for (let i = 0; i < n; i++) linePoints(points[i], points[(i + 1) % n], mark);
  return finalize(mask, width, height);
}

export function combineSelection(base: Selection | null, next: Selection | null, op: SelectOp): Selection | null {
  if (op === 'replace') return next;
  if (!base || base.width !== next?.width || base.height !== next.height) {
    if (op === 'add') return next ?? base;
    if (op === 'subtract') return base;
    return null;
  }
  const a = base.mask;
  const b = next.mask;
  const mask = new Uint8Array(a.length);
  if (op === 'add') for (let i = 0; i < a.length; i++) mask[i] = a[i] | b[i];
  else if (op === 'subtract') for (let i = 0; i < a.length; i++) mask[i] = a[i] & (b[i] ^ 1);
  else for (let i = 0; i < a.length; i++) mask[i] = a[i] & b[i];
  return finalize(mask, base.width, base.height);
}

function traceOutline(mask: Uint8Array, width: number, height: number, b: Bounds): Path2D {
  const path = new Path2D();
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  for (let y = b.y; y <= b.y + b.h; y++) {
    let start = -1;
    for (let x = b.x; x <= b.x + b.w; x++) {
      const edge = x < b.x + b.w && at(x, y - 1) !== at(x, y);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) {
        path.moveTo(start, y);
        path.lineTo(x, y);
        start = -1;
      }
    }
  }
  for (let x = b.x; x <= b.x + b.w; x++) {
    let start = -1;
    for (let y = b.y; y <= b.y + b.h; y++) {
      const edge = y < b.y + b.h && at(x - 1, y) !== at(x, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) {
        path.moveTo(x, start);
        path.lineTo(x, y);
        start = -1;
      }
    }
  }
  return path;
}

export function clearSelected(cel: Cel, sel: Selection): Cel {
  const out = cel.slice();
  const { x, y, w, h } = sel.bounds;
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const k = j * sel.width + i;
      if (sel.mask[k]) out[k] = 0;
    }
  }
  return out;
}

function stamp(out: Cel, src: Cel, sel: Selection, dx: number, dy: number): Cel {
  const { width, height, mask } = sel;
  const { x, y, w, h } = sel.bounds;
  for (let j = y; j < y + h; j++) {
    const ty = j + dy;
    if (ty < 0 || ty >= height) continue;
    for (let i = x; i < x + w; i++) {
      const tx = i + dx;
      if (tx < 0 || tx >= width) continue;
      const k = j * width + i;
      if (mask[k] && src[k] >>> 24) out[ty * width + tx] = src[k];
    }
  }
  return out;
}

const moveSelectedPixels = (base: Cel, sel: Selection, dx: number, dy: number): Cel => stamp(clearSelected(base, sel), base, sel, dx, dy);

const exact = (v: number) => Math.round(v * 1e9) / 1e9;

function resample(lift: SelectionLift, box: Box, dx: number, dy: number, mask: Uint8Array | null): Cel {
  const { width, height, bounds: b } = lift.sel;
  const src = lift.pixels ?? lift.origin;
  const out = lift.pixels ? lift.origin.slice() : clearSelected(lift.origin, lift.sel);
  const { w, h } = box;
  const cx = b.x + b.w / 2 + dx;
  const cy = b.y + b.h / 2 + dy;
  const cos = exact(Math.cos(box.angle));
  const sin = exact(Math.sin(box.angle));
  const hw = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
  const hh = (Math.abs(w * sin) + Math.abs(h * cos)) / 2;
  const x0 = Math.max(0, Math.floor(cx - hw));
  const x1 = Math.min(width, Math.ceil(cx + hw));
  const y0 = Math.max(0, Math.floor(cy - hh));
  const y1 = Math.min(height, Math.ceil(cy + hh));
  const kx = b.w / w;
  const ky = b.h / h;
  for (let ty = y0; ty < y1; ty++) {
    const py = ty + 0.5 - cy;
    for (let tx = x0; tx < x1; tx++) {
      const px = tx + 0.5 - cx;
      const u = Math.floor((px * cos + py * sin + w / 2) * kx);
      const v = Math.floor((py * cos - px * sin + h / 2) * ky);
      if (u < 0 || v < 0 || u >= b.w || v >= b.h) continue;
      const k = (b.y + v) * width + b.x + u;
      if (!lift.sel.mask[k]) continue;
      const t = ty * width + tx;
      if (mask) mask[t] = 1;
      if (src[k] >>> 24) out[t] = src[k];
    }
  }
  return out;
}

const isIdentity = (lift: SelectionLift) => !lift.box || (lift.box.angle === 0 && lift.box.w === lift.sel.bounds.w && lift.box.h === lift.sel.bounds.h);

export const liftedCel = (lift: SelectionLift, dx: number, dy: number): Cel => {
  if (lift.box && !isIdentity(lift)) return resample(lift, lift.box, dx, dy, null);
  return lift.pixels ? stamp(lift.origin.slice(), lift.pixels, lift.sel, dx, dy) : moveSelectedPixels(lift.origin, lift.sel, dx, dy);
};

export function placeLift(lift: SelectionLift, dx: number, dy: number): { cel: Cel; sel: Selection | null } {
  if (!lift.box || isIdentity(lift)) return { cel: liftedCel(lift, dx, dy), sel: shiftSelection(lift.sel, dx, dy) };
  const { width, height } = lift.sel;
  const mask = new Uint8Array(width * height);
  const cel = resample(lift, lift.box, dx, dy, mask);
  return { cel, sel: finalize(mask, width, height) };
}

export type Placement = { cx: number; cy: number; w: number; h: number; angle: number };

export function liftPlacement(lift: SelectionLift): Placement {
  const b = lift.sel.bounds;
  const box = lift.box ?? { w: b.w, h: b.h, angle: 0 };
  return { cx: b.x + b.w / 2 + lift.dx, cy: b.y + b.h / 2 + lift.dy, ...box };
}

export function snapPlacement(pl: Placement): Placement {
  const quarter = Math.round(pl.angle / (Math.PI / 2));
  if (Math.abs(pl.angle - (quarter * Math.PI) / 2) > 1e-9) return pl;
  const odd = quarter % 2 !== 0;
  const snap = (c: number, size: number) => (size % 2 ? Math.floor(c) + 0.5 : Math.round(c));
  return { ...pl, cx: snap(pl.cx, odd ? pl.h : pl.w), cy: snap(pl.cy, odd ? pl.w : pl.h) };
}

export function withPlacement(lift: SelectionLift, pl: Placement): { lift: SelectionLift; dx: number; dy: number } {
  const b = lift.sel.bounds;
  return { lift: { ...lift, box: { w: pl.w, h: pl.h, angle: pl.angle } }, dx: pl.cx - b.x - b.w / 2, dy: pl.cy - b.y - b.h / 2 };
}

export type Clip = { width: number; height: number; x: number; y: number; pixels: Cel; mask: Uint8Array };

export function copySelected(cel: Cel, sel: Selection): Clip {
  const { x, y, w, h } = sel.bounds;
  const pixels = new Uint32Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (y + j) * sel.width + x + i;
      if (!sel.mask[k]) continue;
      mask[j * w + i] = 1;
      pixels[j * w + i] = cel[k];
    }
  }
  return { width: w, height: h, x, y, pixels, mask };
}

export function placeClip(clip: Clip, width: number, height: number): { sel: Selection; pixels: Cel } | null {
  const ox = Math.max(0, Math.min(clip.x, width - clip.width));
  const oy = Math.max(0, Math.min(clip.y, height - clip.height));
  const mask = new Uint8Array(width * height);
  const pixels = new Uint32Array(width * height);
  for (let j = 0; j < clip.height; j++) {
    const ty = oy + j;
    if (ty >= height) break;
    for (let i = 0; i < clip.width; i++) {
      const tx = ox + i;
      if (tx >= width) break;
      const s = j * clip.width + i;
      if (!clip.mask[s]) continue;
      mask[ty * width + tx] = 1;
      pixels[ty * width + tx] = clip.pixels[s];
    }
  }
  const sel = finalize(mask, width, height);
  return sel && { sel, pixels };
}

function shiftSelection(sel: Selection, dx: number, dy: number): Selection | null {
  const { width, height, mask } = sel;
  const { x, y, w, h } = sel.bounds;
  const next = new Uint8Array(width * height);
  for (let j = y; j < y + h; j++) {
    const ty = j + dy;
    if (ty < 0 || ty >= height) continue;
    for (let i = x; i < x + w; i++) {
      const tx = i + dx;
      if (tx >= 0 && tx < width && mask[j * width + i]) next[ty * width + tx] = 1;
    }
  }
  return finalize(next, width, height);
}

export const isSelected = (sel: Selection, x: number, y: number) => x >= 0 && y >= 0 && x < sel.width && y < sel.height && sel.mask[y * sel.width + x] === 1;

export type Box = { w: number; h: number; angle: number };

export type SelectionLift = { origin: Cel; sel: Selection; dx: number; dy: number; pixels?: Cel; box?: Box };
