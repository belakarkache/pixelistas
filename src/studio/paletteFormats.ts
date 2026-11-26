import { download, slug } from './exporter';
import { t } from './i18n';

const unreadable = (n: number) => (n > 1 ? t('Ignored {n} unreadable lines.', { n }) : t('Ignored 1 unreadable line.'));

interface PaletteData {
  name: string;
  colors: string[];
}

interface ParsedPalette extends PaletteData {
  warnings: string[];
}

export class TooManyColorsError extends Error {
  constructor(limit: number) {
    super(`This image has more than ${limit} unique colors.`);
  }
}

export const PALETTE_ACCEPT = '.gpl,.pal,.hex,.txt,.ase,.aco,.json,.png,.gif,.bmp,.jpg,.jpeg,.webp';

type PaletteFormat = 'gpl' | 'hex' | 'pal' | 'png';

type Kind = 'gpl' | 'jasc' | 'riff' | 'hex' | 'paintnet' | 'ase' | 'aco' | 'image' | 'json';

const MAX_IMAGE_COLORS = 256;
const IMAGE_EXTENSIONS = ['png', 'gif', 'bmp', 'jpg', 'jpeg', 'webp'];

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const byteHex = (n: number) => clamp255(n).toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`;

function rgbaHex(r: number, g: number, b: number, a: number) {
  const base = rgbHex(r, g, b);
  return a >= 255 ? base : `${base}${byteHex(a)}`;
}

export function normalizeHex(value: string): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{8}|[0-9a-f]{3})$/i.exec(value.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6);
  return `#${h}`;
}

function baseName(file: File) {
  return file.name.replace(/\.[^./\\]+$/, '').trim() || t('Palette');
}

function extension(file: File) {
  const m = /\.([^./\\]+)$/.exec(file.name);
  return m ? m[1].toLowerCase() : '';
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

function textLines(text: string) {
  return text.split(/\r\n|\r|\n/);
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function sniff(bytes: Uint8Array, ext: string): Kind | null {
  const head = ascii(bytes, 0, 12);
  if (head.startsWith('ASEF')) return 'ase';
  if (head.startsWith('RIFF') && ascii(bytes, 8, 4) === 'PAL ') return 'riff';
  if (head.startsWith('RIFF') && ascii(bytes, 8, 4) === 'WEBP') return 'image';
  if (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') return 'image';
  if (head.startsWith('GIF8') || head.startsWith('BM') || (bytes[0] === 0xff && bytes[1] === 0xd8)) return 'image';
  const text = decodeText(bytes.subarray(0, 512)).trimStart();
  if (text.startsWith('GIMP Palette')) return 'gpl';
  if (text.startsWith('JASC-PAL')) return 'jasc';
  if (ext === 'aco') return 'aco';
  if (ext === 'json' || text.startsWith('{') || text.startsWith('[')) return 'json';
  if (ext === 'gpl') return 'gpl';
  if (ext === 'pal') return 'jasc';
  if (ext === 'hex') return 'hex';
  if (ext === 'txt') return 'paintnet';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (ext === 'ase') return 'ase';
  const first = text.split(/\r\n|\r|\n/).map((l) => l.trim()).find((l) => l && !l.startsWith(';'));
  if (first && /^#?[0-9a-f]{8}$/i.test(first) && text.includes(';')) return 'paintnet';
  if (first && /^#?[0-9a-f]{6}$/i.test(first)) return 'hex';
  if (first && /^#?[0-9a-f]{8}$/i.test(first)) return 'paintnet';
  return null;
}

function parseGpl(text: string, fallback: string): ParsedPalette {
  const warnings: string[] = [];
  const colors: string[] = [];
  let name = fallback;
  let skipped = 0;
  for (const raw of textLines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('GIMP Palette')) continue;
    const meta = /^(Name|Columns):\s*(.*)$/i.exec(line);
    if (meta) {
      if (meta[1].toLowerCase() === 'name' && meta[2].trim()) name = meta[2].trim();
      continue;
    }
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s|$)/.exec(line);
    if (m) colors.push(rgbHex(+m[1], +m[2], +m[3]));
    else skipped++;
  }
  if (skipped) warnings.push(unreadable(skipped));
  return { name, colors, warnings };
}

function parseJasc(text: string, fallback: string): ParsedPalette {
  const lines = textLines(text).map((l) => l.trim()).filter(Boolean);
  const warnings: string[] = [];
  const declared = parseInt(lines[2] ?? '', 10);
  const colors: string[] = [];
  for (const line of lines.slice(3)) {
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(line);
    if (m) colors.push(rgbHex(+m[1], +m[2], +m[3]));
  }
  if (Number.isFinite(declared) && declared !== colors.length) {
    warnings.push(t('File declares {declared} colors but {found} were found.', { declared, found: colors.length }));
  }
  return { name: fallback, colors, warnings };
}

function parseRiff(bytes: Uint8Array, fallback: string): ParsedPalette {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colors: string[] = [];
  const warnings: string[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos, 4);
    const size = view.getUint32(pos + 4, true);
    if (id === 'data') {
      const count = view.getUint16(pos + 8 + 2, true);
      for (let i = 0; i < count; i++) {
        const o = pos + 8 + 4 + i * 4;
        if (o + 3 > bytes.length) {
          warnings.push(t('Palette data is truncated.'));
          break;
        }
        colors.push(rgbHex(bytes[o], bytes[o + 1], bytes[o + 2]));
      }
      break;
    }
    pos += 8 + size + (size % 2);
  }
  return { name: fallback, colors, warnings };
}

function parseHexList(text: string, fallback: string): ParsedPalette {
  const colors: string[] = [];
  let skipped = 0;
  for (const raw of textLines(text)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^#?([0-9a-f]{6})$/i.exec(line);
    if (m) colors.push(`#${m[1].toLowerCase()}`);
    else skipped++;
  }
  const warnings = skipped ? [unreadable(skipped)] : [];
  return { name: fallback, colors, warnings };
}

function parsePaintNet(text: string, fallback: string): ParsedPalette {
  const colors: string[] = [];
  let skipped = 0;
  for (const raw of textLines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const m = /^#?([0-9a-f]{8})$/i.exec(line);
    if (m) {
      const v = m[1];
      colors.push(rgbaHex(parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), parseInt(v.slice(6, 8), 16), parseInt(v.slice(0, 2), 16)));
    } else {
      const six = /^#?([0-9a-f]{6})$/i.exec(line);
      if (six) colors.push(`#${six[1].toLowerCase()}`);
      else skipped++;
    }
  }
  const warnings = skipped ? [unreadable(skipped)] : [];
  return { name: fallback, colors, warnings };
}

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)];
}

