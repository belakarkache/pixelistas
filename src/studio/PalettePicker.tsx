import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { PALETTE_PRESETS, uid, type Palette } from './model';
import { paletteStrip } from './colorUtils';
import { getPalette, listPalettes, savePalette } from './storage';
import { toast } from './toast';
import { t as tStatic, useT } from './i18n';

type Props = {
  palette: string[];
  paletteId: string | null;
  projectName: string;
  reloadKey?: unknown;
  onApply: (colors: string[], id: string) => void;
  onManage: () => void;
};

type Anchor = { left: number; top: number; width: number };

const sameColors = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c, i) => c === b[i]);
const countLabel = (n: number) => (n === 1 ? tStatic('1 color') : tStatic('{n} colors', { n }));

export function PalettePicker({ palette, paletteId, projectName, reloadKey, onApply, onManage }: Props) {
  const t = useT();
  const [origin, setOrigin] = useState<Palette | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [list, setList] = useState<Palette[] | null>(null);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const [pending, setPending] = useState<Palette | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    if (!paletteId) {
      setOrigin(null);
      return;
    }
    getPalette(paletteId).then(
      (p) => alive && setOrigin(p ?? null),
      () => alive && setOrigin(null),
    );
    return () => {
      alive = false;
    };
  }, [paletteId, reloadKey]);

  const dirty = !!origin && !sameColors(origin.colors, palette);
  const canSaveChanges = dirty && origin.source !== 'preset';

  const close = () => {
    setOpen(false);
    setNaming(null);
    setQuery('');
  };

  const toggle = () => {
    if (open) return close();
    const r = trigger.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, top: r.bottom + 6, width: r.width });
    setOpen(true);
    listPalettes().then(setList, () => {
      setList([]);
      toast(t('Could not load your palettes'));
    });
  };

  useLayoutEffect(() => {
    const el = popover.current;
    if (!open || !el || !anchor) return;
    const pad = 8;
    const width = Math.min(300, window.innerWidth - pad * 2);
    el.style.width = `${width}px`;
    el.style.left = `${Math.max(pad, Math.min(anchor.left, window.innerWidth - width - pad))}px`;
    el.style.maxHeight = `${window.innerHeight - anchor.top - pad}px`;
    el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popover.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const mine = useMemo(() => (list ?? []).filter((p) => !q || p.name.toLowerCase().includes(q)), [list, q]);
  const presets = useMemo(() => PALETTE_PRESETS.filter((p) => !q || p.name.toLowerCase().includes(q)), [q]);

  const saveNew = async (name: string): Promise<Palette | null> => {
    const now = Date.now();
    try {
      const saved = await savePalette({ id: uid(), name, colors: [...palette], source: 'custom', createdAt: now, updatedAt: now });
      setOrigin(saved);
      setList((l) => (l ? [saved, ...l] : l));
      onApply([...palette], saved.id);
      toast(t('Saved “{name}”', { name: saved.name }));
      return saved;
    } catch {
      toast(t('Could not save the palette'));
      return null;
    }
  };

  const saveChanges = async (): Promise<boolean> => {
    if (!origin) return false;
    try {
      const saved = await savePalette({ ...origin, colors: [...palette] });
      setOrigin(saved);
      setList((l) => l?.map((p) => (p.id === saved.id ? saved : p)) ?? l);
      toast(t('Saved changes to “{name}”', { name: saved.name }));
      return true;
    } catch {
      toast(t('Could not save the palette'));
      return false;
    }
  };

  const defaultName = t('{name} palette', { name: projectName.trim() || t('Untitled') });

  const choose = (p: Palette) => {
    if (p.id === paletteId && !dirty) return close();
    close();
    if (dirty) setPending(p);
    else onApply([...p.colors], p.id);
  };

  const resolvePending = async (mode: 'save' | 'discard') => {
    const target = pending;
    if (!target) return;
    if (mode === 'save') {
      const ok = canSaveChanges ? await saveChanges() : !!(await saveNew(defaultName));
      if (!ok) return;
    }
    setPending(null);
    onApply([...target.colors], target.id);
  };

  const label = origin?.name ?? t('Project palette');

  const row = (p: Palette) => (
    <button key={p.id} className={`pp-item ${p.id === paletteId ? 'active' : ''}`} onClick={() => choose(p)}>
      <span className="pp-item-name">{p.name}</span>
      <span className="pp-item-count">{countLabel(p.colors.length)}</span>
      <span className={`pm-strip ${p.colors.length ? '' : 'empty'}`} style={{ background: p.colors.length ? paletteStrip(p.colors) : undefined }} />
    </button>
  );

  return (
    <>
      <button ref={trigger} className="pp-trigger" aria-haspopup="dialog" aria-expanded={open} title={t('Choose palette')} onClick={toggle}>
        <span className="pp-label">{label}</span>
        {dirty && <i className="pp-dirty" title={t('Unsaved changes')} aria-label={t('Unsaved changes')} />}
        <Icon name="down" size={12} />
      </button>
      {open &&
        anchor &&
        createPortal(
          <div ref={popover} className="palette-popover is-open" style={{ top: anchor.top }} role="dialog" aria-label={t('Palettes')}>
            <label className="pm-search">
              <Icon name="search" size={14} />
              <input className="text-input" placeholder={t('Search palettes')} value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
            </label>
            <div className="pp-list">
              {list === null && <p className="pm-note">{t('Loading…')}</p>}
              {mine.map(row)}
              {presets.length > 0 && <div className="pm-group-label">{t('Presets')}</div>}
              {presets.map(row)}
              {list !== null && !mine.length && !presets.length && <p className="pm-note">{t('No palettes found.')}</p>}
            </div>
            <div className="pp-footer">
              {naming === null ? (
                <>
                  <button className="pp-action" onClick={() => setNaming(defaultName)}>
                    <Icon name="plus" size={14} />
                    {t('Save as new palette')}
                  </button>
                  {canSaveChanges && (
                    <button
                      className="pp-action"
                      onClick={async () => {
                        if (await saveChanges()) close();
                      }}
                    >
                      <Icon name="check" size={14} />
                      {t('Save changes to “{name}”', { name: origin.name })}
                    </button>
                  )}
                  <button
                    className="pp-action"
                    onClick={() => {
                      close();
                      onManage();
                    }}
                  >
                    <Icon name="palette" size={14} />
                    {t('Manage palettes…')}
                  </button>
                </>
              ) : (
                <form
                  className="pp-name-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const name = naming.trim();
                    if (name && (await saveNew(name))) close();
                  }}
                >
                  <input
                    className="text-input"
                    autoFocus
                    value={naming}
                    maxLength={60}
                    aria-label={t('Palette name')}
                    onChange={(e) => setNaming(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="submit" className="primary-button" disabled={!naming.trim()}>
                    {t('Save')}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setNaming(null)}>
                    {t('Cancel')}
                  </button>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}
      {pending &&
        createPortal(
          <Modal title={t('Unsaved palette changes')} onClose={() => setPending(null)}>
            <p className="dialog-text">
              {t('“{label}” has changes you haven’t saved. Switching to “{name}” will replace the project palette.', { label, name: pending.name })}
            </p>
            <div className="dialog-actions">
              <button className="ghost-button" onClick={() => setPending(null)}>
                {t('Cancel')}
              </button>
              <button className="ghost-button" onClick={() => resolvePending('discard')}>
                {t('Discard')}
              </button>
              <button className="primary-button" data-autofocus onClick={() => resolvePending('save')}>
                {canSaveChanges ? t('Save') : t('Save as new')}
              </button>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
