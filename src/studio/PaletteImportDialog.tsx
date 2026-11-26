import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { checkerOver } from './colorUtils';
import { parsePaletteFile, TooManyColorsError } from './paletteFormats';
import { useT } from './i18n';

export type ImportEntry = { name: string; colors: string[] };

type Props = {
  files: File[];
  onImport: (entries: ImportEntry[]) => Promise<boolean>;
  onExtract: (file: File) => void;
  onClose: () => void;
};

type Item = {
  key: number;
  file: File;
  status: 'loading' | 'ok' | 'error' | 'tooMany';
  name: string;
  colors: string[];
  warnings: string[];
  error?: string;
  dedupe: boolean;
};

const unique = (colors: string[]) => [...new Set(colors)];
const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

export function PaletteImportDialog({ files, onImport, onExtract, onClose }: Props) {
  const [items, setItems] = useState<Item[]>(() =>
    files.map((file, key) => ({ key, file, status: 'loading', name: stripExt(file.name), colors: [], warnings: [], dedupe: true })),
  );
  const [saving, setSaving] = useState(false);
  const t = useT();

  useEffect(() => {
    let alive = true;
    files.forEach((file, key) => {
      parsePaletteFile(file)
        .then((parsed) => alive && patch(key, { status: 'ok', name: parsed.name, colors: parsed.colors, warnings: parsed.warnings }))
        .catch((e) => {
          if (!alive) return;
          if (e instanceof TooManyColorsError) patch(key, { status: 'tooMany', error: e.message });
          else patch(key, { status: 'error', error: e instanceof Error ? e.message : t('Could not read this file.') });
        });
    });
    return () => {
      alive = false;
    };
  }, [files]);

  const patch = (key: number, next: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...next } : it)));

  const ready = useMemo(() => items.filter((it) => it.status === 'ok' && it.name.trim()), [items]);
  const pending = items.some((it) => it.status === 'loading');

  const submit = async () => {
    if (!ready.length || saving) return;
    setSaving(true);
    const ok = await onImport(ready.map((it) => ({ name: it.name.trim(), colors: it.dedupe ? unique(it.colors) : it.colors })));
    if (!ok) setSaving(false);
  };

  return (
    <Modal title={t('Import palettes')} subtitle={t('Check each file before saving. Files with errors are skipped.')} className="pi-dialog" onClose={onClose}>
      <div className="pi-list">
        {items.map((it) => {
          const shown = it.dedupe ? unique(it.colors) : it.colors;
          const dupes = it.colors.length - unique(it.colors).length;
          return (
            <div key={it.key} className={`pi-item ${it.status === 'error' || it.status === 'tooMany' ? 'failed' : ''}`}>
              <div className="pi-file">
                <Icon name="image" size={13} /> <span>{it.file.name}</span>
              </div>
              {it.status === 'loading' && <p className="pm-note">{t('Reading…')}</p>}
              {(it.status === 'error' || it.status === 'tooMany') && (
                <>
                  <p className="pi-error" role="alert">
                    {it.error}
                  </p>
                  {it.status === 'tooMany' && (
                    <button type="button" className="ghost-button" onClick={() => onExtract(it.file)}>
                      <Icon name="image" size={15} /> {t('Extract colors instead')}
                    </button>
                  )}
                </>
              )}
              {it.status === 'ok' && (
                <>
                  <div className="pi-row">
                    <input className="text-input" value={it.name} maxLength={60} aria-label={t('Name for {name}', { name: it.file.name })} onChange={(e) => patch(it.key, { name: e.target.value })} />
                    <span className="pi-count">
                      {shown.length === 1 ? t('1 color') : t('{n} colors', { n: shown.length })}
                    </span>
                  </div>
                  <div className="pi-swatches">
                    {shown.map((c, i) => (
                      <i key={i} title={c} style={{ backgroundImage: checkerOver(c) }} />
                    ))}
                  </div>
                  {it.warnings.map((w) => (
                    <p key={w} className="pi-warning">
                      {w}
                    </p>
                  ))}
                  <label className="pfi-check">
                    <input type="checkbox" checked={it.dedupe} onChange={(e) => patch(it.key, { dedupe: e.target.checked })} />
                    {t('Remove duplicates')}{dupes ? ` (${t('{n} found', { n: dupes })})` : ''}
                  </label>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="dialog-actions">
        <button className="ghost-button" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button className="primary-button" data-autofocus disabled={!ready.length || saving || pending} onClick={submit}>
          {ready.length === 1 ? t('Import 1 palette') : t('Import {n} palettes', { n: ready.length })}
        </button>
      </div>
    </Modal>
  );
}
