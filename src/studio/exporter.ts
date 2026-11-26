import type { Doc } from './model';
import { composeFrame } from './raster';
import { encodeGif } from './gif';
import { t } from './i18n';

export type ExportFormat = 'png' | 'sheet' | 'gif';

function scaled(source: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width * scale;
  out.height = source.height * scale;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('Export failed')))), 'image/png'));

export function slug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pixel-art';
}

export function exportSize(doc: Doc, format: ExportFormat, scale: number, columns: number) {
  if (format !== 'sheet') return { width: doc.width * scale, height: doc.height * scale };
  const cols = Math.min(columns, doc.frames.length);
  return { width: doc.width * cols * scale, height: doc.height * Math.ceil(doc.frames.length / cols) * scale };
}

export async function exportDoc(doc: Doc, format: ExportFormat, frame: number, scale: number, columns: number): Promise<Blob> {
  const base = document.createElement('canvas');
  if (format === 'png') {
    composeFrame(base, doc, frame);
    return toBlob(scaled(base, scale));
  }
  if (format === 'sheet') {
    const cols = Math.min(columns, doc.frames.length);
    const rows = Math.ceil(doc.frames.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = doc.width * cols;
    sheet.height = doc.height * rows;
    const ctx = sheet.getContext('2d')!;
    doc.frames.forEach((_, i) => {
      composeFrame(base, doc, i);
      ctx.drawImage(base, (i % cols) * doc.width, Math.floor(i / cols) * doc.height);
    });
    return toBlob(scaled(sheet, scale));
  }
  const frames = doc.frames.map((_, i) => {
    composeFrame(base, doc, i);
    const big = scaled(base, scale);
    return { pixels: big.getContext('2d')!.getImageData(0, 0, big.width, big.height).data, delay: 1000 / doc.fps };
  });
  return encodeGif(doc.width * scale, doc.height * scale, frames);
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
