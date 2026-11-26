import { useState } from 'react';
import { Modal } from './Modal';
import { checkerOver } from './colorUtils';
import { uid, type Palette } from './model';
import { t, useT } from './i18n';

type Choice = 'skip' | 'keep';

type Props = {
  palettes: Palette[];
  existingIds: ReadonlySet<string>;
  skipped: number;
  onRestore: (palettes: Palette[]) => Promise<boolean>;
  onClose: () => void;
};

const countLabel = (n: number) => (n === 1 ? t('1 color') : t('{n} colors', { n }));

export function RestoreDialog({ palettes, existingIds, skipped, onRestore, onClose }: Props) {
  const [choices, setChoices] = useState<Choice[]>(() => palettes.map((p) => (existingIds.has(p.id) ? 'skip' : 'keep')));
  const [saving, setSaving] = useState(false);
  const t = useT();

  const included = (p: Palette, i: number) => !(existingIds.has(p.id) && choices[i] === 'skip');
  const count = palettes.filter(included).length;

  const submit = async () => {
    if (!count || saving) return;
    setSaving(true);
    const chosen = palettes.flatMap((p, i) => {
      if (!included(p, i)) return [];
      return [existingIds.has(p.id) ? { ...p, id: uid() } : p];
    });
    const ok = await onRestore(chosen);
    if (!ok) setSaving(false);
  };

  return (
    <Modal title={t('Restore palettes')} subtitle={t('Check the backup before restoring. Existing palettes are never overwritten.')} className="pi-dialog" onClose={onClose}>
      <div className="pi-list">
        {palettes.map((p, i) => {
          const conflict = existingIds.has(p.id);
          return (
            <div key={`${p.id}-${i}`} className="pi-item">
              <div className="pi-row">
                <strong className="pi-name">{p.name}</strong>
                <span className="pi-count">{countLabel(p.colors.length)}</span>
              </div>
              <div className="pi-swatches">
                {p.colors.map((c, j) => (
                  <i key={j} title={c} style={{ backgroundImage: checkerOver(c) }} />
                ))}
              </div>
              {conflict && (
                <div className="pi-row">
                  <p className="pi-warning">{t('Already in your library.')}</p>
                  <select
                    className="text-input"
                    aria-label={t('Action for {name}', { name: p.name })}
                    value={choices[i]}
                    onChange={(e) => setChoices((list) => list.map((c, k) => (k === i ? (e.target.value as Choice) : c)))}
                  >
                    <option value="skip">{t('Skip')}</option>
                    <option value="keep">{t('Keep both')}</option>
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {skipped > 0 && <p className="pi-warning">{skipped > 1 ? t('Ignored {n} invalid entries.', { n: skipped }) : t('Ignored 1 invalid entry.')}</p>}
      <div className="dialog-actions">
        <button className="ghost-button" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button className="primary-button" data-autofocus disabled={!count || saving} onClick={submit}>
          {count === 1 ? t('Restore 1 palette') : t('Restore {n} palettes', { n: count })}
        </button>
      </div>
    </Modal>
  );
}
