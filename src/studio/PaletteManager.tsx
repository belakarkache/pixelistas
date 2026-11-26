import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { t as tStatic, useT } from './i18n';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { ColorPicker } from './ColorPicker';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { PaletteFromImage } from './PaletteFromImage';
import { PaletteImportDialog, type ImportEntry } from './PaletteImportDialog';
import { RestoreDialog } from './RestoreDialog';
import { downloadBackup, parseBackup } from './paletteBackup';
import { PALETTE_PRESETS, uid, type Doc, type Palette, type Reference } from './model';
import { checkerOver, paletteStrip } from './colorUtils';
import { dedupe, moveItems, parseHexText, ramp, sortColors } from './paletteOps';
import { useHistory } from './useHistory';
import { deletePalette, duplicatePalette, listPalettes, savePalette } from './storage';
import { downloadPalette, PALETTE_ACCEPT } from './paletteFormats';
import { toast } from './toast';

type PaletteUseMode = 'replace' | 'add';

type Props = {
  primary: string;
  projectPalette: string[];
  activeId?: string | null;
  doc: Doc;
  frame: number;
  reference: Reference | null;
  projectName: string;
  initialFiles?: File[] | null;
  onUse: (palette: Palette, mode: PaletteUseMode) => void;
  onClose: () => void;
};

type SaveState = 'saved' | 'saving' | 'error';
type Confirm = { kind: 'delete' | 'use'; palette: Palette } | null;

const SAVE_DELAY = 400;
const isPreset = (p: Palette) => p.source === 'preset';
const countLabel = (n: number) => (n === 1 ? tStatic('1 color') : tStatic('{n} colors', { n }));
const sameColors = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

