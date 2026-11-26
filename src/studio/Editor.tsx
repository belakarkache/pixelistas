import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CanvasView, type CanvasApi } from './CanvasView';
import { ColorPanel, LayersPanel, ReferencePanel, Timeline } from './panels';
import { ExportDialog, HelpDialog, MOD, ResizeDialog } from './dialogs';
import { PreviewPanel, usePreviewOpen } from './PreviewPanel';
import { PaletteManager } from './PaletteManager';
import { Icon } from './Icon';
import { BrandMark } from './Brand';
import { useHistory } from './useHistory';
import { useHover } from './hoverStore';
import { loadProject, saveProject } from './storage';
import { loadImage, readFileAsDataUrl } from './importer';
import { clearSelected, copySelected, placeClip, placeLift, selectAll, type Clip, type SelectionLift, type SelectOp, type Selection } from './selection';
import { getCel, unpackHex, withCel, type Cel, type Project, type Reference } from './model';
import * as ops from './ops';
import { panCrop, type RefMode } from './reference';
import { TOOLS, type Tool, type ToolOptions, type View } from './tools';
import { toast } from './toast';
import { readPref, writePref } from './prefs';
import { LanguageToggle } from './i18n/LanguageToggle';
import { msg, useT } from './i18n';

let clipboard: Clip | null = null;

type ThemeProps = { dark: boolean; onToggleTheme: () => void };

export function EditorRoute(props: ThemeProps) {
  const t = useT();
  const { id = '' } = useParams();
  const [state, setState] = useState<{ id: string; project: Project | null | undefined }>({ id: '', project: undefined });
  useEffect(() => {
    let alive = true;
    loadProject(id)
      .then((project) => alive && setState({ id, project: project ?? null }))
      .catch(() => alive && setState({ id, project: null }));
    return () => {
      alive = false;
    };
  }, [id]);
  if (state.id !== id || state.project === undefined) return <div className="studio-loading">{t('Opening…')}</div>;
  if (!state.project)
    return (
      <div className="studio-loading">
        <h2>{t('Project not found')}</h2>
        <p>{t('It may have been deleted, or it was made in another browser.')}</p>
        <Link className="primary-button" to="/">
          {t('Back to projects')}
        </Link>
      </div>
    );
  return <Editor key={id} project={state.project} {...props} />;
}

const SELECT_OPS: { op: SelectOp; label: string; hint: string }[] = [
  { op: 'replace', label: msg('New selection'), hint: msg('New selection') },
  { op: 'add', label: msg('Add to selection'), hint: msg('Add to selection (hold Shift)') },
  { op: 'subtract', label: msg('Subtract from selection'), hint: msg('Subtract from selection (hold Alt)') },
  { op: 'intersect', label: msg('Intersect with selection'), hint: msg('Intersect with selection (hold Shift+Alt)') },
];

const GRID_KEY = 'pixelistas-grid';
const readGrid = () => readPref(GRID_KEY) !== 'off';

