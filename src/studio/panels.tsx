import { memo, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { Icon } from './Icon';
import { ColorPicker } from './ColorPicker';
import { PalettePicker } from './PalettePicker';
import { useContextMenu } from './ContextMenu';
import { isHex, MAX_FRAMES, normalizeHex, type Cel, type Doc, type Frame, type Layer, type Reference } from './model';
import { composeFrame, renderCel } from './raster';
import { useT } from './i18n';

const CelThumb = memo(function CelThumb({ cel, width, height }: { cel: Cel | undefined; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderCel(ref.current, cel, width, height);
  }, [cel, width, height]);
  return <canvas ref={ref} className="thumb-canvas" style={{ aspectRatio: `${width}/${height}` }} />;
});

const FrameThumb = memo(function FrameThumb({ frame, layers, width, height }: { frame: Frame; layers: Layer[]; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) composeFrame(ref.current, { width, height, layers, frames: [frame], fps: 1 }, 0);
  }, [frame, layers, width, height]);
  return <canvas ref={ref} className="thumb-canvas" style={{ aspectRatio: `${width}/${height}` }} />;
});

type ColorProps = {
  primary: string;
  secondary: string;
  picked?: { primary: number; secondary: number };
  palette: string[];
  paletteId: string | null;
  projectName: string;
  reloadKey?: unknown;
  recent: string[];
  onPrimary: (hex: string) => void;
  onSecondary: (hex: string) => void;
  onSwap: () => void;
  onPalette: (palette: string[]) => void;
  onApplyPalette: (colors: string[], id: string) => void;
  onManagePalettes: () => void;
  onDropPaletteFiles: (files: File[]) => void;
};

