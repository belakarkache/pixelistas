import { useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { clampSize, MAX_SIZE, type Doc } from './model';
import { download, exportDoc, exportSize, slug, type ExportFormat } from './exporter';
import { toast } from './toast';
import { msg, useT } from './i18n';

const PRESETS: [number, number][] = [
  [16, 16],
  [24, 24],
  [32, 32],
  [48, 48],
  [64, 64],
  [128, 128],
  [64, 32],
  [32, 64],
];

function SizeInputs({ width, height, onChange }: { width: string; height: string; onChange: (w: string, h: string) => void }) {
  const t = useT();
  return (
    <div className="size-inputs">
      <label>
        <span>{t('W')}</span>
        <input type="number" inputMode="numeric" min={1} max={MAX_SIZE} value={width} onChange={(e) => onChange(e.target.value, height)} onBlur={() => onChange(String(clampSize(+width)), height)} />
      </label>
      <span className="size-times">×</span>
      <label>
        <span>{t('H')}</span>
        <input type="number" inputMode="numeric" min={1} max={MAX_SIZE} value={height} onChange={(e) => onChange(width, e.target.value)} onBlur={() => onChange(width, String(clampSize(+height)))} />
      </label>
      <span className="size-unit">px</span>
    </div>
  );
}

export function CreateDialog({ onCreate, onClose }: { onCreate: (name: string, w: number, h: number, background: string | null) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState('32');
  const [height, setHeight] = useState('32');
  const [background, setBackground] = useState<'transparent' | 'white'>('transparent');
  const t = useT();
  const w = clampSize(+width);
  const h = clampSize(+height);
  return (
    <Modal title={t('New artwork')} subtitle={t('Pick a canvas size. Up to {max} × {max} px.', { max: MAX_SIZE })} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name, w, h, background === 'white' ? '#ffffff' : null);
        }}
      >
        <label className="field-label" htmlFor="art-name">
          {t('Name')}
        </label>
        <input id="art-name" className="text-input" data-autofocus placeholder={t('Untitled')} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <span className="field-label">{t('Canvas size')}</span>
        <div className="size-presets">
          {PRESETS.map(([pw, ph]) => (
            <button
              type="button"
              key={`${pw}x${ph}`}
              className={`size-preset ${w === pw && h === ph ? 'chosen' : ''}`}
              onClick={() => {
                setWidth(String(pw));
                setHeight(String(ph));
              }}
            >
              <span className="preset-shape" style={{ aspectRatio: `${pw}/${ph}` }} />
              <strong>
                {pw}×{ph}
              </strong>
            </button>
          ))}
        </div>
        <div className="custom-row">
          <span>{t('Custom')}</span>
          <SizeInputs
            width={width}
            height={height}
            onChange={(a, b) => {
              setWidth(a);
              setHeight(b);
            }}
          />
        </div>
        <span className="field-label">{t('Background')}</span>
        <div className="segmented">
          {(['transparent', 'white'] as const).map((b) => (
            <button type="button" key={b} className={background === b ? 'active' : ''} onClick={() => setBackground(b)}>
              <span className={`bg-dot bg-${b}`} />
              {b === 'transparent' ? t('Transparent') : t('White')}
            </button>
          ))}
        </div>
        <button type="submit" className="primary-button wide-button">
          {t('Create {w} × {h} canvas', { w, h })}
        </button>
      </form>
    </Modal>
  );
}

const ANCHORS = [0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => ({ x, y })));