function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = 0.95047 * inv(fx);
  const y = inv(fy);
  const z = 1.08883 * inv(fz);
  const lin = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
  const gamma = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055);
  return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2])];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

function parseAse(bytes: Uint8Array, fallback: string): ParsedPalette {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colors: string[] = [];
  const converted = new Set<string>();
  const total = view.getUint32(8);
  let pos = 12;
  for (let i = 0; i < total && pos + 6 <= bytes.length; i++) {
    const type = view.getUint16(pos);
    const length = view.getUint32(pos + 2);
    const start = pos + 6;
    pos = start + length;
    if (type !== 0x0001) continue;
    const nameChars = view.getUint16(start);
    const modelAt = start + 2 + nameChars * 2;
    const model = ascii(bytes, modelAt, 4).trim();
    const v = modelAt + 4;
    const f = (n: number) => view.getFloat32(v + n * 4);
    if (model === 'RGB') {
      colors.push(rgbHex(f(0) * 255, f(1) * 255, f(2) * 255));
    } else if (model === 'CMYK') {
      colors.push(rgbHex(...cmykToRgb(f(0), f(1), f(2), f(3))));
      converted.add('CMYK');
    } else if (model === 'Gray') {
      colors.push(rgbHex(f(0) * 255, f(0) * 255, f(0) * 255));
      converted.add('Gray');
    } else if (model === 'LAB') {
      colors.push(rgbHex(...labToRgb(f(0) * 100, f(1), f(2))));
      converted.add('LAB');
    }
  }
  const warnings = converted.size ? [t('Converted {models} swatches to RGB approximately.', { models: [...converted].join('/') })] : [];
  return { name: fallback, colors, warnings };
}

function parseAco(bytes: Uint8Array, fallback: string): ParsedPalette {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const converted = new Set<string>();
  const readSection = (offset: number, version: 1 | 2) => {
    const count = view.getUint16(offset + 2);
    let pos = offset + 4;
    const colors: string[] = [];
    for (let i = 0; i < count; i++) {
      if (pos + 10 > bytes.length) break;
      const space = view.getUint16(pos);
      const w = view.getUint16(pos + 2);
      const x = view.getUint16(pos + 4);
      const y = view.getUint16(pos + 6);
      const z = view.getUint16(pos + 8);
      pos += 10;
      if (version === 2) {
        pos += 2;
        const chars = view.getUint16(pos);
        pos += 2 + chars * 2;
      }
      if (space === 0) {
        colors.push(rgbHex(w / 256, x / 256, y / 256));
      } else if (space === 1) {
        colors.push(rgbHex(...hsvToRgb(w / 65535, x / 65535, y / 65535)));
        converted.add('HSB');
      } else if (space === 2) {
        colors.push(rgbHex(...cmykToRgb(1 - w / 65535, 1 - x / 65535, 1 - y / 65535, 1 - z / 65535)));
        converted.add('CMYK');
      } else if (space === 7) {
        colors.push(rgbHex(...labToRgb(w / 100, (x - 32768) / 128, (y - 32768) / 128)));
        converted.add('Lab');
      } else if (space === 8) {
        const g = (w / 10000) * 255;
        colors.push(rgbHex(g, g, g));
        converted.add('Gray');
      }
    }
    return { colors, end: pos };
  };
  const v1 = readSection(0, 1);
  let colors = v1.colors;
  if (v1.end + 4 <= bytes.length && view.getUint16(v1.end) === 2) colors = readSection(v1.end, 2).colors;
  const warnings = converted.size ? [t('Converted {models} swatches to RGB approximately.', { models: [...converted].join('/') })] : [];
  return { name: fallback, colors, warnings };
}