export function ColorPanel({ primary, secondary, picked, palette, paletteId, projectName, reloadKey, recent, onPrimary, onSecondary, onSwap, onPalette, onApplyPalette, onManagePalettes, onDropPaletteFiles }: ColorProps) {
  const t = useT();
  const [dropping, setDropping] = useState(false);
  const [hex, setHex] = useState(primary);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setHex(primary), [primary]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyHex = () => {
    navigator.clipboard.writeText(normalizeHex(hex) ?? primary).then(() => setCopied(true), () => {});
  };
  const pasteHex = () => {
    navigator.clipboard.readText().then((text) => {
      const v = normalizeHex(text.trim());
      if (v) onPrimary(v);
    }, () => {});
  };
  const inPalette = palette.includes(primary);
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  return (
    <section
      className={`panel-section ${dropping ? 'drop-active' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onDropPaletteFiles(files);
      }}
    >
      <div className="color-pair">
        <div className="color-stack">
          <ColorPicker className="secondary-chip" label={t('Second color (right click)')} value={secondary} pulse={picked?.secondary} onChange={onSecondary} />
          <ColorPicker className="primary-chip" label={t('Main color (left click). Click to pick any color.')} value={primary} pulse={picked?.primary} onChange={onPrimary} />
          <button className="swap-button" onClick={onSwap} title={t('Swap colors (X)')} aria-label={t('Swap colors')}>
            <Icon name="swap" size={12} />
          </button>
        </div>
        <div className="color-fields">
          <div className={`hex-field ${isHex(hex) ? '' : 'invalid'}`}>
            <span>#</span>
            <input
              value={hex.replace('#', '')}
              maxLength={9}
              spellCheck={false}
              aria-label={t('Hex color')}
              onChange={(e) => {
                setHex(`#${e.target.value.replace('#', '')}`);
                const v = normalizeHex(e.target.value);
                const len = e.target.value.replace('#', '').length;
                if (v && (len === 6 || len === 8)) onPrimary(v);
              }}
              onBlur={() => {
                const v = normalizeHex(hex);
                if (v) onPrimary(v);
                else setHex(primary);
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <button className="hex-action" title={t('Copy hex')} aria-label={t('Copy hex')} onClick={copyHex}>
              <Icon name={copied ? 'check' : 'copy'} size={13} />
            </button>
            <button className="hex-action" title={t('Paste hex')} aria-label={t('Paste hex')} onClick={pasteHex}>
              <Icon name="paste" size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="subheading">
        <PalettePicker
          palette={palette}
          paletteId={paletteId}
          projectName={projectName}
          reloadKey={reloadKey}
          onApply={onApplyPalette}
          onManage={onManagePalettes}
        />
        <div className="subheading-actions">
          <button
            className="icon-button small"
            title={inPalette ? t('Already in palette') : t('Add main color to palette')}
            disabled={inPalette}
            onClick={() => onPalette([...palette, primary])}
          >
            <Icon name="plus" size={14} />
          </button>
          <button className={`icon-button small ${editing ? 'active' : ''}`} title={t('Remove colors')} onClick={() => setEditing((v) => !v)} disabled={!palette.length}>
            <Icon name={editing ? 'check' : 'edit'} size={14} />
          </button>
        </div>
      </div>
      <div className={`swatch-grid ${editing ? 'editing' : ''}`}>
        {palette.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className={`swatch ${primary === c ? 'is-primary' : ''} ${secondary === c ? 'is-secondary' : ''}`}
            style={{ background: c }}
            title={editing ? t('Remove {color}', { color: c }) : c}
            aria-label={editing ? t('Remove {color}', { color: c }) : t('Use {color}', { color: c })}
            onClick={() => (editing ? onPalette(palette.filter((_, j) => j !== i)) : onPrimary(c))}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!editing) onSecondary(c);
            }}
          >
            {editing && <Icon name="close" size={12} />}
          </button>
        ))}
      </div>
      {editing && <p className="panel-note">{t('Click a color to remove it.')}</p>}
      {recent.length > 0 && (
        <>
          <div className="subheading">
            <span>{t('Recent')}</span>
          </div>
          <div className="swatch-grid">
            {recent.map((c) => (
              <button
                key={c}
                className={`swatch ${primary === c ? 'is-primary' : ''}`}
                style={{ background: c }}
                title={c}
                aria-label={t('Use {color}', { color: c })}
                onClick={() => onPrimary(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSecondary(c);
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

type LayersProps = {
  doc: Doc;
  frame: number;
  layerId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onOpacity: (id: string, opacity: number) => void;
  onAdd: (aboveId: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: 1 | -1) => void;
  onReorder: (id: string, to: number) => void;
  onMerge: (id: string) => void;
  onClear: (id: string) => void;
  onSolo: (id: string) => void;
  onShowAll: () => void;
};

export function LayersPanel(props: LayersProps) {
  const t = useT();
  const { doc, frame, layerId } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };
  const index = doc.layers.findIndex((l) => l.id === layerId);
  const active = doc.layers[index];
  const cels = doc.frames[frame]?.cels ?? {};
  const menu = useContextMenu();
  const openMenu = (e: MouseEvent, layer: Layer) => {
    props.onSelect(layer.id);
    const i = doc.layers.indexOf(layer);
    const allVisible = doc.layers.every((l) => l.visible);
    const solo = layer.visible && doc.layers.every((l) => l === layer || !l.visible);
    menu.open(e, [
      { label: t('New layer above'), icon: 'plus', onSelect: () => props.onAdd(layer.id) },
      { label: t('Duplicate'), icon: 'copy', onSelect: () => props.onDuplicate(layer.id) },
      { label: t('Rename'), icon: 'edit', onSelect: () => setRenaming(layer.id) },
      { separator: true },
      { label: layer.visible ? t('Hide') : t('Show'), icon: layer.visible ? 'eyeOff' : 'eye', onSelect: () => props.onToggle(layer.id) },
      { label: t('Show only this layer'), icon: 'eye', disabled: solo || doc.layers.length < 2, onSelect: () => props.onSolo(layer.id) },
      { label: t('Show all layers'), icon: 'layers', disabled: allVisible, onSelect: props.onShowAll },
      { separator: true },
      { label: t('Move up'), icon: 'up', disabled: i >= doc.layers.length - 1, onSelect: () => props.onMove(layer.id, 1) },
      { label: t('Move down'), icon: 'down', disabled: i <= 0, onSelect: () => props.onMove(layer.id, -1) },
      { label: t('Merge with layer below'), icon: 'merge', disabled: i <= 0, onSelect: () => props.onMerge(layer.id) },
      { separator: true },
      { label: t('Clear frame {n}', { n: frame + 1 }), icon: 'eraser', hint: t('Del'), disabled: !cels[layer.id], onSelect: () => props.onClear(layer.id) },
      { label: t('Delete layer'), icon: 'trash', danger: true, disabled: doc.layers.length < 2, onSelect: () => props.onDelete(layer.id) },
    ]);
  };
  return (
    <section className="panel-section">
      {menu.element}
      <div className="subheading">
        <span>
          {t('Layers')} <small>{doc.layers.length}</small>
        </span>
        <div className="subheading-actions">
          <button className="icon-button small" title={t('New layer')} onClick={() => props.onAdd(layerId)}>
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>
      <div className="layer-list" role="listbox" aria-label={t('Layers')}>
        {[...doc.layers].reverse().map((layer) => (
          <div
            key={layer.id}
            role="option"
            aria-selected={layer.id === layerId}
            className={`layer-row ${layer.id === layerId ? 'selected' : ''} ${layer.visible ? '' : 'hidden-layer'} ${dragId === layer.id ? 'dragging' : ''} ${overId === layer.id && dragId !== layer.id ? 'drop-target' : ''}`}
            draggable={renaming !== layer.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', layer.id);
              setDragId(layer.id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overId !== layer.id) setOverId(layer.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== layer.id) props.onReorder(dragId, doc.layers.indexOf(layer));
              endDrag();
            }}
            onDragEnd={endDrag}
            onClick={() => props.onSelect(layer.id)}
            onDoubleClick={() => setRenaming(layer.id)}
            onContextMenu={(e) => openMenu(e, layer)}
          >
            <button
              className="icon-button small eye"
              title={layer.visible ? t('Hide layer') : t('Show layer')}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggle(layer.id);
              }}
            >
              <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={14} />
            </button>
            <div className="layer-thumb">
              <CelThumb cel={cels[layer.id]} width={doc.width} height={doc.height} />
            </div>
            {renaming === layer.id ? (
              <input
                className="layer-rename"
                autoFocus
                defaultValue={layer.name}
                maxLength={40}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v) props.onRename(layer.id, v);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="layer-name" title={t('Double-click to rename')}>
                {layer.name}
              </span>
            )}
            {layer.opacity < 100 && <span className="layer-opacity">{layer.opacity}%</span>}
          </div>
        ))}
      </div>
      {active && (
        <div className="range-row">
          <span>{t('Opacity')}</span>
          <input type="range" min={0} max={100} value={active.opacity} onChange={(e) => props.onOpacity(active.id, +e.target.value)} aria-label={t('Layer opacity')} />
          <b>{active.opacity}%</b>
        </div>
      )}
      <div className="action-row">
        <button className="icon-button" title={t('Move layer up')} disabled={index >= doc.layers.length - 1} onClick={() => props.onMove(layerId, 1)}>
          <Icon name="up" size={15} />
        </button>
        <button className="icon-button" title={t('Move layer down')} disabled={index <= 0} onClick={() => props.onMove(layerId, -1)}>
          <Icon name="down" size={15} />
        </button>
        <button className="icon-button" title={t('Duplicate layer')} onClick={() => props.onDuplicate(layerId)}>
          <Icon name="copy" size={15} />
        </button>
        <button className="icon-button" title={t('Merge with layer below')} disabled={index <= 0} onClick={() => props.onMerge(layerId)}>
          <Icon name="merge" size={15} />
        </button>
        <button className="icon-button" title={t('Rename layer')} onClick={() => setRenaming(layerId)}>
          <Icon name="edit" size={15} />
        </button>
        <button className="icon-button danger" title={t('Delete layer')} disabled={doc.layers.length < 2} onClick={() => props.onDelete(layerId)}>
          <Icon name="trash" size={15} />
        </button>
      </div>
    </section>
  );
}

type ReferenceProps = {
  reference: Reference | null;
  editing: boolean;
  onAdd: () => void;
  onChange: (ref: Reference) => void;
  onEdit: () => void;
  onRemove: () => void;
};

export function ReferencePanel({ reference, editing, onAdd, onChange, onEdit, onRemove }: ReferenceProps) {
  const t = useT();
  const menu = useContextMenu();
  const openMenu = (e: MouseEvent) => {
    if (!reference) return;
    menu.open(e, [
      { label: reference.visible ? t('Hide') : t('Show'), icon: reference.visible ? 'eyeOff' : 'eye', onSelect: () => onChange({ ...reference, visible: !reference.visible }) },
      { label: editing ? t('Done adjusting') : t('Move, resize & crop'), icon: 'move', disabled: !reference.visible, onSelect: onEdit },
      { label: reference.above ? t('Put behind art') : t('Put over art'), icon: 'layers', onSelect: () => onChange({ ...reference, above: !reference.above }) },
      { separator: true },
      { label: t('Replace image'), icon: 'image', onSelect: onAdd },
      { label: t('Remove reference'), icon: 'trash', danger: true, onSelect: onRemove },
    ]);
  };
  return (
    <section className="panel-section">
      {menu.element}
      <div className="subheading">
        <span>{t('Reference')}</span>
      </div>
      {!reference ? (
        <button className="dashed-button" onClick={onAdd}>
          <Icon name="image" size={15} /> {t('Add image to trace')}
        </button>
      ) : (
        <>
          <div className="reference-row" onContextMenu={openMenu}>
            <img src={reference.src} alt="" />
            <div className="reference-buttons">
              <button className="icon-button small" title={reference.visible ? t('Hide reference') : t('Show reference')} onClick={() => onChange({ ...reference, visible: !reference.visible })}>
                <Icon name={reference.visible ? 'eye' : 'eyeOff'} size={14} />
              </button>
              <button className={`chip-button ${editing ? 'active' : ''}`} onClick={onEdit} disabled={!reference.visible} title={t('Move, resize and crop the image')}>
                {editing ? t('Done') : t('Adjust')}
              </button>
              <button className="icon-button small danger" title={t('Remove reference')} onClick={onRemove}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
          <div className="range-row">
            <span>{t('Opacity')}</span>
            <input type="range" min={5} max={100} value={reference.opacity} onChange={(e) => onChange({ ...reference, opacity: +e.target.value })} aria-label={t('Reference opacity')} />
            <b>{reference.opacity}%</b>
          </div>
          <div className="segmented small">
            <button className={!reference.above ? 'active' : ''} onClick={() => onChange({ ...reference, above: false })}>
              {t('Behind art')}
            </button>
            <button className={reference.above ? 'active' : ''} onClick={() => onChange({ ...reference, above: true })}>
              {t('Over art')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type TimelineProps = {
  doc: Doc;
  frame: number;
  playing: boolean;
  onion: boolean;
  onSelect: (i: number) => void;
  onPlay: () => void;
  onOnion: () => void;
  onAdd: (after: number) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onMove: (index: number, dir: 1 | -1) => void;
  onReorder: (from: number, to: number) => void;
  onFps: (fps: number) => void;
};

export function Timeline(props: TimelineProps) {
  const t = useT();
  const { doc, frame, playing } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const full = doc.frames.length >= MAX_FRAMES;
  const menu = useContextMenu();
  const count = doc.frames.length;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const endDrag = () => {
    setDragFrom(null);
    setSlot(null);
  };
  const openMenu = (e: MouseEvent, i: number) => {
    props.onSelect(i);
    menu.open(e, [
      { label: t('New blank frame after'), icon: 'plus', disabled: full, onSelect: () => props.onAdd(i) },
      { label: t('Duplicate'), icon: 'copy', disabled: full, onSelect: () => props.onDuplicate(i) },
      { separator: true },
      { label: t('Move left'), icon: 'back', disabled: i === 0, onSelect: () => props.onMove(i, -1) },
      { label: t('Move right'), icon: 'next', disabled: i === count - 1, onSelect: () => props.onMove(i, 1) },
      { separator: true },
      { label: t('Delete frame {n}', { n: i + 1 }), icon: 'trash', danger: true, disabled: count < 2, onSelect: () => props.onDelete(i) },
    ]);
  };
  useEffect(() => {
    listRef.current?.querySelector('.frame-cell.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [frame]);
  return (
    <div className="timeline">
      {menu.element}
      <div className="timeline-bar">
        <div className="timeline-group">
          <button className={`play-button ${playing ? 'playing' : ''}`} onClick={props.onPlay} title={playing ? t('Pause (Enter)') : t('Play (Enter)')} disabled={doc.frames.length < 2}>
            <Icon name={playing ? 'pause' : 'play'} size={14} />
          </button>
          <button className="icon-button small" title={t('Previous frame (,)')} onClick={() => props.onSelect((frame - 1 + doc.frames.length) % doc.frames.length)} disabled={doc.frames.length < 2}>
            <Icon name="back" size={14} />
          </button>
          <span className="frame-counter">
            {frame + 1} / {doc.frames.length}
          </span>
          <button className="icon-button small" title={t('Next frame (.)')} onClick={() => props.onSelect((frame + 1) % doc.frames.length)} disabled={doc.frames.length < 2}>
            <Icon name="next" size={14} />
          </button>
          <label className="fps-field" title={t('Animation speed')}>
            <input type="number" min={1} max={30} value={doc.fps} onChange={(e) => props.onFps(Math.max(1, Math.min(30, Math.round(+e.target.value) || 1)))} />
            fps
          </label>
          <button className={`chip-button ${props.onion ? 'active' : ''}`} onClick={props.onOnion} title={t('Show neighbor frames faintly (K)')} disabled={doc.frames.length < 2}>
            <Icon name="onion" size={13} /> <span className="chip-label">{t('Onion skin')}</span>
          </button>
        </div>
        <div className="timeline-group">
          <button className="icon-button small" title={t('Move frame left')} disabled={frame === 0} onClick={() => props.onMove(frame, -1)}>
            <Icon name="back" size={14} />
          </button>
          <button className="icon-button small" title={t('Move frame right')} disabled={frame === doc.frames.length - 1} onClick={() => props.onMove(frame, 1)}>
            <Icon name="next" size={14} />
          </button>
          <button className="icon-button small" title={t('Duplicate frame')} disabled={full} onClick={() => props.onDuplicate(frame)}>
            <Icon name="copy" size={14} />
          </button>
          <button className="icon-button small danger" title={t('Delete frame')} disabled={doc.frames.length < 2} onClick={() => props.onDelete(frame)}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>
      <div className="frame-list" ref={listRef}>
        {doc.frames.map((f, i) => (
          <button
            key={f.id}
            className={`frame-cell ${i === frame ? 'active' : ''} ${dragFrom === i ? 'dragging' : ''} ${dragFrom !== null && slot === i && slot !== dragFrom && slot !== dragFrom + 1 ? 'drop-before' : ''} ${dragFrom !== null && slot === i + 1 && i === count - 1 && slot !== dragFrom + 1 ? 'drop-after' : ''}`}
            draggable={count > 1}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', f.id);
              setDragFrom(i);
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const r = e.currentTarget.getBoundingClientRect();
              const s = e.clientX < r.left + r.width / 2 ? i : i + 1;
              if (s !== slot) setSlot(s);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && slot !== null) props.onReorder(dragFrom, slot > dragFrom ? slot - 1 : slot);
              endDrag();
            }}
            onDragEnd={endDrag}
            onClick={() => props.onSelect(i)}
            onContextMenu={(e) => openMenu(e, i)}
            title={t('Frame {n}', { n: i + 1 })}
          >
            <span className="frame-number">{i + 1}</span>
            <span className="frame-art">
              <FrameThumb frame={f} layers={doc.layers} width={doc.width} height={doc.height} />
            </span>
          </button>
        ))}
        <button className="add-frame" onClick={() => props.onAdd(frame)} disabled={full} title={full ? t('Limit of {n} frames', { n: MAX_FRAMES }) : t('New blank frame')}>
          <Icon name="plus" size={16} />
          <span>{t('Frame')}</span>
        </button>
      </div>
    </div>
  );
}
