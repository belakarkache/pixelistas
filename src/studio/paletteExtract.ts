import type { Doc, Reference } from './model';
import type { ExtractRequest, ExtractResponse } from './paletteExtract.worker';
import type { ExtractOptions, ExtractResult } from './paletteQuantize';
import { composeFrame } from './raster';
import { cropOf } from './reference';

export type { ExtractMode, ExtractOptions, ExtractResult, ExtractSort } from './paletteQuantize';

type Pending = { resolve: (r: ExtractResult) => void; reject: (e: unknown) => void; cleanup: () => void };

const DEFAULT_MAX_SIDE = 2048;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

const abortError = () => new DOMException('Palette extraction aborted', 'AbortError');

function failAll(error: unknown) {
  for (const job of pending.values()) {
    job.cleanup();
    job.reject(error);
  }
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  const w = new Worker(new URL('./paletteExtract.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (event: MessageEvent<ExtractResponse>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    job.cleanup();
    if ('error' in event.data) job.reject(new Error(event.data.error));
    else job.resolve(event.data.result);
  };
  w.onerror = (event) => {
    event.preventDefault();
    resetWorker();
    failAll(new Error(event.message || 'Palette worker failed'));
  };
  worker = w;
  return w;
}

function resetWorker() {
  worker?.terminate();
  worker = null;
}

export function extractPalette(source: ImageData, opts: ExtractOptions, signal?: AbortSignal): Promise<ExtractResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const onAbort = () => {
      if (!pending.delete(id)) return;
      reject(abortError());
      const others = [...pending.values()];
      pending.clear();
      resetWorker();
      for (const job of others) {
        job.cleanup();
        job.reject(abortError());
      }
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, { resolve, reject, cleanup });
    const request: ExtractRequest = { id, data: source.data, width: source.width, height: source.height, opts };
    getWorker().postMessage(request);
  });
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

function fitSize(width: number, height: number, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

function drawRegion(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, maxSide: number): ImageData {
  const size = fitSize(sw, sh, maxSide);
  const ctx = canvasOf(size.width, size.height).getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size.width, size.height);
  return ctx.getImageData(0, 0, size.width, size.height);
}

export async function imageDataFromFile(file: Blob, maxSide = DEFAULT_MAX_SIDE): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  try {
    return drawRegion(bitmap, 0, 0, bitmap.width, bitmap.height, maxSide);
  } finally {
    bitmap.close();
  }
}

export function imageDataFromFrame(doc: Doc, frame: number): ImageData {
  const canvas = canvasOf(doc.width, doc.height);
  composeFrame(canvas, doc, frame);
  return canvas.getContext('2d')!.getImageData(0, 0, doc.width, doc.height);
}

export async function imageDataFromReference(ref: Reference, maxSide = DEFAULT_MAX_SIDE): Promise<ImageData> {
  const img = new Image();
  img.decoding = 'async';
  img.src = ref.src;
  await img.decode();
  const c = cropOf(ref);
  const sx = Math.round(c.x * img.naturalWidth);
  const sy = Math.round(c.y * img.naturalHeight);
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(c.w * img.naturalWidth)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(c.h * img.naturalHeight)));
  return drawRegion(img, sx, sy, sw, sh, maxSide);
}