type SaveState = 'saved' | 'saving' | 'error';
type DialogKind = 'export' | 'resize' | 'help' | 'palettes' | null;

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function Editor({ project, dark, onToggleTheme }: { project: Project } & ThemeProps) {
  const t = useT();
  const history = useHistory(project.doc);
  const doc = history.value;
  const [name, setName] = useState(project.name);
  const [palette, setPalette] = useState(project.palette);
  const [paletteId, setPaletteId] = useState(project.paletteId ?? null);
  const [reference, setReference] = useState<Reference | null>(project.reference);
  const [frameState, setFrame] = useState(0);
  const [layerState, setLayerId] = useState(project.doc.layers[project.doc.layers.length - 1].id);
  const [tool, setToolState] = useState<Tool>('pencil');
  const toolBeforePicker = useRef<Tool>('pencil');
  const setTool = (next: Tool) => {
    if (next === 'picker' && tool !== 'picker') toolBeforePicker.current = tool;
    setToolState(next);
  };
  const leavePicker = () => {
    if (tool === 'picker') setToolState(toolBeforePicker.current);
  };
  const [options, setOptions] = useState<ToolOptions>({ brush: 1, mirror: false, fillShapes: false, contiguous: true, selectMode: 'rect', selectOp: 'replace' });
  const [selectionState, setSelection] = useState<Selection | null>(null);
  const [hasClip, setHasClip] = useState(() => clipboard !== null);
  const [primary, setPrimary] = useState('#1a1c2c');
  const [secondary, setSecondary] = useState('#ffffff00');
  const [picked, setPicked] = useState({ primary: 0, secondary: 0 });
  const pickColor = (hex: string, sec: boolean) => {
    if (hex === (sec ? secondary : primary)) return;
    if (sec) setSecondary(hex);
    else setPrimary(hex);
    setPicked((n) => (sec ? { ...n, secondary: n.secondary + 1 } : { ...n, primary: n.primary + 1 }));
  };
  const [recent, setRecent] = useState<string[]>([]);
  const [grid, setGrid] = useState(readGrid);
  const [onion, setOnion] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>({ zoom: 0, x: 0, y: 0 });
  const [refEdit, setRefEditState] = useState(false);
  const [refMode, setRefMode] = useState<RefMode>('move');
  const setRefEdit = (v: boolean | ((prev: boolean) => boolean)) => {
    setRefEditState(v);
    setRefMode('move');
  };
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [paletteFiles, setPaletteFiles] = useState<File[] | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [panelOpen, setPanelOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = usePreviewOpen();
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const canvasApi = useRef<CanvasApi | null>(null);
  const refInput = useRef<HTMLInputElement>(null);

  const frame = Math.min(frameState, doc.frames.length - 1);
  const layer = doc.layers.find((l) => l.id === layerState) ?? doc.layers[doc.layers.length - 1];
  const selection = selectionState?.width === doc.width && selectionState.height === doc.height ? selectionState : null;

  const latest = useRef(project);
  const dirty = useRef(false);
  const flush = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await saveProject(latest.current);
      if (!dirty.current) setSaveState('saved');
    } catch {
      dirty.current = true;
      setSaveState('error');
    }
  }, []);

  useEffect(() => {
    if (doc === project.doc && name === project.name && palette === project.palette && paletteId === (project.paletteId ?? null) && reference === project.reference) return;
    latest.current = { ...project, name: name.trim() || t('Untitled'), doc, palette, paletteId, reference, updatedAt: Date.now() };
    dirty.current = true;
    setSaveState('saving');
    const timer = setTimeout(flush, 500);
    return () => clearTimeout(timer);
  }, [doc, name, palette, paletteId, reference, project, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  useEffect(() => writePref(GRID_KEY, grid ? 'on' : 'off'), [grid]);

  useEffect(() => {
    if (!playing) return;
    if (doc.frames.length < 2) {
      setPlaying(false);
      return;
    }
    const id = setInterval(() => setFrame((f) => (f + 1) % doc.frames.length), 1000 / doc.fps);
    return () => clearInterval(id);
  }, [playing, doc.fps, doc.frames.length]);

  const commit = history.commit;
  const current = () => history.current.current;

  const addRecent = (hex: string) => setRecent((r) => (r[0] === hex ? r : [hex, ...r.filter((c) => c !== hex)].slice(0, 16)));

  const onCommit = (cel: Cel, value: number) => {
    commit(withCel(current(), frame, layer.id, cel));
    if (value >>> 24) addRecent(unpackHex(value));
  };

  const float = useRef<(SelectionLift & { frame: number; layerId: string; cel: Cel; moved: Selection | null }) | null>(null);

  const liftSelection = (): SelectionLift | null => {
    if (!selection) return null;
    const cel = getCel(current(), frame, layer.id);
    const f = float.current;
    if (f && f.frame === frame && f.layerId === layer.id && f.cel === cel && f.moved === selection) return f;
    return { origin: cel ?? new Uint32Array(doc.width * doc.height), sel: selection, dx: 0, dy: 0 };
  };

  const moveSelection = (lift: SelectionLift, dx: number, dy: number, key?: string) => {
    const { cel, sel: moved } = placeLift(lift, dx, dy);
    commit(withCel(current(), frame, layer.id, cel), key);
    setSelection(moved);
    float.current = { ...lift, dx, dy, frame, layerId: layer.id, cel, moved };
  };

  const copySelection = (cut: boolean) => {
    if (!selection) {
      toast(cut ? t('Select an area to cut') : t('Select an area to copy'));
      return;
    }
    const d = current();
    const cel = getCel(d, frame, layer.id) ?? new Uint32Array(d.width * d.height);
    clipboard = copySelected(cel, selection);
    setHasClip(true);
    if (cut) commit(withCel(d, frame, layer.id, clearSelected(cel, selection)));
    toast(cut ? t('Cut · {mod}+V to paste', { mod: MOD }) : t('Copied · {mod}+V to paste', { mod: MOD }));
  };

  const paste = () => {
    if (!clipboard) {
      toast(t('Nothing to paste'));
      return;
    }
    if (!layer.visible) {
      toast(t('This layer is hidden. Show it to paste.'));
      return;
    }
    const d = current();
    const placed = placeClip(clipboard, d.width, d.height);
    if (!placed) return;
    canvasApi.current?.cancel();
    const origin = getCel(d, frame, layer.id) ?? new Uint32Array(d.width * d.height);
    moveSelection({ origin, sel: placed.sel, dx: 0, dy: 0, pixels: placed.pixels }, 0, 0);
    if (tool !== 'select' && tool !== 'move') setTool('select');
  };

  const undo = () => {
    canvasApi.current?.cancel();
    if (!history.undo()) toast(t('Nothing to undo'));
  };
  const redo = () => {
    canvasApi.current?.cancel();
    if (!history.redo()) toast(t('Nothing to redo'));
  };

  const selectFrame = (i: number) => {
    setPlaying(false);
    setFrame(i);
  };

  const layerActions = {
    onSelect: setLayerId,
    onToggle: (id: string) => commit(ops.updateLayer(current(), id, { visible: !current().layers.find((l) => l.id === id)?.visible })),
    onRename: (id: string, name: string) => commit(ops.updateLayer(current(), id, { name })),
    onOpacity: (id: string, opacity: number) => commit(ops.updateLayer(current(), id, { opacity }), `opacity-${id}`),
    onAdd: (aboveId: string) => {
      const r = ops.addLayer(current(), aboveId);
      commit(r.doc);
      setLayerId(r.id);
    },
    onDuplicate: (id: string) => {
      const r = ops.duplicateLayer(current(), id);
      commit(r.doc);
      setLayerId(r.id);
    },
    onDelete: (id: string) => {
      const d = current();
      const i = d.layers.findIndex((l) => l.id === id);
      if (i < 0 || d.layers.length < 2) return;
      commit(ops.deleteLayer(d, id));
      setLayerId(d.layers[i > 0 ? i - 1 : 1].id);
      toast(t('Deleted “{name}” · {mod}+Z to undo', { name: d.layers[i].name, mod: MOD }));
    },
    onMove: (id: string, dir: 1 | -1) => commit(ops.moveLayer(current(), id, dir)),
    onReorder: (id: string, to: number) => commit(ops.reorderLayer(current(), id, to)),
    onMerge: (id: string) => {
      const r = ops.mergeDown(current(), id);
      if (!r) return;
      commit(r.doc);
      setLayerId(r.id);
    },
    onClear: (id: string) => commit(ops.clearLayer(current(), frame, id)),
    onSolo: (id: string) => {
      const d = current();
      commit({ ...d, layers: d.layers.map((l) => (l.visible === (l.id === id) ? l : { ...l, visible: l.id === id })) });
    },
    onShowAll: () => {
      const d = current();
      commit({ ...d, layers: d.layers.map((l) => (l.visible ? l : { ...l, visible: true })) });
    },
  };

  const frameActions = {
    onSelect: selectFrame,
    onPlay: () => setPlaying((p) => !p),
    onOnion: () => setOnion((o) => !o),
    onAdd: (after: number) => {
      commit(ops.addFrame(current(), after, false));
      selectFrame(after + 1);
    },
    onDuplicate: (i: number) => {
      commit(ops.addFrame(current(), i, true));
      selectFrame(i + 1);
    },
    onDelete: (i: number) => {
      if (current().frames.length < 2) return;
      commit(ops.deleteFrame(current(), i));
      selectFrame(Math.max(0, i - 1));
      toast(t('Deleted frame {n} · {mod}+Z to undo', { n: i + 1, mod: MOD }));
    },
    onMove: (i: number, dir: 1 | -1) => {
      const j = i + dir;
      if (j < 0 || j >= current().frames.length) return;
      commit(ops.moveFrame(current(), i, dir));
      selectFrame(j);
    },
    onReorder: (from: number, to: number) => {
      const d = current();
      const next = ops.reorderFrame(d, from, to);
      if (next === d) return;
      commit(next);
      selectFrame(next.frames.indexOf(d.frames[from]));
    },
    onFps: (fps: number) => commit({ ...current(), fps }, 'fps'),
  };

  const importReference = async (file: File) => {
    try {
      const img = await loadImage(await readFileAsDataUrl(file));
      const max = 1024;
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const d = current();
      const fit = Math.min(d.width / c.width, d.height / c.height);
      const width = c.width * fit;
      const height = c.height * fit;
      setReference({ src: c.toDataURL('image/png'), x: (d.width - width) / 2, y: (d.height - height) / 2, width, height, opacity: 45, visible: true, above: false });
      setRefEdit(true);
      toast(t('Reference added. Drag to place it, or switch to Crop.'));
    } catch {
      toast(t('Could not read that image'));
    }
  };

  const setBrush = (n: number) => setOptions((o) => ({ ...o, brush: Math.max(1, Math.min(16, n)) }));
  const swap = () => {
    setPrimary(secondary);
    setSecondary(primary);
  };

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e) => {
    if (dialog) return;
    const key = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && key === 's') {
      e.preventDefault();
      flush().then(() => toast(t('Saved on this device')));
      return;
    }
    if (isTyping(e.target)) return;
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      setSelection(selectAll(doc.width, doc.height));
      return;
    }
    if (mod && (key === 'c' || key === 'x')) {
      e.preventDefault();
      copySelection(key === 'x');
      return;
    }
    if (mod && key === 'v') {
      e.preventDefault();
      paste();
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      setSelection(null);
      return;
    }
    if (mod || e.altKey) return;
    const toolByKey = TOOLS.find((x) => x.key.toLowerCase() === key);
    if (toolByKey && !e.shiftKey) {
      if (toolByKey.id === 'select' && tool === 'select') setOptions((o) => ({ ...o, selectMode: o.selectMode === 'rect' ? 'lasso' : 'rect' }));
      setTool(toolByKey.id);
      return;
    }
    const d = current();
    switch (e.key) {
      case 'x':
      case 'X':
        swap();
        break;
      case 'm':
      case 'M':
        setOptions((o) => ({ ...o, mirror: !o.mirror }));
        break;
      case '[':
        setBrush(options.brush - 1);
        break;
      case ']':
        setBrush(options.brush + 1);
        break;
      case '+':
      case '=':
        canvasApi.current?.zoomStep(1);
        break;
      case '-':
      case '_':
        canvasApi.current?.zoomStep(-1);
        break;
      case '0':
        canvasApi.current?.fit();
        break;
      case "'":
        setGrid((g) => !g);
        break;
      case 'p':
      case 'P':
        setPreviewOpen((v) => !v);
        break;
      case 'k':
      case 'K':
        setOnion((o) => !o);
        break;
      case 'Enter':
        if (e.target instanceof HTMLButtonElement) return;
        if (refEdit) {
          setRefEdit(false);
          break;
        }
        if (d.frames.length > 1) setPlaying((p) => !p);
        break;
      case ',':
      case '<':
        selectFrame((frame - 1 + d.frames.length) % d.frames.length);
        break;
      case '.':
      case '>':
        selectFrame((frame + 1) % d.frames.length);
        break;
      case 'Delete':
      case 'Backspace': {
        const cel = getCel(d, frame, layer.id);
        if (selection && cel) commit(withCel(d, frame, layer.id, clearSelected(cel, selection)));
        else if (!selection) commit(ops.clearLayer(d, frame, layer.id));
        break;
      }
      case '?':
        setDialog('help');
        break;
      case 'Escape':
        if (refEdit) setRefEdit(false);
        else setSelection(null);
        leavePicker();
        setPanelOpen(false);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const step = e.shiftKey ? 8 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (refEdit && reference) {
          e.preventDefault();
          setReference(refMode === 'crop' ? panCrop(reference, dx, dy) : { ...reference, x: reference.x + dx, y: reference.y + dy });
          break;
        }
        if (tool !== 'move' && !(tool === 'select' && selection)) return;
        e.preventDefault();
        if (selection) {
          if (!layer.visible) {
            toast(t('This layer is hidden. Show it to move pixels.'));
            break;
          }
          const lift = liftSelection();
          if (lift) moveSelection(lift, lift.dx + dx, lift.dy + dy, `selnudge-${layer.id}-${frame}`);
          break;
        }
        commit(ops.nudgeLayer(d, frame, layer.id, dx, dy), `nudge-${layer.id}-${frame}`);
        break;
      }
      default:
        return;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeTool = TOOLS.find((x) => x.id === tool)!;
  const sized = tool === 'pencil' || tool === 'eraser' || tool === 'line' || tool === 'rect' || tool === 'ellipse';
  const mirrorable = sized || tool === 'fill';

  return (
    <div className="editor">
      <header className="topbar">
        <Link to="/" className="brand-link" aria-label={t('All projects')} title={t('All projects')}>
          <BrandMark />
        </Link>
        <Link to="/" className="ghost-button back-link">
          <Icon name="back" size={15} /> <span>{t('Projects')}</span>
        </Link>
        <div className="top-divider" />
        <input className="name-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => !name.trim() && setName(t('Untitled'))} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={t('Artwork name')} placeholder={t('Untitled')} />
        <span className={`save-state ${saveState}`} title={t('Your work saves automatically in this browser')}>
          <i />
          {saveState === 'saved' ? t('Saved') : saveState === 'saving' ? t('Saving…') : t('Not saved: storage full?')}
        </span>
        <div className="top-spacer" />
        <button className="icon-button" title={t('Undo ({mod}+Z)', { mod: MOD })} aria-label={t('Undo')} onClick={undo} disabled={!history.canUndo}>
          <Icon name="undo" />
        </button>
        <button className="icon-button" title={t('Redo ({mod}+Shift+Z)', { mod: MOD })} aria-label={t('Redo')} onClick={redo} disabled={!history.canRedo}>
          <Icon name="redo" />
        </button>
        <div className="top-divider" />
        <button className="icon-button" title={t('Shortcuts & tips (?)')} aria-label={t('Help')} onClick={() => setDialog('help')}>
          <Icon name="help" />
        </button>
        <LanguageToggle />
        <button className="icon-button" title={dark ? t('Light mode') : t('Dark mode')} aria-label={t('Toggle theme')} onClick={onToggleTheme}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
        <button className={`icon-button panel-toggle ${panelOpen ? 'active' : ''}`} title={t('Colors & layers')} aria-label={t('Colors and layers')} onClick={() => setPanelOpen((v) => !v)}>
          <Icon name="palette" />
        </button>
        <button className="primary-button" onClick={() => setDialog('export')}>
          <Icon name="download" size={16} /> <span>{t('Export')}</span>
        </button>
      </header>

      <main className="workbench">
        <nav className="tool-rail" aria-label={t('Tools')}>
          {TOOLS.map((tl, i) => (
            <div key={tl.id} className="tool-slot">
              {(i === 4 || i === 7) && <div className="rail-separator" />}
              <button className={`tool-button ${tool === tl.id ? 'selected' : ''}`} title={`${t(tl.label)} (${tl.key})`} aria-label={t(tl.label)} aria-pressed={tool === tl.id} onClick={() => setTool(tl.id)}>
                <Icon name={tl.id} size={19} />
                <kbd>{tl.key}</kbd>
              </button>
            </div>
          ))}
        </nav>

        <section className="canvas-area">
          <div className="canvas-toolbar">
            <div className="tool-options">
              <strong className="tool-name">{t(activeTool.label)}</strong>
              {sized && (
                <div className="stepper" title={t('Brush size ([ and ])')}>
                  <span>{t('Size')}</span>
                  <button onClick={() => setBrush(options.brush - 1)} disabled={options.brush <= 1} aria-label={t('Smaller brush')}>
                    <Icon name="minus" size={13} />
                  </button>
                  <b>{options.brush}px</b>
                  <button onClick={() => setBrush(options.brush + 1)} disabled={options.brush >= 16} aria-label={t('Bigger brush')}>
                    <Icon name="plus" size={13} />
                  </button>
                </div>
              )}
              {(tool === 'rect' || tool === 'ellipse') && (
                <button className={`chip-button ${options.fillShapes ? 'active' : ''}`} onClick={() => setOptions((o) => ({ ...o, fillShapes: !o.fillShapes }))}>
                  {t('Filled')}
                </button>
              )}
              {tool === 'fill' && (
                <div className="segmented small">
                  <button className={options.contiguous ? 'active' : ''} onClick={() => setOptions((o) => ({ ...o, contiguous: true }))}>
                    {t('Connected area')}
                  </button>
                  <button className={!options.contiguous ? 'active' : ''} onClick={() => setOptions((o) => ({ ...o, contiguous: false }))}>
                    {t('Same color everywhere')}
                  </button>
                </div>
              )}
              {mirrorable && (
                <button className={`chip-button ${options.mirror ? 'active' : ''}`} onClick={() => setOptions((o) => ({ ...o, mirror: !o.mirror }))} title={t('Mirror drawing left ↔ right (M)')}>
                  <Icon name="mirror" size={14} /> {t('Mirror')}
                </button>
              )}
              {tool === 'select' && (
                <>
                  <div className="segmented small">
                    {(['rect', 'lasso'] as const).map((mode) => (
                      <button key={mode} className={options.selectMode === mode ? 'active' : ''} onClick={() => setOptions((o) => ({ ...o, selectMode: mode }))} title={t('Switch with S')}>
                        <Icon name={mode === 'rect' ? 'select' : 'lasso'} size={13} /> {mode === 'rect' ? t('Rectangle') : t('Lasso')}
                      </button>
                    ))}
                  </div>
                  <div className="segmented small" role="group" aria-label={t('Selection mode')}>
                    {SELECT_OPS.map(({ op, label, hint }) => (
                      <button key={op} className={options.selectOp === op ? 'active' : ''} onClick={() => setOptions((o) => ({ ...o, selectOp: op }))} title={t(hint)} aria-label={t(label)} aria-pressed={options.selectOp === op}>
                        <Icon name={`sel-${op}`} size={13} />
                      </button>
                    ))}
                  </div>
                  <button className="chip-button" onClick={() => setSelection(selectAll(doc.width, doc.height))} title={t('Select all ({mod}+A)', { mod: MOD })}>
                    {t('All')}
                  </button>
                  {selection && (
                    <>
                      <span className="tool-meta">
                        {selection.bounds.w}×{selection.bounds.h}
                      </span>
                      <button className="chip-button" onClick={() => copySelection(false)} title={t('Copy ({mod}+C)', { mod: MOD })}>
                        <Icon name="copy" size={13} /> {t('Copy')}
                      </button>
                      <button className="chip-button" onClick={() => copySelection(true)} title={t('Cut ({mod}+X)', { mod: MOD })}>
                        <Icon name="cut" size={13} /> {t('Cut')}
                      </button>
                      <button className="chip-button" onClick={() => setSelection(null)} title={t('Deselect ({mod}+D)', { mod: MOD })}>
                        <Icon name="close" size={13} /> {t('Deselect')}
                      </button>
                    </>
                  )}
                  {hasClip && (
                    <button className="chip-button" onClick={paste} title={t('Paste ({mod}+V)', { mod: MOD })}>
                      <Icon name="paste" size={13} /> {t('Paste')}
                    </button>
                  )}
                </>
              )}
              {tool === 'move' && (
                <>
                  <button className="chip-button" onClick={() => commit(ops.flipLayer(current(), frame, layer.id, true))}>
                    <Icon name="flipH" size={14} /> {t('Flip horizontal')}
                  </button>
                  <button className="chip-button" onClick={() => commit(ops.flipLayer(current(), frame, layer.id, false))}>
                    <Icon name="flipV" size={14} /> {t('Flip vertical')}
                  </button>
                </>
              )}
            </div>
            <div className="view-options">
              <button className="chip-button size-chip" onClick={() => setDialog('resize')} title={t('Change canvas size')}>
                <Icon name="resize" size={13} /> {doc.width}×{doc.height}
              </button>
              <button className={`chip-button ${grid ? 'active' : ''}`} onClick={() => setGrid((g) => !g)} title={t('Pixel grid (\')')}>
                <Icon name="grid" size={14} /> {t('Grid')}
              </button>
              <div className="zoom-group">
                <button className="icon-button small" onClick={() => canvasApi.current?.zoomStep(-1)} title={t('Zoom out (−)')} aria-label={t('Zoom out')}>
                  <Icon name="minus" size={14} />
                </button>
                <button className="zoom-value" onClick={() => canvasApi.current?.fit()} title={t('Fit to screen (0)')}>
                  {Math.round(view.zoom * 100)}%
                </button>
                <button className="icon-button small" onClick={() => canvasApi.current?.zoomStep(1)} title={t('Zoom in (+)')} aria-label={t('Zoom in')}>
                  <Icon name="plus" size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="stage-wrap">
            <CanvasView
              doc={doc}
              frame={frame}
              layer={layer}
              tool={tool}
              options={options}
              primary={primary}
              secondary={secondary}
              grid={grid}
              onion={onion && !playing}
              dark={dark}
              view={view}
              reference={reference}
              selection={selection}
              onSelect={setSelection}
              liftSelection={liftSelection}
              onMoveSelection={moveSelection}
              refEdit={refEdit}
              refMode={refMode}
              onRefModeChange={setRefMode}
              apiRef={canvasApi}
              onViewChange={setView}
              onViewportChange={setViewport}
              onCommit={onCommit}
              onPick={pickColor}
              onPickEnd={leavePicker}
              onBlocked={toast}
              onInteract={() => {
                setPlaying(false);
                setPanelOpen(false);
              }}
              onReferenceChange={setReference}
              onRefEditDone={() => setRefEdit(false)}
              onDropImage={importReference}
            />
            <div className="stage-hint">
              <span className="hint-dot" />
              {refEdit && reference
                ? refMode === 'crop'
                  ? t('Drag handles to crop · drag inside to pick the part shown · Enter when done')
                  : t('Drag to move · handles resize (Shift: free) · two fingers to scale · arrows nudge')
                : !layer.visible
                  ? t('“{name}” is hidden', { name: layer.name })
                  : t(activeTool.hint)}
            </div>
          </div>

          <Timeline doc={doc} frame={frame} playing={playing} onion={onion} {...frameActions} />
        </section>

        <aside className={`inspector ${panelOpen ? 'open' : ''}`}>
          <ColorPanel
            primary={primary}
            secondary={secondary}
            picked={picked}
            palette={palette}
            paletteId={paletteId}
            projectName={name}
            reloadKey={dialog}
            recent={recent}
            onPrimary={setPrimary}
            onSecondary={setSecondary}
            onSwap={swap}
            onPalette={setPalette}
            onApplyPalette={(colors, id) => {
              setPalette(colors);
              setPaletteId(id);
            }}
            onManagePalettes={() => {
              setPaletteFiles(null);
              setDialog('palettes');
            }}
            onDropPaletteFiles={(files) => {
              setPaletteFiles(files);
              setDialog('palettes');
            }}
          />
          <PreviewPanel doc={doc} frame={frame} view={view} viewport={viewport} onViewChange={setView} open={previewOpen} onOpenChange={setPreviewOpen} />
          <LayersPanel doc={doc} frame={frame} layerId={layer.id} {...layerActions} />
          <ReferencePanel
            reference={reference}
            editing={refEdit}
            onAdd={() => refInput.current?.click()}
            onChange={setReference}
            onEdit={() => setRefEdit((v) => !v)}
            onRemove={() => {
              setReference(null);
              setRefEdit(false);
            }}
          />
          <input
            ref={refInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importReference(file);
              e.currentTarget.value = '';
            }}
          />
        </aside>
      </main>

      <StatusBar zoom={view.zoom} layerName={layer.name} frame={frame} frames={doc.frames.length} />

      {dialog === 'export' && <ExportDialog doc={doc} frame={frame} name={name} onClose={() => setDialog(null)} />}
      {dialog === 'resize' && (
        <ResizeDialog
          doc={doc}
          onResize={(w, h, ax, ay) => {
            commit(ops.resizeDoc(current(), w, h, ax, ay));
            requestAnimationFrame(() => canvasApi.current?.fit());
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog === 'palettes' && (
        <PaletteManager
          primary={primary}
          projectPalette={palette}
          activeId={paletteId}
          doc={doc}
          frame={frame}
          reference={reference}
          projectName={name}
          initialFiles={paletteFiles}
          onUse={(p, mode) => {
            if (mode === 'replace') {
              setPalette([...p.colors]);
              setPaletteId(p.id);
              toast(t('Using “{name}”', { name: p.name }));
              return;
            }
            const added = p.colors.filter((c, i) => !palette.includes(c) && p.colors.indexOf(c) === i);
            setPalette([...palette, ...added]);
            toast(added.length ? (added.length === 1 ? t('Added 1 color from “{name}”', { name: p.name }) : t('Added {n} colors from “{name}”', { n: added.length, name: p.name })) : t('All those colors are already in the palette'));
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {panelOpen && <div className="inspector-shade" onClick={() => setPanelOpen(false)} />}
    </div>
  );
}

function StatusBar({ zoom, layerName, frame, frames }: { zoom: number; layerName: string; frame: number; frames: number }) {
  const t = useT();
  const hover = useHover();
  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className="status-coord">{hover ? `X ${hover.x}  Y ${hover.y}` : 'X –  Y –'}</span>
        {hover?.color && (
          <span className="status-color">
            <i style={{ background: hover.color }} />
            {hover.color}
          </span>
        )}
      </div>
      <div className="status-center">
        {t('{layer} · Frame {f}/{total} · {zoom}%', { layer: layerName, f: frame + 1, total: frames, zoom: Math.round(zoom * 100) })}
      </div>
    </footer>
  );
}
