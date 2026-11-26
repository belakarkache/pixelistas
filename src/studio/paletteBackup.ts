import { download } from './exporter';
import { normalizeHex } from './paletteFormats';
import type { Palette, PaletteSource } from './model';
import { t } from './i18n';

const BACKUP_VERSION = 1;
const SOURCES: PaletteSource[] = ['custom', 'imported', 'image'];
const NAME_MAX = 60;

export function downloadBackup(palettes: Palette[]) {
  const date = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify({ version: BACKUP_VERSION, palettes }, null, 2);
  download(new Blob([json], { type: 'application/json' }), `pixelistas-palettes-${date}.json`);
}

export function parseBackup(text: string): { palettes: Palette[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t('Invalid backup file.'));
  }
  const root = data as { version?: unknown; palettes?: unknown } | null;
  if (!root || typeof root !== 'object' || !Array.isArray(root.palettes)) throw new Error(t('This is not a palette backup.'));
  if (root.version !== BACKUP_VERSION) throw new Error(t('Unsupported backup version.'));
  const palettes: Palette[] = [];
  let skipped = 0;
  for (const item of root.palettes) {
    const palette = toPalette(item);
    if (palette) palettes.push(palette);
    else skipped++;
  }
  if (!palettes.length) throw new Error(t('No valid palettes in this backup.'));
  return { palettes, skipped };
}

function toPalette(item: unknown): Palette | null {
  if (!item || typeof item !== 'object') return null;
  const p = item as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !Array.isArray(p.colors)) return null;
  const now = Date.now();
  const colors = p.colors.flatMap((c: unknown) => {
    const hex = typeof c === 'string' ? normalizeHex(c) : null;
    return hex ? [hex] : [];
  });
  const source = SOURCES.includes(p.source as PaletteSource) ? (p.source as PaletteSource) : 'custom';
  const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : now);
  return {
    id: p.id,
    name: p.name.trim().slice(0, NAME_MAX) || t('Untitled palette'),
    colors,
    source,
    createdAt: time(p.createdAt),
    updatedAt: time(p.updatedAt),
  };
}
