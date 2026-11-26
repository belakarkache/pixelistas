import type { Reference, ReferenceCrop } from './model';

export type RefHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
export type RefMode = 'move' | 'crop';
type Rect = { x: number; y: number; width: number; height: number };

export const REF_HANDLES: RefHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const FULL_CROP: ReferenceCrop = { x: 0, y: 0, w: 1, h: 1 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const handleSigns = (handle: RefHandle) => ({
  sx: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
  sy: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
});

export const cropOf = (ref: Reference) => ref.crop ?? FULL_CROP;

export function fullRect(ref: Reference): Rect {
  const c = cropOf(ref);
  const width = ref.width / c.w;
  const height = ref.height / c.h;
  return { x: ref.x - c.x * width, y: ref.y - c.y * height, width, height };
}

export function resizeReference(ref: Reference, handle: RefHandle, dx: number, dy: number, free: boolean): Reference {
  const { sx, sy } = handleSigns(handle);
  let width = sx ? Math.max(1, ref.width + sx * dx) : ref.width;
  let height = sy ? Math.max(1, ref.height + sy * dy) : ref.height;
  if (sx && sy && !free) {
    const byWidth = Math.abs(dx / ref.width) >= Math.abs(dy / ref.height);
    const scale = Math.max(byWidth ? width / ref.width : height / ref.height, 1 / ref.width, 1 / ref.height);
    width = ref.width * scale;
    height = ref.height * scale;
  }
  const x = sx < 0 ? ref.x + ref.width - width : ref.x;
  const y = sy < 0 ? ref.y + ref.height - height : ref.y;
  return { ...ref, x, y, width, height };
}

const withWindow = (ref: Reference, full: Rect, l: number, t: number, r: number, b: number): Reference => {
  const crop = { x: (l - full.x) / full.width, y: (t - full.y) / full.height, w: (r - l) / full.width, h: (b - t) / full.height };
  const whole = crop.x <= 1e-6 && crop.y <= 1e-6 && crop.w >= 1 - 1e-6 && crop.h >= 1 - 1e-6;
  return { ...ref, x: l, y: t, width: r - l, height: b - t, crop: whole ? undefined : crop };
};

export function cropReference(ref: Reference, handle: RefHandle, dx: number, dy: number): Reference {
  const { sx, sy } = handleSigns(handle);
  const full = fullRect(ref);
  const minW = Math.min(1, full.width);
  const minH = Math.min(1, full.height);
  let l = ref.x;
  let t = ref.y;
  let r = ref.x + ref.width;
  let b = ref.y + ref.height;
  if (sx < 0) l = clamp(l + dx, full.x, r - minW);
  if (sx > 0) r = clamp(r + dx, l + minW, full.x + full.width);
  if (sy < 0) t = clamp(t + dy, full.y, b - minH);
  if (sy > 0) b = clamp(b + dy, t + minH, full.y + full.height);
  return withWindow(ref, full, l, t, r, b);
}

export function panCrop(ref: Reference, dx: number, dy: number): Reference {
  const full = fullRect(ref);
  const fx = clamp(full.x + dx, ref.x + ref.width - full.width, ref.x);
  const fy = clamp(full.y + dy, ref.y + ref.height - full.height, ref.y);
  return withWindow(ref, { ...full, x: fx, y: fy }, ref.x, ref.y, ref.x + ref.width, ref.y + ref.height);
}

export function scaleReference(ref: Reference, scale: number, cx: number, cy: number): Reference {
  const s = Math.max(scale, 1 / ref.width, 1 / ref.height);
  return { ...ref, x: cx - (cx - ref.x) * s, y: cy - (cy - ref.y) * s, width: ref.width * s, height: ref.height * s };
}

export function placeReference(ref: Reference, docW: number, docH: number, cover: boolean): Reference {
  const pick = cover ? Math.max : Math.min;
  const s = pick(docW / ref.width, docH / ref.height);
  const width = ref.width * s;
  const height = ref.height * s;
  return { ...ref, x: (docW - width) / 2, y: (docH - height) / 2, width, height };
}

export function resetCrop(ref: Reference): Reference {
  return { ...ref, ...fullRect(ref), crop: undefined };
}
