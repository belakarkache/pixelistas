import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Doc, Frame, Layer } from './model';
import type { View } from './tools';
import { TILE, terrainAt, type Terrain } from './terrain';
import { composeFrame } from './raster';
import { readPref, writePref } from './prefs';
import { msg, useT } from './i18n';

const OPEN_KEY = 'pixelistas-preview-open';
const NARROW_QUERY = '(max-width: 680px)';

export function usePreviewOpen() {
  return useState(() => readPref(OPEN_KEY) !== 'off');
}

const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
};
const SCALE_KEY = 'pixelistas-preview-scale';
const SCALES = ['1', '2', '4', 'fit'] as const;
type Scale = (typeof SCALES)[number];
const FLOAT_KEY = 'pixelistas-preview-float';
const MIN_W = 160;
const MIN_H = 140;
const DEFAULT_FLOAT: FloatRect = { x: 16, y: 16, w: 260, h: 300 };
const BG_KEY = 'pixelistas-preview-bg';
const BGS = [
  { id: 'checker', label: msg('Checker') },
  { id: 'light', label: msg('Light') },
  { id: 'dark', label: msg('Dark') },
  { id: 'world', label: msg('World') },
] as const;
type Bg = (typeof BGS)[number]['id'];

const TERRAIN_COLORS: Record<Terrain, string> = {
  deep: '#2f5d9e',
  water: '#4a86c8',
  sand: '#e3d49a',
  grass: '#6ab04c',
  meadow: '#8cc152',
  forest: '#3e8a45',
  dirt: '#a67c52',
};

function paintWorld(canvas: HTMLCanvasElement, width: number, height: number) {
  const t = TILE;
  const cols = Math.ceil(width / t);
  const rows = Math.ceil(height / t);
  canvas.width = cols * t;
  canvas.height = rows * t;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = TERRAIN_COLORS[terrainAt(x, y)];
      ctx.fillRect(x * t, y * t, t, t);
    }
  }
}

type FloatRect = { x: number; y: number; w: number; h: number };
type FloatState = { floating: boolean; rect: FloatRect };

const clampRect = (r: FloatRect, bw: number, bh: number): FloatRect => {
  const w = Math.max(MIN_W, Math.min(r.w, bw));
  const h = Math.max(MIN_H, Math.min(r.h, bh));
  return { w, h, x: Math.max(0, Math.min(r.x, bw - w)), y: Math.max(0, Math.min(r.y, bh - h)) };
};

const readFloat = (): FloatState => {
  try {
    const v = JSON.parse(readPref(FLOAT_KEY) ?? 'null');
    if (v && typeof v.floating === 'boolean' && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(v.rect?.[k]))) return v;
  } catch {
    return { floating: false, rect: DEFAULT_FLOAT };
  }
  return { floating: false, rect: DEFAULT_FLOAT };
};

type FrameCache = { layers: Layer[]; width: number; height: number; canvases: WeakMap<Frame, HTMLCanvasElement> };

function cachedFrame(cache: { current: FrameCache | null }, doc: Doc, index: number) {
  let c = cache.current;
  if (!c || c.layers !== doc.layers || c.width !== doc.width || c.height !== doc.height) {
    c = { layers: doc.layers, width: doc.width, height: doc.height, canvases: new WeakMap() };
    cache.current = c;
  }
  const frame = doc.frames[index];
  if (!frame) return null;
  let canvas = c.canvases.get(frame);
  if (!canvas) {
    canvas = document.createElement('canvas');
    composeFrame(canvas, doc, index);
    c.canvases.set(frame, canvas);
  }
  return canvas;
}

