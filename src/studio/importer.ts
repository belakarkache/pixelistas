import { MAX_SIZE, newLayer, uid, type Doc } from './model';
import { t } from './i18n';

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t('Could not read this image')));
    image.src = src;
  });
}

export async function docFromImage(file: File): Promise<{ doc: Doc; downscaled: boolean }> {
  const image = await loadImage(await readFileAsDataUrl(file));
  const fit = Math.min(1, MAX_SIZE / image.width, MAX_SIZE / image.height);
  const width = Math.max(1, Math.round(image.width * fit));
  const height = Math.max(1, Math.round(image.height * fit));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const cel = new Uint32Array(width * height);
  new Uint8ClampedArray(cel.buffer).set(data);
  const layer = newLayer(t('Layer {n}', { n: 1 }));
  return {
    doc: { width, height, layers: [layer], frames: [{ id: uid(), cels: { [layer.id]: cel } }], fps: 8 },
    downscaled: fit < 1,
  };
}
