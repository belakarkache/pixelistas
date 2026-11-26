import { t } from './i18n';

export type Cel = Uint32Array<ArrayBuffer>;

export type Layer = { id: string; name: string; visible: boolean; opacity: number };

export type Frame = { id: string; cels: Record<string, Cel> };

export type Doc = { width: number; height: number; layers: Layer[]; frames: Frame[]; fps: number };

export type ReferenceCrop = { x: number; y: number; w: number; h: number };

export type Reference = {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: ReferenceCrop;
  opacity: number;
  visible: boolean;
  above: boolean;
};

export type Project = {
  id: string;
  name: string;
  doc: Doc;
  palette: string[];
  paletteId?: string | null;
  reference: Reference | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  width: number;
  height: number;
  frameCount: number;
  thumb: string;
  updatedAt: number;
};

export const MAX_SIZE = 512;
export const MAX_FRAMES = 64;

const DEFAULT_PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
  '#000000', '#ffffff', '#7a4841', '#c28569', '#e8c8a3', '#f2a5b8', '#c77dff', '#8ecae6',
];

export type PaletteSource = 'custom' | 'imported' | 'image' | 'preset';

export type Palette = {
  id: string;
  name: string;
  colors: string[];
  source: PaletteSource;
  createdAt: number;
  updatedAt: number;
};

export const PALETTE_PRESETS: Palette[] = [
  { id: 'preset-pixelistas-24', name: 'Pixelistas 24', source: 'preset', createdAt: 0, updatedAt: 0, colors: DEFAULT_PALETTE },
  { id: 'preset-1-bit', name: '1-bit', source: 'preset', createdAt: 0, updatedAt: 0, colors: ['#000000', '#ffffff'] },
  { id: 'preset-handheld-4', name: 'Handheld 4', source: 'preset', createdAt: 0, updatedAt: 0, colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  { id: 'preset-sweetie-16', name: 'Sweetie 16', source: 'preset', createdAt: 0, updatedAt: 0, colors: [
    '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
    '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
  ] },
  { id: 'preset-endesga-32', name: 'Endesga 32', source: 'preset', createdAt: 0, updatedAt: 0, colors: [
    '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
    '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
    '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
    '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
  ] },
  { id: 'preset-resurrect-64', name: 'Resurrect 64', source: 'preset', createdAt: 0, updatedAt: 0, colors: [
    '#2e222f', '#3e3546', '#625565', '#966c6c', '#ab947a', '#694f62', '#7f708a', '#9babb2',
    '#c7dcd0', '#ffffff', '#6e2727', '#b33831', '#ea4f36', '#f57d4a', '#ae2334', '#e83b3b',
    '#fb6b1d', '#f79617', '#f9c22b', '#7a3045', '#9e4539', '#cd683d', '#e6904e', '#fbb954',
    '#4c3e24', '#676633', '#a2a947', '#d5e04b', '#fbff86', '#165a4c', '#239063', '#1ebc73',
    '#91db69', '#cddf6c', '#313638', '#374e4a', '#547e64', '#92a984', '#b2ba90', '#0b5e65',
    '#0b8a8f', '#0eaf9b', '#30e1b9', '#8ff8e2', '#323353', '#484a77', '#4d65b4', '#4d9be6',
    '#8fd3ff', '#45293f', '#6b3e75', '#905ea9', '#a884f3', '#eaaded', '#753c54', '#a24b6f',
    '#cf657f', '#ed8099', '#831c5d', '#c32454', '#f04f78', '#f68181', '#fca790', '#fdcbb0',
  ] },
];

export const uid = () => crypto.randomUUID();

export const clampSize = (v: number) => Math.max(1, Math.min(MAX_SIZE, Math.round(v) || 1));

export function packHex(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const a = hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255;
  return ((a << 24) | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0;
}

export function unpackHex(v: number): string {
  const r = v & 255;
  const g = (v >> 8) & 255;
  const b = (v >> 16) & 255;
  const a = v >>> 24;
  const rgb = ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  return `#${rgb}${a === 255 ? '' : a.toString(16).padStart(2, '0')}`;
}

export const isHex = (v: string) => /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);

export function normalizeHex(v: string): string | null {
  let s = v.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{8}$/.test(s)) return s.endsWith('ff') ? `#${s.slice(0, 6)}` : `#${s}`;
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

export function newLayer(name: string): Layer {
  return { id: uid(), name, visible: true, opacity: 100 };
}

export function newDoc(width: number, height: number, background?: string): Doc {
  const layer = newLayer(t('Layer {n}', { n: 1 }));
  const cel = new Uint32Array(width * height);
  if (background) cel.fill(packHex(background));
  return { width, height, layers: [layer], frames: [{ id: uid(), cels: { [layer.id]: cel } }], fps: 8 };
}

export function newProject(name: string, doc: Doc): Project {
  const now = Date.now();
  return { id: uid(), name: name.trim() || t('Untitled'), doc, palette: [...DEFAULT_PALETTE], reference: null, createdAt: now, updatedAt: now };
}

export function getCel(doc: Doc, frame: number, layerId: string): Cel | undefined {
  return doc.frames[frame]?.cels[layerId];
}

export function withCel(doc: Doc, frame: number, layerId: string, cel: Cel): Doc {
  const frames = doc.frames.slice();
  frames[frame] = { ...frames[frame], cels: { ...frames[frame].cels, [layerId]: cel } };
  return { ...doc, frames };
}