export function ResizeDialog({ doc, onResize, onClose }: { doc: Doc; onResize: (w: number, h: number, ax: number, ay: number) => void; onClose: () => void }) {
  const [width, setWidth] = useState(String(doc.width));
  const [height, setHeight] = useState(String(doc.height));
  const [anchor, setAnchor] = useState({ x: 1, y: 1 });
  const w = clampSize(+width);
  const h = clampSize(+height);
  const crops = w < doc.width || h < doc.height;
  const t = useT();
  return (
    <Modal title={t('Canvas size')} subtitle={t('Currently {w} × {h} px. Your drawing is kept, not stretched.', { w: doc.width, h: doc.height })} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onResize(w, h, anchor.x, anchor.y);
          onClose();
        }}
      >
        <span className="field-label">{t('New size')}</span>
        <SizeInputs
          width={width}
          height={height}
          onChange={(a, b) => {
            setWidth(a);
            setHeight(b);
          }}
        />
        <span className="field-label">{t('Anchor')}</span>
        <div className="anchor-row">
          <div className="anchor-grid">
            {ANCHORS.map((a) => (
              <button
                type="button"
                key={`${a.x}${a.y}`}
                className={anchor.x === a.x && anchor.y === a.y ? 'active' : ''}
                onClick={() => setAnchor(a)}
                aria-label={t('Anchor {pos}', { pos: `${t(['top', 'middle', 'bottom'][a.y])} ${t(['left', 'center', 'right'][a.x])}` })}
              />
            ))}
          </div>
          <p className="dialog-text small">{t('Choose where the current drawing sits inside the new canvas.')}</p>
        </div>
        {crops && <p className="dialog-warning">{t('The new size is smaller. Pixels outside it will be cut off (you can undo).')}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="primary-button" disabled={w === doc.width && h === doc.height}>
            {t('Resize')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const SCALES = [1, 2, 4, 8, 16];

export function ExportDialog({ doc, frame, name, onClose }: { doc: Doc; frame: number; name: string; onClose: () => void }) {
  const animated = doc.frames.length > 1;
  const [format, setFormat] = useState<ExportFormat>(animated ? 'gif' : 'png');
  const [scale, setScale] = useState(() => (Math.max(doc.width, doc.height) <= 64 ? 8 : Math.max(doc.width, doc.height) <= 128 ? 4 : 1));
  const [columns, setColumns] = useState(doc.frames.length);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const size = exportSize(doc, format, scale, columns);
  const tooBig = size.width > 8192 || size.height > 8192;
  const options: { id: ExportFormat; label: string; detail: string; disabled?: boolean }[] = [
    { id: 'png', label: t('PNG image'), detail: animated ? t('Frame {n} only', { n: frame + 1 }) : t('A single picture') },
    { id: 'gif', label: t('Animated GIF'), detail: animated ? t('{n} frames at {fps} fps', { n: doc.frames.length, fps: doc.fps }) : t('Add frames to animate'), disabled: !animated },
    { id: 'sheet', label: t('Spritesheet'), detail: animated ? t('All frames in one PNG, for games') : t('Add frames to use this'), disabled: !animated },
  ];
  const run = async () => {
    setBusy(true);
    try {
      const blob = await exportDoc(doc, format, frame, scale, columns);
      const suffix = format === 'sheet' ? '-sheet' : format === 'png' && animated ? `-frame${frame + 1}` : '';
      download(blob, `${slug(name)}${suffix}${scale > 1 ? `@${scale}x` : ''}.${format === 'gif' ? 'gif' : 'png'}`);
      onClose();
    } catch {
      toast(t('Export failed. Try a smaller scale.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t('Export')} subtitle={t('Download your artwork to share or use anywhere.')} onClose={onClose}>
      <span className="field-label">{t('Format')}</span>
      <div className="format-list">
        {options.map((o) => (
          <button key={o.id} className={`format-option ${format === o.id ? 'chosen' : ''}`} disabled={o.disabled} onClick={() => setFormat(o.id)}>
            <strong>{o.label}</strong>
            <span>{o.detail}</span>
          </button>
        ))}
      </div>
      <span className="field-label">{t('Scale')}</span>
      <div className="segmented">
        {SCALES.map((s) => (
          <button key={s} className={scale === s ? 'active' : ''} onClick={() => setScale(s)}>
            {s}×
          </button>
        ))}
      </div>
      {format === 'sheet' && (
        <>
          <span className="field-label">{t('Columns')}</span>
          <div className="range-row">
            <input type="range" min={1} max={doc.frames.length} value={columns} onChange={(e) => setColumns(+e.target.value)} />
            <b>{columns}</b>
          </div>
        </>
      )}
      <p className="export-size">
        {t('Output:')} <b>{size.width} × {size.height} px</b>
        {scale > 1 && ` · ${t('pixels stay crisp')}`}
      </p>
      {tooBig && <p className="dialog-warning">{t('That is very large. Pick a smaller scale.')}</p>}
      <button className="primary-button wide-button" disabled={busy || tooBig} onClick={run}>
        <Icon name="download" size={16} /> {busy ? t('Preparing…') : t('Download')}
      </button>
    </Modal>
  );
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: [string, [string, string[]][]][] = [
  [
    msg('Tools'),
    [
      [msg('Pencil'), ['B']],
      [msg('Eraser'), ['E']],
      [msg('Fill'), ['G']],
      [msg('Color picker'), ['I']],
      [msg('Line'), ['L']],
      [msg('Rectangle'), ['U']],
      [msg('Ellipse'), ['O']],
      [msg('Move layer'), ['V']],
      [msg('Select (rectangle / lasso)'), ['S']],
      [msg('Hand'), ['H']],
    ],
  ],
  [
    msg('Drawing'),
    [
      [msg('Second color'), [msg('Right click')]],
      [msg('Pick color'), [msg('Alt'), msg('Click')]],
      [msg('Swap colors'), ['X']],
      [msg('Brush size'), ['[', ']']],
      [msg('Mirror drawing'), ['M']],
      [msg('Clear layer or selection'), [msg('Delete')]],
      [msg('Cancel stroke'), [msg('Esc')]],
    ],
  ],
  [
    msg('View'),
    [
      [msg('Pan'), [msg('Space'), msg('Drag')]],
      [msg('Zoom'), [msg('Wheel')]],
      [msg('Zoom in / out'), ['+', '−']],
      [msg('Fit to screen'), ['0']],
      [msg('Toggle grid'), ["'"]],
      [msg('Toggle preview'), ['P']],
    ],
  ],
  [
    msg('Edit & animate'),
    [
      [msg('Undo'), [MOD, 'Z']],
      [msg('Redo'), [MOD, msg('Shift'), 'Z']],
      [msg('Save now'), [MOD, 'S']],
      [msg('Select all'), [MOD, 'A']],
      [msg('Deselect'), [MOD, 'D']],
      [msg('Copy selection'), [MOD, 'C']],
      [msg('Cut selection'), [MOD, 'X']],
      [msg('Paste'), [MOD, 'V']],
      [msg('Play / pause'), [msg('Enter')]],
      [msg('Prev / next frame'), [',', '.']],
      [msg('Onion skin'), ['K']],
      [msg('This help'), ['?']],
    ],
  ],
  [
    msg('Reference'),
    [
      [msg('Nudge image'), [msg('Arrows')]],
      [msg('Free resize'), [msg('Shift'), msg('Drag')]],
      [msg('Finish adjusting'), [msg('Enter')]],
    ],
  ],
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('Shortcuts & tips')} subtitle={t('Everything saves automatically in this browser.')} onClose={onClose} wide>
      <div className="shortcut-columns">
        {SHORTCUTS.map(([group, rows]) => (
          <section key={group}>
            <h3>{t(group)}</h3>
            {rows.map(([label, keys]) => (
              <div className="shortcut-row" key={label}>
                <span>{t(label)}</span>
                <span>
                  {keys.map((k) => (
                    <kbd key={k}>{t(k)}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="dialog-text small">{t('Tip: drop any image on the canvas to use it as a tracing reference.')}</p>
    </Modal>
  );
}