export function PaletteManager({ primary, projectPalette, activeId, doc, frame, reference, projectName, initialFiles, onUse, onClose }: Props) {
  const t = useT();
  const [palettes, setPalettes] = useState<Palette[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractFile, setExtractFile] = useState<File | null>(null);
  const [importFiles, setImportFiles] = useState<File[] | null>(initialFiles?.length ? initialFiles : null);
  const [restore, setRestore] = useState<{ palettes: Palette[]; skipped: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const pending = useRef(new Map<string, Palette>());
  const timer = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const menu = useContextMenu();
  const importItems: MenuItem[] = [
    { label: t('Palette file…'), icon: 'upload', onSelect: () => fileInput.current?.click() },
    { label: t('From image…'), icon: 'image', onSelect: () => setExtracting(true) },
  ];

  useEffect(() => {
    let alive = true;
    listPalettes()
      .then((list) => {
        if (!alive) return;
        setPalettes(list);
        const known = activeId && (list.some((p) => p.id === activeId) || PALETTE_PRESETS.some((p) => p.id === activeId));
        setSelectedId(known ? activeId : (list[0]?.id ?? null));
      })
      .catch(() => {
        if (!alive) return;
        setPalettes([]);
        toast(t('Could not load your palettes'));
      });
    return () => {
      alive = false;
    };
  }, [activeId]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const items = [...pending.current.values()];
    pending.current.clear();
    if (!items.length) return;
    try {
      await Promise.all(items.map(savePalette));
      if (!pending.current.size) setSaveState('saved');
    } catch {
      for (const p of items) if (!pending.current.has(p.id)) pending.current.set(p.id, p);
      setSaveState('error');
    }
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const update = (palette: Palette, patch: Partial<Pick<Palette, 'name' | 'colors'>>) => {
    const next = { ...palette, ...patch, updatedAt: Date.now() };
    pending.current.set(next.id, next);
    setPalettes((list) => list?.map((p) => (p.id === next.id ? next : p)) ?? list);
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  const q = query.trim().toLowerCase();
  const mine = useMemo(() => (palettes ?? []).filter((p) => !q || p.name.toLowerCase().includes(q)), [palettes, q]);
  const presets = useMemo(() => PALETTE_PRESETS.filter((p) => !q || p.name.toLowerCase().includes(q)), [q]);
  const selected = palettes?.find((p) => p.id === selectedId) ?? PALETTE_PRESETS.find((p) => p.id === selectedId) ?? null;
  const visible = [...mine, ...presets];
  const tabbableId = visible.some((p) => p.id === selectedId) ? selectedId : visible[0]?.id;

  const insert = (palette: Palette) => {
    setPalettes((list) => [palette, ...(list ?? [])]);
    setQuery('');
    setSelectedId(palette.id);
  };

  const create = async () => {
    const now = Date.now();
    try {
      insert(await savePalette({ id: uid(), name: t('New palette'), colors: [], source: 'custom', createdAt: now, updatedAt: now }));
      requestAnimationFrame(() => nameRef.current?.select());
    } catch {
      toast(t('Could not create the palette'));
    }
  };

  const duplicate = async (palette: Palette) => {
    try {
      await flush();
      const copy = await duplicatePalette(palette.id);
      if (copy) insert(copy);
    } catch {
      toast(t('Could not duplicate the palette'));
    }
  };

  const remove = async (palette: Palette) => {
    pending.current.delete(palette.id);
    try {
      await deletePalette(palette.id);
    } catch {
      toast(t('Could not delete the palette'));
      return;
    }
    const list = palettes ?? [];
    const i = list.findIndex((p) => p.id === palette.id);
    const rest = list.filter((p) => p.id !== palette.id);
    setPalettes(rest);
    setSelectedId(rest[Math.min(i, rest.length - 1)]?.id ?? null);
    toast(t('Deleted “{name}”', { name: palette.name }));
  };

  const use = (palette: Palette, mode: PaletteUseMode) => {
    onUse(palette, mode);
    onClose();
  };

  const importEntries = async (entries: ImportEntry[]) => {
    const taken = new Set((palettes ?? []).map((p) => p.name.trim().toLowerCase()));
    const saved: Palette[] = [];
    try {
      for (const entry of entries) {
        let name = entry.name;
        for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${entry.name} (${n})`;
        taken.add(name.toLowerCase());
        const now = Date.now();
        saved.push(await savePalette({ id: uid(), name, colors: entry.colors, source: 'imported', createdAt: now, updatedAt: now }));
      }
    } catch {
      toast(t('Could not save the palettes'));
      if (saved.length) setPalettes((list) => [...saved.reverse(), ...(list ?? [])]);
      return false;
    }
    setPalettes((list) => [...saved, ...(list ?? [])]);
    setQuery('');
    setSelectedId(saved[0].id);
    setImportFiles(null);
    toast(saved.length === 1 ? t('Imported 1 palette') : t('Imported {n} palettes', { n: saved.length }));
    return true;
  };

  const backupAll = async () => {
    try {
      await flush();
      const all = await listPalettes();
      if (!all.length) return toast(t('No palettes to back up'));
      downloadBackup(all);
    } catch {
      toast(t('Could not back up the palettes'));
    }
  };

  const readBackup = async (file: File) => {
    try {
      setRestore(parseBackup(await file.text()));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('Could not read this backup'));
    }
  };

  const restoreEntries = async (chosen: Palette[]) => {
    const saved: Palette[] = [];
    try {
      for (const palette of chosen) saved.push(await savePalette(palette));
    } catch {
      toast(t('Could not restore the palettes'));
      if (saved.length) setPalettes((list) => [...saved, ...(list ?? [])]);
      return false;
    }
    setPalettes((list) => [...saved, ...(list ?? [])]);
    setQuery('');
    setSelectedId(saved[0]?.id ?? null);
    setRestore(null);
    toast(saved.length === 1 ? t('Restored 1 palette') : t('Restored {n} palettes', { n: saved.length }));
    return true;
  };

  const backupItems: MenuItem[] = [
    { label: t('Back up all palettes'), icon: 'download', onSelect: backupAll },
    { label: t('Restore from backup…'), icon: 'upload', onSelect: () => restoreInput.current?.click() },
  ];

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  const requestUse = (palette: Palette) => {
    if (!palette.colors.length) return toast(t('This palette has no colors yet'));
    if (projectPalette.length && !sameColors(projectPalette, palette.colors)) setConfirm({ kind: 'use', palette });
    else use(palette, 'replace');
  };

  const openExport = (e: MouseEvent, palette: Palette) =>
    menu.open(e, [
      { label: t('GIMP (.gpl)'), icon: 'download', onSelect: () => downloadPalette(palette, 'gpl') },
      { label: t('Lospec / Hex (.hex)'), icon: 'download', onSelect: () => downloadPalette(palette, 'hex') },
      { label: t('JASC (.pal)'), icon: 'download', onSelect: () => downloadPalette(palette, 'pal') },
      { separator: true },
      { label: t('PNG strip (1px)'), icon: 'image', onSelect: () => downloadPalette(palette, 'png') },
      { label: t('PNG strip (8px)'), icon: 'image', onSelect: () => downloadPalette(palette, 'png', 8) },
    ]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.pm-item') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    items[next].focus();
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    listRef.current?.querySelector<HTMLButtonElement>('.pm-item')?.focus();
  };

  return (
    <>
      <Modal title={t('Palettes')} subtitle={t('Your color library, saved on this device.')} className="pm-dialog" onClose={onClose}>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={PALETTE_ACCEPT}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) setImportFiles(files);
          }}
        />
        <input
          ref={restoreInput}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) readBackup(file);
          }}
        />
        <div
          className="pm-layout"
          onDragOver={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
          onDrop={(e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            setDragging(false);
            const files = [...e.dataTransfer.files];
            if (files.length) setImportFiles(files);
          }}
        >
          {dragging && (
            <div className="pm-drop" aria-hidden="true">
              <Icon name="upload" size={22} /> {t('Drop palette files')}
            </div>
          )}
          <div className="pm-side">
            <label className="pm-search">
              <Icon name="search" size={15} />
              <input className="text-input" type="search" placeholder={t('Search palettes')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} aria-label={t('Search palettes')} />
            </label>
            <div className="pm-side-actions">
              <button className="ghost-button" onClick={create}>
                <Icon name="plus" size={15} /> {t('New palette')}
              </button>
              <button className="ghost-button" aria-haspopup="menu" onClick={(e) => menu.open(e, importItems)}>
                <Icon name="upload" size={15} /> {t('Import')}
              </button>
            </div>
            <div ref={listRef} className="pm-list" role="listbox" aria-label={t('Palettes')} onKeyDown={onListKey}>
              {palettes === null ? (
                <p className="pm-note">{t('Loading…')}</p>
              ) : (
                <>
                  {mine.map((p) => (
                    <PaletteRow key={p.id} palette={p} selected={p.id === selectedId} tabbable={p.id === tabbableId} onSelect={setSelectedId} />
                  ))}
                  {!mine.length && <p className="pm-note">{q ? t('No saved palettes match “{query}”.', { query: query.trim() }) : t('No palettes yet.')}</p>}
                  {presets.length > 0 && (
                    <div className="pm-group-label">
                      <Icon name="lock" size={12} /> {t('Presets')}
                    </div>
                  )}
                  {presets.map((p) => (
                    <PaletteRow key={p.id} palette={p} selected={p.id === selectedId} tabbable={p.id === tabbableId} onSelect={setSelectedId} />
                  ))}
                </>
              )}
            </div>
            <div className="pm-side-foot">
              <button className="icon-button" title={t('Backup options')} aria-label={t('Backup options')} aria-haspopup="menu" onClick={(e) => menu.open(e, backupItems)}>
                <Icon name="more" size={17} />
              </button>
            </div>
          </div>

          <div className="pm-detail">
            {selected ? (
              <PaletteDetail
                key={selected.id}
                palette={selected}
                primary={primary}
                saveState={saveState}
                nameRef={nameRef}
                onChange={(patch) => update(selected, patch)}
                onUse={() => requestUse(selected)}
                onDuplicate={() => duplicate(selected)}
                onExport={(e) => openExport(e, selected)}
                onDelete={() => setConfirm({ kind: 'delete', palette: selected })}
              />
            ) : (
              palettes !== null && (
                <div className="pm-empty">
                  <span className="pm-empty-icon">
                    <Icon name="palette" size={26} />
                  </span>
                  <h3>{t('No palettes yet')}</h3>
                  <p>{t('Save the colors you love and reuse them in any project. Or pick a preset on the left.')}</p>
                  <div className="pm-empty-actions">
                    <button className="primary-button" onClick={create}>
                      <Icon name="plus" size={15} /> {t('New palette')}
                    </button>
                    <button className="ghost-button" onClick={() => fileInput.current?.click()}>
                      <Icon name="upload" size={15} /> {t('Import file')}
                    </button>
                    <button className="ghost-button" onClick={() => setExtracting(true)}>
                      <Icon name="image" size={15} /> {t('From image')}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </Modal>
      {menu.element}
      {importFiles && (
        <PaletteImportDialog
          files={importFiles}
          onImport={importEntries}
          onExtract={(file) => {
            setExtractFile(file);
            setImportFiles(null);
            setExtracting(true);
          }}
          onClose={() => setImportFiles(null)}
        />
      )}
      {restore && (
        <RestoreDialog
          palettes={restore.palettes}
          skipped={restore.skipped}
          existingIds={new Set((palettes ?? []).map((p) => p.id))}
          onRestore={restoreEntries}
          onClose={() => setRestore(null)}
        />
      )}
      {extracting && (
        <PaletteFromImage
          initialFile={extractFile}
          doc={doc}
          frame={frame}
          reference={reference}
          projectName={projectName}
          onClose={() => {
            setExtracting(false);
            setExtractFile(null);
          }}
          onSave={async (palette, useNow) => {
            try {
              const saved = await savePalette(palette);
              insert(saved);
              setExtracting(false);
              setExtractFile(null);
              if (useNow) requestUse(saved);
              else toast(t('Saved “{name}”', { name: saved.name }));
              return true;
            } catch {
              toast(t('Could not save the palette'));
              return false;
            }
          }}
        />
      )}
      {confirm?.kind === 'delete' && (
        <Modal title={t('Delete “{name}”?', { name: confirm.palette.name })} onClose={() => setConfirm(null)}>
          <p className="dialog-text">{t('This removes the palette from your library. Projects that already use its colors keep them.')}</p>
          <div className="dialog-actions">
            <button className="ghost-button" onClick={() => setConfirm(null)}>
              {t('Cancel')}
            </button>
            <button
              className="danger-button"
              data-autofocus
              onClick={() => {
                setConfirm(null);
                remove(confirm.palette);
              }}
            >
              {t('Delete')}
            </button>
          </div>
        </Modal>
      )}
      {confirm?.kind === 'use' && (
        <Modal title={t('Use “{name}”?', { name: confirm.palette.name })} onClose={() => setConfirm(null)}>
          <p className="dialog-text">
            {t('This project already has {count}. Replace them, or add the new colors to the current palette?', { count: countLabel(projectPalette.length) })}
          </p>
          <div className="dialog-actions">
            <button className="ghost-button" onClick={() => setConfirm(null)}>
              {t('Cancel')}
            </button>
            <button className="ghost-button" onClick={() => use(confirm.palette, 'add')}>
              {t('Add to current')}
            </button>
            <button className="primary-button" data-autofocus onClick={() => use(confirm.palette, 'replace')}>
              {t('Replace')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

const PaletteRow = memo(function PaletteRow({
  palette,
  selected,
  tabbable,
  onSelect,
}: {
  palette: Palette;
  selected: boolean;
  tabbable: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const strip = useMemo(() => paletteStrip(palette.colors), [palette.colors]);
  return (
    <button type="button" role="option" aria-selected={selected} tabIndex={tabbable ? 0 : -1} className={`pm-item ${selected ? 'selected' : ''}`} onClick={() => onSelect(palette.id)}>
      <span className="pm-item-name">{palette.name.trim() || t('Untitled palette')}</span>
      <span className="pm-item-count">{palette.colors.length}</span>
      <span className={`pm-strip ${palette.colors.length ? '' : 'empty'}`} style={palette.colors.length ? { backgroundImage: strip } : undefined} />
    </button>
  );
});

const RAMP_STEPS = [1, 2, 3, 4, 5, 6, 8, 10];
const EMPTY: ReadonlySet<number> = new Set();
const isTextField = (t: EventTarget) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

type DragState = { pointerId: number; from: number; x: number; y: number; active: boolean };

function PaletteDetail({
  palette,
  primary,
  saveState,
  nameRef,
  onChange,
  onUse,
  onDuplicate,
  onExport,
  onDelete,
}: {
  palette: Palette;
  primary: string;
  saveState: SaveState;
  nameRef: RefObject<HTMLInputElement | null>;
  onChange: (patch: Partial<Pick<Palette, 'name' | 'colors'>>) => void;
  onUse: () => void;
  onDuplicate: () => void;
  onExport: (e: MouseEvent) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const gridRef = useRef<HTMLDivElement>(null);
  const readOnly = isPreset(palette);
  const { colors } = palette;
  const history = useHistory(palette.colors);
  const menu = useContextMenu();
  const [selection, setSelection] = useState<ReadonlySet<number>>(EMPTY);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const anchor = useRef(-1);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  const apply = (next: string[], key?: string) => {
    history.commit(next, key);
    onChange({ colors: next });
  };

  const restore = (ok: boolean) => {
    if (!ok) return;
    setSelection(EMPTY);
    onChange({ colors: history.current.current });
  };
  const undo = () => restore(history.undo());
  const redo = () => restore(history.redo());

  const setAt = (i: number, hex: string) => apply(colors.map((c, j) => (j === i ? hex : c)), `edit-${i}`);

  const removeIndices = (indices: ReadonlySet<number>, refocus: boolean) => {
    const first = Math.min(...indices);
    apply(colors.filter((_, j) => !indices.has(j)));
    setSelection(EMPTY);
    if (!refocus) return;
    requestAnimationFrame(() => {
      const chips = gridRef.current?.querySelectorAll<HTMLButtonElement>('.pm-chip');
      const target = chips?.length ? chips[Math.min(first, chips.length - 1)] : gridRef.current?.querySelector<HTMLButtonElement>('.pm-add');
      target?.focus();
    });
  };

  const duplicateSelected = () => {
    const next: string[] = [];
    const copies = new Set<number>();
    colors.forEach((c, i) => {
      next.push(c);
      if (selection.has(i)) {
        copies.add(next.length);
        next.push(c);
      }
    });
    apply(next);
    setSelection(copies);
  };

  const arrange = (fn: (list: string[]) => string[]) => {
    setSelection(EMPTY);
    apply(fn([...colors]));
  };

  const arrangeItems: MenuItem[] = [
    { label: t('Sort by hue'), onSelect: () => arrange((l) => sortColors(l, 'hue')) },
    { label: t('Sort by lightness'), onSelect: () => arrange((l) => sortColors(l, 'lightness')) },
    { label: t('Sort by saturation'), onSelect: () => arrange((l) => sortColors(l, 'saturation')) },
    { separator: true },
    { label: t('Reverse order'), onSelect: () => arrange((l) => l.reverse()) },
    { label: t('Remove duplicates'), onSelect: () => arrange(dedupe) },
  ];

  const rampItems = (): MenuItem[] => {
    const [from, to] = [...selection].sort((a, b) => a - b);
    return RAMP_STEPS.map((n) => ({
      label: n === 1 ? t('1 color between') : t('{n} colors between', { n }),
      onSelect: () => {
        const next = [...colors];
        next.splice(to, 0, ...ramp(colors[from], colors[to], n));
        apply(next);
        setSelection(EMPTY);
      },
    }));
  };

  const copyText = () => (selection.size ? colors.filter((_, i) => selection.has(i)) : colors).join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText());
      toast(t('Copied {count}', { count: countLabel(selection.size || colors.length) }));
    } catch {
      toast(t('Clipboard blocked by the browser'));
    }
  };

  const addFromText = (text: string) => {
    const parsed = parseHexText(text);
    if (!parsed.length) return toast(t('No hex colors found in the clipboard'));
    apply([...colors, ...parsed]);
    toast(t('Added {count}', { count: countLabel(parsed.length) }));
  };

  const paste = async () => {
    try {
      addFromText(await navigator.clipboard.readText());
    } catch {
      toast(t('Clipboard blocked. Press Ctrl+V over the palette instead'));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || isTextField(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && key === 'a' && colors.length) {
      e.preventDefault();
      setSelection(new Set(colors.keys()));
    }
  };

  const onCopyEvent = (e: ClipboardEvent<HTMLDivElement>) => {
    if (readOnly || isTextField(e.target) || !colors.length) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copyText());
    toast(t('Copied {count}', { count: countLabel(selection.size || colors.length) }));
  };

  const onPasteEvent = (e: ClipboardEvent<HTMLDivElement>) => {
    if (readOnly || isTextField(e.target)) return;
    e.preventDefault();
    addFromText(e.clipboardData.getData('text'));
  };

  const select = (e: MouseEvent, i: number) => {
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      setSelection(new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k)));
      return;
    }
    anchor.current = i;
    const next = new Set(selection);
    if (!next.delete(i)) next.add(i);
    setSelection(next);
  };

  const onSwatchClick = (e: MouseEvent, i: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      select(e, i);
    } else if (selection.size) setSelection(EMPTY);
  };

  const dropIndex = (e: PointerEvent, from: number) => {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const index = (el as HTMLElement).dataset?.index;
      if (index !== undefined && Number(index) !== from) return Number(index);
    }
    return null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, i: number) => {
    suppressClick.current = false;
    if (e.button !== 0 || (e.target as HTMLElement).closest('.pm-remove')) return;
    drag.current = { pointerId: e.pointerId, from: i, x: e.clientX, y: e.clientY, active: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.hypot(dx, dy) < 5) return;
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragFrom(d.from);
    }
    e.currentTarget.style.transform = `translate(${dx}px, ${dy}px)`;
    const over = dropIndex(e, d.from);
    setDragOver((prev) => (prev === over ? prev : over));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    e.currentTarget.style.transform = '';
    suppressClick.current = true;
    setDragFrom(null);
    setDragOver(null);
    const target = commit ? dropIndex(e, d.from) : null;
    if (target === null) return;
    const moved = selection.has(d.from) ? selection : new Set([d.from]);
    if (moved.has(target)) return;
    apply(moveItems(colors, moved, target));
    setSelection(EMPTY);
  };

  const onSwatchKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && (e.target as HTMLElement).classList.contains('pm-chip')) {
      e.preventDefault();
      removeIndices(selection.has(i) ? selection : new Set([i]), true);
    }
  };

  return (
    <div className="pm-editor" onKeyDown={onKeyDown} onCopy={onCopyEvent} onPaste={onPasteEvent}>
      <div className="pm-head">
        {readOnly ? (
          <h3 className="pm-name static">{palette.name}</h3>
        ) : (
          <input
            ref={nameRef}
            className="pm-name"
            value={palette.name}
            maxLength={60}
            aria-label={t('Palette name')}
            placeholder={t('Untitled palette')}
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={() => !palette.name.trim() && onChange({ name: t('Untitled palette') })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        )}
        {readOnly ? (
          <span className="pm-badge">
            <Icon name="lock" size={12} /> {t('Preset')}
          </span>
        ) : (
          <span className={`pm-save ${saveState}`}>{saveState === 'saved' ? t('Saved') : saveState === 'saving' ? t('Saving…') : t('Not saved')}</span>
        )}
      </div>
      <p className="pm-meta">
        {countLabel(colors.length)}
        {` · ${readOnly ? t('Read only. Duplicate it to make changes.') : t('Click to edit, drag to reorder, Shift/Ctrl+click to select.')}`}
      </p>

      {!readOnly && (
        <div className="pm-tools" role="toolbar" aria-label={t('Palette tools')}>
          <button type="button" className="icon-button" title={t('Undo (Ctrl+Z)')} aria-label={t('Undo')} disabled={!history.canUndo} onClick={undo}>
            <Icon name="undo" size={16} />
          </button>
          <button type="button" className="icon-button" title={t('Redo (Ctrl+Y)')} aria-label={t('Redo')} disabled={!history.canRedo} onClick={redo}>
            <Icon name="redo" size={16} />
          </button>
          <span className="pm-tools-sep" />
          <button type="button" className="ghost-button" aria-haspopup="menu" disabled={colors.length < 2} onClick={(e) => menu.open(e, arrangeItems)}>
            <Icon name="down" size={15} /> {t('Arrange')}
          </button>
          <button
            type="button"
            className="ghost-button"
            aria-haspopup="menu"
            disabled={selection.size !== 2}
            title={selection.size === 2 ? t('Add colors between the two selected') : t('Select two colors (Shift/Ctrl+click)')}
            onClick={(e) => menu.open(e, rampItems())}
          >
            <Icon name="plus" size={15} /> {t('Add ramp')}
          </button>
          <button type="button" className="ghost-button" disabled={!colors.length} onClick={copy}>
            <Icon name="copy" size={15} /> {t('Copy')}
          </button>
          <button type="button" className="ghost-button" onClick={paste}>
            <Icon name="paste" size={15} /> {t('Paste')}
          </button>
          {selection.size > 0 && (
            <>
              <span className="pm-tools-sep" />
              <span className="pm-sel-count">{t('{n} selected', { n: selection.size })}</span>
              <button type="button" className="ghost-button" onClick={duplicateSelected}>
                <Icon name="copy" size={15} /> {t('Duplicate')}
              </button>
              <button type="button" className="ghost-button" onClick={() => removeIndices(selection, true)}>
                <Icon name="trash" size={15} /> {t('Remove')}
              </button>
              <button type="button" className="icon-button" title={t('Clear selection')} aria-label={t('Clear selection')} onClick={() => setSelection(EMPTY)}>
                <Icon name="close" size={14} />
              </button>
            </>
          )}
        </div>
      )}

      <div ref={gridRef} className="pm-grid">
        {readOnly
          ? colors.map((c, i) => <span key={i} className="pm-static" style={{ backgroundImage: checkerOver(c) }} title={c} />)
          : colors.map((c, i) => (
              <div
                key={i}
                data-index={i}
                className={`pm-swatch${selection.has(i) ? ' selected' : ''}${dragFrom === i || (dragFrom !== null && selection.has(i) && selection.has(dragFrom)) ? ' dragging' : ''}${dragOver === i ? ' drop' : ''}`}
                onClickCapture={(e) => onSwatchClick(e, i)}
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endDrag(e, true)}
                onPointerCancel={(e) => endDrag(e, false)}
                onKeyDown={(e) => onSwatchKey(e, i)}
              >
                <ColorPicker className="pm-chip" label={t('Edit {color} (Delete removes)', { color: c })} value={c} onChange={(hex) => setAt(i, hex)} />
                <button type="button" className="pm-remove" tabIndex={-1} aria-label={t('Remove {color}', { color: c })} title={t('Remove')} onClick={() => removeIndices(new Set([i]), false)}>
                  <Icon name="close" size={10} />
                </button>
              </div>
            ))}
        {!readOnly && (
          <button type="button" className="pm-add" title={t('Add main color {color}', { color: primary })} aria-label={t('Add main color {color}', { color: primary })} onClick={() => apply([...colors, primary])}>
            <Icon name="plus" size={18} />
            <i style={{ backgroundImage: checkerOver(primary) }} />
          </button>
        )}
      </div>

      <div className="pm-actions">
        <button className="primary-button" onClick={onUse} disabled={!colors.length}>
          <Icon name="check" size={15} /> {t('Use in project')}
        </button>
        <button className="ghost-button" onClick={onDuplicate}>
          <Icon name="copy" size={15} /> {readOnly ? t('Duplicate to edit') : t('Duplicate')}
        </button>
        <button className="ghost-button" aria-haspopup="menu" onClick={onExport} disabled={!colors.length}>
          <Icon name="download" size={15} /> {t('Export')}
        </button>
        <div className="pm-spacer" />
        {!readOnly && (
          <button className="icon-button danger" title={t('Delete palette')} aria-label={t('Delete palette')} onClick={onDelete}>
            <Icon name="trash" size={17} />
          </button>
        )}
      </div>
      {menu.element}
    </div>
  );
}
