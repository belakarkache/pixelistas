import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { checkerOver } from './colorUtils';
import { uid, type Doc, type Palette, type Reference } from './model';
import { extractPalette, imageDataFromFile, imageDataFromFrame, imageDataFromReference, type ExtractMode, type ExtractSort } from './paletteExtract';
import { toast } from './toast';
import { msg, useT } from './i18n';

type Source = 'upload' | 'frame' | 'reference';

type Props = {
  doc: Doc;
  frame: number;
  reference: Reference | null;
  projectName: string;
  initialFile?: File | null;
  onSave: (palette: Palette, useNow: boolean) => Promise<boolean>;
  onClose: () => void;
};

const DEBOUNCE = 160;
const EXACT_SUGGEST_LIMIT = 64;
const SORTS: { id: ExtractSort; label: string }[] = [
  { id: 'frequency', label: msg('Frequency') },
  { id: 'hue', label: msg('Hue') },
  { id: 'lightness', label: msg('Lightness') },
];

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

export function PaletteFromImage({ doc, frame, reference, projectName, initialFile, onSave, onClose }: Props) {
  const t = useT();
  const [source, setSource] = useState<Source>('upload');
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [image, setImage] = useState<ImageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [maxColors, setMaxColors] = useState(16);
  const [mode, setMode] = useState<ExtractMode>('quantize');
  const [ignoreTransparent, setIgnoreTransparent] = useState(true);
  const [sort, setSort] = useState<ExtractSort>('frequency');
  const [colors, setColors] = useState<string[]>([]);
  const [counts, setCounts] = useState<number[]>([]);
  const [fallback, setFallback] = useState(false);
  const [working, setWorking] = useState(false);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const suggested = useRef(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    suggested.current = false;
    setDisabled(new Set());
    setColors([]);
    setCounts([]);
    if (source === 'upload') {
      if (!file) {
        setImage(null);
        return;
      }
    }
    let alive = true;
    setLoading(true);
    const load = source === 'upload' ? imageDataFromFile(file!) : source === 'frame' ? Promise.resolve(imageDataFromFrame(doc, frame)) : imageDataFromReference(reference!);
    load
      .then((data) => alive && setImage(data))
      .catch(() => {
        if (!alive) return;
        setImage(null);
        toast(t('Could not read that image'));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, file, doc, frame, reference]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.putImageData(image, 0, 0);
  }, [image]);

  useEffect(() => {
    if (!image) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setWorking(true);
      extractPalette(image, { maxColors, mode, ignoreTransparent, sort }, controller.signal)
        .then((result) => {
          if (!suggested.current) {
            suggested.current = true;
            if (result.uniqueCount <= EXACT_SUGGEST_LIMIT && result.uniqueCount >= 2) {
              setMode('exact');
              setMaxColors(result.uniqueCount);
            }
          }
          setColors(result.colors);
          setCounts(result.counts);
          setFallback(result.fallback);
          setDisabled((prev) => new Set([...prev].filter((c) => result.colors.includes(c))));
          setWorking(false);
        })
        .catch((e) => {
          if (e?.name !== 'AbortError') {
            setWorking(false);
            toast(t('Could not extract colors'));
          }
        });
    }, DEBOUNCE);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [image, maxColors, mode, ignoreTransparent, sort]);

  const total = useMemo(() => counts.reduce((a, b) => a + b, 0) || 1, [counts]);
  const kept = useMemo(() => colors.filter((c) => !disabled.has(c)), [colors, disabled]);
  const defaultName = source === 'upload' && file ? stripExt(file.name) : projectName;

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast(t('That file is not an image'));
    setFile(f);
    setSource('upload');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };

  const toggle = (c: string) =>
    setDisabled((prev) => {
      const next = new Set(prev);
      if (!next.delete(c)) next.add(c);
      return next;
    });

  const save = async (useNow: boolean) => {
    if (!kept.length || saving) return;
    setSaving(true);
    const now = Date.now();
    const ok = await onSave({ id: uid(), name: name.trim() || defaultName.trim() || t('Image palette'), colors: kept, source: 'image', createdAt: now, updatedAt: now }, useNow);
    if (!ok) setSaving(false);
  };

  const hasImage = !!image;

  return (
    <Modal title={t('Extract from image')} subtitle={t('Build a palette from an image, your current frame or the reference.')} className="pfi-dialog" onClose={onClose}>
      <div className="pfi-sources" role="tablist" aria-label={t('Image source')}>
        <button type="button" role="tab" aria-selected={source === 'upload'} className={`chip-button ${source === 'upload' ? 'active' : ''}`} onClick={() => setSource('upload')}>
          <Icon name="upload" size={14} /> {t('Upload image')}
        </button>
        <button type="button" role="tab" aria-selected={source === 'frame'} className={`chip-button ${source === 'frame' ? 'active' : ''}`} onClick={() => setSource('frame')}>
          <Icon name="image" size={14} /> {t('Current frame')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={source === 'reference'}
          className={`chip-button ${source === 'reference' ? 'active' : ''}`}
          disabled={!reference}
          title={reference ? undefined : t('This project has no reference image')}
          onClick={() => setSource('reference')}
        >
          <Icon name="image" size={14} /> {t('Reference image')}
        </button>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { pick(e.target.files); e.target.value = ''; }} />
      </div>

      <div className="pfi-body">
        <div className="pfi-preview">
          {hasImage ? (
            <canvas ref={previewRef} className="pfi-canvas" />
          ) : source === 'upload' ? (
            <button
              type="button"
              className={`pfi-drop ${dragging ? 'dragging' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <Icon name="upload" size={24} />
              <b>{loading ? t('Reading…') : t('Drop an image here')}</b>
              <span>{t('or click to choose a file')}</span>
            </button>
          ) : (
            <p className="pm-note">{loading ? t('Reading…') : t('Nothing to read.')}</p>
          )}
          {hasImage && source === 'upload' && (
            <button type="button" className="ghost-button pfi-change" onClick={() => inputRef.current?.click()}>
              {t('Change image')}
            </button>
          )}
        </div>

        <div className="pfi-side">
          <div className="pfi-controls">
            <label className="range-row">
              <span>{t('Colors')}</span>
              <input type="range" min={2} max={256} value={maxColors} onChange={(e) => setMaxColors(Number(e.target.value))} aria-label={t('Number of colors')} />
              <b>{maxColors}</b>
            </label>
            <div className="pfi-row">
              <div className="segmented small" role="group" aria-label={t('Mode')}>
                <button type="button" className={mode === 'exact' ? 'active' : ''} onClick={() => setMode('exact')}>
                  {t('Exact colors')}
                </button>
                <button type="button" className={mode === 'quantize' ? 'active' : ''} onClick={() => setMode('quantize')}>
                  {t('Reduce')}
                </button>
              </div>
              <div className="segmented small" role="group" aria-label={t('Sort')}>
                {SORTS.map((s) => (
                  <button key={s.id} type="button" className={sort === s.id ? 'active' : ''} onClick={() => setSort(s.id)}>
                    {t(s.label)}
                  </button>
                ))}
              </div>
            </div>
            <label className="pfi-check">
              <input type="checkbox" checked={ignoreTransparent} onChange={(e) => setIgnoreTransparent(e.target.checked)} />
              {t('Ignore transparent')}
            </label>
            {fallback && <p className="pm-note">{t('This image has more colors than the limit, so they were reduced. Raise “Colors” to keep them exact.')}</p>}
          </div>

          <div className="pfi-result-head">
            <span>
              {colors.length === 1 ? t('{kept} of 1 color', { kept: kept.length }) : t('{kept} of {n} colors', { kept: kept.length, n: colors.length })}
            </span>
            {working && <span className="pfi-spinner" role="status" aria-label={t('Calculating')} />}
          </div>
          <div className="pm-grid pfi-grid">
            {colors.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`pfi-swatch ${disabled.has(c) ? 'off' : ''}`}
                style={{ backgroundImage: checkerOver(c) }}
                aria-pressed={!disabled.has(c)}
                aria-label={`${c}, ${((counts[i] / total) * 100).toFixed(1)}%`}
                title={`${c} · ${((counts[i] / total) * 100).toFixed(1)}%${disabled.has(c) ? ` · ${t('excluded')}` : ''}`}
                onClick={() => toggle(c)}
              />
            ))}
          </div>

          <div className="pfi-save">
            <input className="text-input" value={name} maxLength={60} placeholder={defaultName || t('Palette name')} aria-label={t('Palette name')} onChange={(e) => setName(e.target.value)} />
            <button className="ghost-button" disabled={!kept.length || saving} onClick={() => save(false)}>
              {t('Save palette')}
            </button>
            <button className="primary-button" disabled={!kept.length || saving} onClick={() => save(true)}>
              <Icon name="check" size={15} /> {t('Save & use in project')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
