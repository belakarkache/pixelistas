import { t } from './i18n';
import { MAX_FRAMES, newLayer, uid, type Cel, type Doc, type Layer } from './model';
import { flipCel, resizeCel, shiftCel } from './raster';

const mapCels = (doc: Doc, layerId: string, fn: (cel: Cel | undefined) => Cel | undefined): Doc => ({
  ...doc,
  frames: doc.frames.map((f) => {
    const next = fn(f.cels[layerId]);
    const cels = { ...f.cels };
    if (next) cels[layerId] = next;
    else delete cels[layerId];
    return { ...f, cels };
  }),
});

export function updateLayer(doc: Doc, id: string, patch: Partial<Layer>): Doc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

function nextLayerName(doc: Doc) {
  let n = doc.layers.length + 1;
  while (doc.layers.some((l) => l.name === t('Layer {n}', { n }))) n++;
  return t('Layer {n}', { n });
}

export function addLayer(doc: Doc, aboveId: string): { doc: Doc; id: string } {
  const layer = newLayer(nextLayerName(doc));
  const layers = doc.layers.slice();
  layers.splice(layers.findIndex((l) => l.id === aboveId) + 1, 0, layer);
  return { doc: { ...doc, layers }, id: layer.id };
}

export function duplicateLayer(doc: Doc, id: string): { doc: Doc; id: string } {
  const index = doc.layers.findIndex((l) => l.id === id);
  const source = doc.layers[index];
  const copy = { ...source, id: uid(), name: `${source.name} copy` };
  const layers = doc.layers.slice();
  layers.splice(index + 1, 0, copy);
  return {
    doc: { ...doc, layers, frames: doc.frames.map((f) => (f.cels[id] ? { ...f, cels: { ...f.cels, [copy.id]: f.cels[id].slice() } } : f)) },
    id: copy.id,
  };
}

export function deleteLayer(doc: Doc, id: string): Doc {
  if (doc.layers.length < 2) return doc;
  return { ...mapCels(doc, id, () => undefined), layers: doc.layers.filter((l) => l.id !== id) };
}

export function moveLayer(doc: Doc, id: string, dir: 1 | -1): Doc {
  const i = doc.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (j < 0 || j >= doc.layers.length) return doc;
  const layers = doc.layers.slice();
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...doc, layers };
}

export function reorderLayer(doc: Doc, id: string, to: number): Doc {
  const i = doc.layers.findIndex((l) => l.id === id);
  const j = Math.max(0, Math.min(doc.layers.length - 1, to));
  if (i < 0 || i === j) return doc;
  const layers = doc.layers.slice();
  const [moved] = layers.splice(i, 1);
  layers.splice(j, 0, moved);
  return { ...doc, layers };
}

function over(lower: Cel | undefined, upper: Cel, opacity: number): Cel {
  const out = lower ? lower.slice() : new Uint32Array(upper.length);
  const k = opacity / 100;
  for (let i = 0; i < upper.length; i++) {
    const u = upper[i];
    const ua = ((u >>> 24) / 255) * k;
    if (ua === 0) continue;
    const l = out[i];
    const la = (l >>> 24) / 255;
    const a = ua + la * (1 - ua);
    const mix = (shift: number) => {
      const uc = (u >>> shift) & 255;
      const lc = (l >>> shift) & 255;
      return Math.round((uc * ua + lc * la * (1 - ua)) / a);
    };
    out[i] = ((Math.round(a * 255) << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
  }
  return out;
}

export function mergeDown(doc: Doc, id: string): { doc: Doc; id: string } | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 1) return null;
  const upper = doc.layers[i];
  const lower = doc.layers[i - 1];
  const frames = doc.frames.map((f) => {
    const cels = { ...f.cels };
    const up = cels[upper.id];
    delete cels[upper.id];
    if (up && upper.visible) cels[lower.id] = over(cels[lower.id], up, upper.opacity);
    return { ...f, cels };
  });
  return { doc: { ...doc, frames, layers: doc.layers.filter((l) => l.id !== upper.id) }, id: lower.id };
}

function transformCel(doc: Doc, frame: number, layerId: string, fn: (cel: Cel) => Cel): Doc {
  const cel = doc.frames[frame]?.cels[layerId];
  if (!cel) return doc;
  const frames = doc.frames.slice();
  frames[frame] = { ...frames[frame], cels: { ...frames[frame].cels, [layerId]: fn(cel) } };
  return { ...doc, frames };
}

export const flipLayer = (doc: Doc, frame: number, layerId: string, horizontal: boolean) =>
  transformCel(doc, frame, layerId, (c) => flipCel(c, doc.width, doc.height, horizontal));

export const nudgeLayer = (doc: Doc, frame: number, layerId: string, dx: number, dy: number) =>
  transformCel(doc, frame, layerId, (c) => shiftCel(c, doc.width, doc.height, dx, dy));

export const clearLayer = (doc: Doc, frame: number, layerId: string) =>
  transformCel(doc, frame, layerId, (c) => new Uint32Array(c.length));

export function addFrame(doc: Doc, after: number, duplicate: boolean): Doc {
  if (doc.frames.length >= MAX_FRAMES) return doc;
  const source = doc.frames[after];
  const cels: Record<string, Cel> = {};
  if (duplicate) for (const [k, v] of Object.entries(source.cels)) cels[k] = v.slice();
  const frames = doc.frames.slice();
  frames.splice(after + 1, 0, { id: uid(), cels });
  return { ...doc, frames };
}

export function deleteFrame(doc: Doc, index: number): Doc {
  if (doc.frames.length < 2) return doc;
  return { ...doc, frames: doc.frames.filter((_, i) => i !== index) };
}

export function moveFrame(doc: Doc, index: number, dir: 1 | -1): Doc {
  const j = index + dir;
  if (j < 0 || j >= doc.frames.length) return doc;
  const frames = doc.frames.slice();
  [frames[index], frames[j]] = [frames[j], frames[index]];
  return { ...doc, frames };
}

export function reorderFrame(doc: Doc, from: number, to: number): Doc {
  const j = Math.max(0, Math.min(doc.frames.length - 1, to));
  if (from < 0 || from >= doc.frames.length || from === j) return doc;
  const frames = doc.frames.slice();
  const [moved] = frames.splice(from, 1);
  frames.splice(j, 0, moved);
  return { ...doc, frames };
}

export function resizeDoc(doc: Doc, width: number, height: number, ax: number, ay: number): Doc {
  const ox = Math.round(((width - doc.width) * ax) / 2);
  const oy = Math.round(((height - doc.height) * ay) / 2);
  return {
    ...doc,
    width,
    height,
    frames: doc.frames.map((f) => {
      const cels: Record<string, Cel> = {};
      for (const [k, v] of Object.entries(f.cels)) cels[k] = resizeCel(v, doc.width, doc.height, width, height, ox, oy);
      return { ...f, cels };
    }),
  };
}