type Viewport = { width: number; height: number };
type Props = {
  doc: Doc;
  frame: number;
  view: View;
  viewport: Viewport;
  onViewChange: (view: View) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PreviewPanel({ doc, frame, view, viewport, onViewChange, open, onOpenChange }: Props) {
  const t = useT();
  const narrow = useNarrow();
  const [scale, setScale] = useState<Scale>(() => {
    const saved = readPref(SCALE_KEY);
    return SCALES.find((s) => s === saved) ?? 'fit';
  });
  const [bg, setBg] = useState<Bg>(() => {
    const saved = readPref(BG_KEY);
    return BGS.find((b) => b.id === saved)?.id ?? 'checker';
  });
  const [floatState, setFloatState] = useState<FloatState>(readFloat);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const floating = floatState.floating && !!host;
  const worldRef = useRef<HTMLCanvasElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const cache = useRef<FrameCache | null>(null);
  const docRef = useRef(doc);
  const [playing, setPlaying] = useState(false);
  const multi = doc.frames.length > 1;
  docRef.current = doc;

  const paint = (index: number) => {
    const target = canvasRef.current;
    if (!target) return;
    const d = docRef.current;
    if (target.width !== d.width || target.height !== d.height) {
      target.width = d.width;
      target.height = d.height;
    }
    const ctx = target.getContext('2d')!;
    ctx.clearRect(0, 0, d.width, d.height);
    const source = cachedFrame(cache, d, index);
    if (source) ctx.drawImage(source, 0, 0);
  };

  useEffect(() => writePref(OPEN_KEY, open ? 'on' : 'off'), [open]);
  useEffect(() => writePref(SCALE_KEY, scale), [scale]);
  useEffect(() => writePref(BG_KEY, bg), [bg]);
  useEffect(() => writePref(FLOAT_KEY, JSON.stringify(floatState)), [floatState]);

  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>('.stage-wrap');
    setHost(el);
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setFloatState((f) => {
        const rect = clampRect(f.rect, el.clientWidth, el.clientHeight);
        return rect.x === f.rect.x && rect.y === f.rect.y && rect.w === f.rect.w && rect.h === f.rect.h ? f : { ...f, rect };
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const startDrag = (e: ReactPointerEvent<HTMLElement>, mode: 'move' | 'resize') => {
    if (!host || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { px: e.clientX, py: e.clientY, rect: floatState.rect };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      const r = start.rect;
      const next = mode === 'move' ? { ...r, x: r.x + dx, y: r.y + dy } : { ...r, w: r.w + dx, h: r.h + dy };
      setFloatState((f) => ({ ...f, rect: clampRect(next, host.clientWidth, host.clientHeight) }));
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const toggleFloat = () =>
    setFloatState((f) => ({ floating: !f.floating, rect: host ? clampRect(f.rect, host.clientWidth, host.clientHeight) : f.rect }));

  useLayoutEffect(() => {
    if (open && bg === 'world' && worldRef.current) paintWorld(worldRef.current, doc.width, doc.height);
  }, [open, bg, doc.width, doc.height]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!open || !box) return;
    const observer = new ResizeObserver(() => setBoxWidth(box.clientWidth));
    observer.observe(box);
    setBoxWidth(box.clientWidth);
    return () => observer.disconnect();
  }, [open, floating]);

  const running = playing && multi && open;

  useEffect(() => {
    if (!open || running) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => paint(frame));
    return () => cancelAnimationFrame(raf.current);
  }, [open, running, doc, frame]);

  useEffect(() => {
    if (!running) return;
    let index = frame;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const d = docRef.current;
      const step = 1000 / Math.max(1, d.fps);
      acc += now - last;
      last = now;
      if (acc >= step) {
        acc %= step;
        index = (index + 1) % d.frames.length;
        paint(index);
      }
      raf.current = requestAnimationFrame(tick);
    };
    paint(index);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [running]);

  const factor = scale === 'fit' ? Math.max(1, Math.floor(boxWidth / doc.width)) : +scale;

  const hasView = view.zoom > 0 && viewport.width > 0 && viewport.height > 0;
  const visLeft = hasView ? -view.x / view.zoom : 0;
  const visTop = hasView ? -view.y / view.zoom : 0;
  const visW = hasView ? viewport.width / view.zoom : 0;
  const visH = hasView ? viewport.height / view.zoom : 0;
  const left = Math.max(0, visLeft);
  const top = Math.max(0, visTop);
  const right = Math.min(doc.width, visLeft + visW);
  const bottom = Math.min(doc.height, visTop + visH);
  const partial = hasView && (visLeft > 0 || visTop > 0 || visLeft + visW < doc.width || visTop + visH < doc.height);
  const rect = partial ? { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) } : null;

  const centerView = (cx: number, cy: number) =>
    onViewChange({ zoom: view.zoom, x: viewport.width / 2 - cx * view.zoom, y: viewport.height / 2 - cy * view.zoom });

  const toDoc = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / factor, y: (e.clientY - r.top) / factor };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasView || !rect || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const pt = toDoc(e);
    const cx = visLeft + visW / 2;
    const cy = visTop + visH / 2;
    const inside = pt.x >= visLeft && pt.x <= visLeft + visW && pt.y >= visTop && pt.y <= visTop + visH;
    grab.current = inside ? { dx: pt.x - cx, dy: pt.y - cy } : { dx: 0, dy: 0 };
    if (!inside) centerView(pt.x, pt.y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || !hasView) return;
    const pt = toDoc(e);
    centerView(pt.x - g.dx, pt.y - g.dy);
  };

  const onPointerUp = () => {
    grab.current = null;
  };

  const body = (
    <>
      {open && (
        <>
          <div className="preview-box" ref={boxRef}>
            <div
              className={`preview-stage bg-${bg} ${rect ? 'navigable' : ''}`}
              style={{ width: doc.width * factor, height: doc.height * factor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {bg === 'world' && (
                <canvas ref={worldRef} className="preview-canvas preview-world"
                  style={{ width: Math.ceil(doc.width / TILE) * TILE * factor, height: Math.ceil(doc.height / TILE) * TILE * factor }}
                  aria-hidden="true"
                />
              )}
              <canvas ref={canvasRef} className="preview-canvas" style={{ width: '100%', height: '100%' }} aria-label={t('Actual size preview')} />
              {rect && (
                <div
                  className="preview-viewport"
                  style={{ left: rect.left * factor, top: rect.top * factor, width: rect.width * factor, height: rect.height * factor }}
                />
              )}
            </div>
          </div>
          {multi && (
            <button className="preview-play" onClick={() => setPlaying((v) => !v)} aria-pressed={running}>
              {running ? t('Pause') : t('Play')} · {doc.fps} fps
            </button>
          )}
          <div className="segmented small" role="group" aria-label={t('Preview background')}>
            {BGS.map((b) => (
              <button key={b.id} className={bg === b.id ? 'active' : ''} onClick={() => setBg(b.id)}>
                {t(b.label)}
              </button>
            ))}
          </div>
          <div className="segmented small">
            {SCALES.map((s) => (
              <button key={s} className={scale === s ? 'active' : ''} onClick={() => setScale(s)}>
                {s === 'fit' ? t('Fit') : `${s}x`}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );

  const toggle = (
    <button className="preview-toggle" aria-expanded={open} onClick={() => onOpenChange(!open)} title={t('Show/hide preview (P)')}>
      <span className={`preview-caret ${open ? 'open' : ''}`} aria-hidden="true">
        ▸
      </span>
      {t('Preview')}
    </button>
  );

  const size = (
    <small>
      {doc.width}×{doc.height}
    </small>
  );

  if (narrow && host) {
    return createPortal(
      <div className={`preview-corner ${open ? 'open' : ''}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        {toggle}
        {body}
      </div>,
      host,
    );
  }

  if (floating && host) {
    const r = floatState.rect;
    return createPortal(
      <div
        className="preview-float"
        style={{ left: r.x, top: r.y, width: r.w, height: open ? r.h : 'auto' }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="preview-float-head" onPointerDown={(e) => startDrag(e, 'move')}>
          {toggle}
          {size}
          <button className="preview-dock" onClick={toggleFloat} aria-label={t('Dock preview in inspector')} title={t('Dock in inspector')}>
            ⇲
          </button>
        </div>
        <div className="preview-float-body">{body}</div>
        {open && <div className="preview-resize" onPointerDown={(e) => startDrag(e, 'resize')} aria-hidden="true" />}
      </div>,
      host,
    );
  }

  return (
    <section className="panel-section">
      <div className="subheading">
        {toggle}
        <span className="preview-head-end">
          {size}
          {host && (
            <button className="preview-dock" onClick={toggleFloat} aria-label={t('Detach preview')} title={t('Detach preview')}>
              ⇱
            </button>
          )}
        </span>
      </div>
      {body}
    </section>
  );
}