async function parseImage(file: File, fallback: string): Promise<ParsedPalette> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(t('Could not read this image.'));
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const seen = new Set<string>();
  const colors: string[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const hex = rgbaHex(data[i], data[i + 1], data[i + 2], data[i + 3]);
    if (seen.has(hex)) continue;
    seen.add(hex);
    colors.push(hex);
    if (colors.length > MAX_IMAGE_COLORS) {
      throw new TooManyColorsError(MAX_IMAGE_COLORS);
    }
  }
  return { name: fallback, colors, warnings: [] };
}

function parseJson(text: string, fallback: string): ParsedPalette {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('Invalid JSON file.'));
  }
  const list = Array.isArray(data) ? data : (data as { colors?: unknown } | null)?.colors;
  if (!Array.isArray(list)) throw new Error(t('No colors found in this file.'));
  const named = !Array.isArray(data) ? (data as { name?: unknown }).name : undefined;
  const name = typeof named === 'string' && named.trim() ? named.trim() : fallback;
  const colors: string[] = [];
  let skipped = 0;
  for (const item of list) {
    const hex = typeof item === 'string' ? normalizeHex(item) : null;
    if (hex) colors.push(hex);
    else skipped++;
  }
  const warnings = skipped ? [`Ignored ${skipped} invalid color${skipped > 1 ? 's' : ''}.`] : [];
  return { name, colors, warnings };
}

export async function parsePaletteFile(file: File): Promise<ParsedPalette> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) throw new Error(t('This file is empty.'));
  const kind = sniff(bytes, extension(file));
  if (!kind) throw new Error(t('Unknown palette format.'));
  const fallback = baseName(file);
  let result: ParsedPalette;
  try {
    switch (kind) {
      case 'gpl':
        result = parseGpl(decodeText(bytes), fallback);
        break;
      case 'jasc':
        result = parseJasc(decodeText(bytes), fallback);
        break;
      case 'riff':
        result = parseRiff(bytes, fallback);
        break;
      case 'hex':
        result = parseHexList(decodeText(bytes), fallback);
        break;
      case 'paintnet':
        result = parsePaintNet(decodeText(bytes), fallback);
        break;
      case 'ase':
        result = parseAse(bytes, fallback);
        break;
      case 'aco':
        result = parseAco(bytes, fallback);
        break;
      case 'image':
        result = await parseImage(file, fallback);
        break;
      default:
        result = parseJson(decodeText(bytes), fallback);
    }
  } catch (e) {
    if (e instanceof RangeError) throw new Error(t('This file is corrupted or truncated.'));
    throw e;
  }
  if (!result.colors.length) throw new Error(t('No colors found in this file.'));
  return result;
}

function rgbOf(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toGpl(palette: PaletteData): string {
  const lines = ['GIMP Palette', `Name: ${palette.name.replace(/[\r\n]+/g, ' ')}`, 'Columns: 0', '#'];
  for (const hex of palette.colors) {
    const [r, g, b] = rgbOf(hex);
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${hex.slice(0, 7)}`);
  }
  return `${lines.join('\n')}\n`;
}

function toHex(palette: PaletteData): string {
  return `${palette.colors.map((c) => c.slice(1, 7)).join('\n')}\n`;
}

function toPalJasc(palette: PaletteData): string {
  const lines = ['JASC-PAL', '0100', String(palette.colors.length)];
  for (const hex of palette.colors) lines.push(rgbOf(hex).join(' '));
  return `${lines.join('\r\n')}\r\n`;
}

function toPng(palette: PaletteData, scale = 1): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, palette.colors.length) * scale;
  canvas.height = scale;
  const ctx = canvas.getContext('2d')!;
  palette.colors.forEach((hex, i) => {
    ctx.fillStyle = hex;
    ctx.fillRect(i * scale, 0, scale, scale);
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('Export failed')))), 'image/png'),
  );
}

export async function downloadPalette(palette: PaletteData, format: PaletteFormat, scale = 1) {
  const base = slug(palette.name) || 'palette';
  if (format === 'png') return download(await toPng(palette, scale), `${base}${scale > 1 ? `-${scale}x` : ''}.png`);
  if (format === 'gpl') return download(new Blob([toGpl(palette)], { type: 'text/plain' }), `${base}.gpl`);
  if (format === 'hex') return download(new Blob([toHex(palette)], { type: 'text/plain' }), `${base}.hex`);
  return download(new Blob([toPalJasc(palette)], { type: 'text/plain' }), `${base}.pal`);
}
