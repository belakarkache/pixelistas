import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getCel, packHex, unpackHex, type Cel, type Doc, type Layer, type Reference } from './model';
import { composeFrame, ellipsePoints, floodFill, linePoints, rectPoints, sameCel, shiftCel, stamp, topPixel, type Point } from './raster';
import { setHover } from './hoverStore';
import { Icon } from './Icon';
import { cropOf, cropReference, fullRect, panCrop, placeReference, REF_HANDLES, resetCrop, resizeReference, scaleReference, type RefHandle, type RefMode } from './reference';
import { combineSelection, isSelected, liftedCel, liftPlacement, rectBounds, selectLasso, selectRect, snapPlacement, withPlacement, type Placement, type SelectionLift, type SelectMode, type SelectOp, type Selection } from './selection';
import { clampZoom, fitView, stepZoom, type Tool, type ToolOptions, type View } from './tools';
import { useT } from './i18n';

export type CanvasApi = { fit: () => void; zoomStep: (dir: 1 | -1) => void; cancel: () => void };

type Props = {
  doc: Doc;
  frame: number;
  layer: Layer;
  tool: Tool;
  options: ToolOptions;
  primary: string;
  secondary: string;
  grid: boolean;
  onion: boolean;
  dark: boolean;
  view: View;
  reference: Reference | null;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  liftSelection: () => SelectionLift | null;
  onMoveSelection: (lift: SelectionLift, dx: number, dy: number) => void;
  refEdit: boolean;
  refMode: RefMode;
  apiRef: { current: CanvasApi | null };
  onViewChange: (view: View) => void;
  onViewportChange?: (size: { width: number; height: number }) => void;
  onCommit: (cel: Cel, value: number) => void;
  onPick: (hex: string, secondary: boolean) => void;
  onPickEnd: () => void;
  onBlocked: (message: string) => void;
  onInteract: () => void;
  onReferenceChange: (ref: Reference) => void;
  onRefEditDone: () => void;
  onRefModeChange: (mode: RefMode) => void;
  onDropImage: (file: File) => void;
};

type Shape = 'line' | 'rect' | 'ellipse';

type Stroke =
  | { kind: 'paint'; id: number; base: Cel | undefined; cel: Cel; value: number; last: Point; changed: boolean }
  | { kind: 'shape'; id: number; base: Cel | undefined; cel: Cel; value: number; start: Point; shape: Shape }
  | { kind: 'move'; id: number; base: Cel; cel: Cel; start: Point }
  | { kind: 'selmove'; id: number; lift: SelectionLift; cel: Cel; start: Point; dx: number; dy: number }
  | { kind: 'seltransform'; id: number; lift: SelectionLift; cel: Cel; handle: TransformHandle; start: Point; from: Placement; pl: Placement }
  | { kind: 'pan'; id: number; startX: number; startY: number; view: View }
  | { kind: 'pick'; id: number; secondary: boolean }
  | { kind: 'select'; id: number; mode: SelectMode; op: SelectOp; shiftOp: boolean; start: Point; end: Point; points: Point[]; moved: boolean; square: boolean }
  | { kind: 'pinch'; dist: number; mid: Point; view: View };

type TransformHandle = RefHandle | 'rotate';

const HANDLE_ANGLE: Record<RefHandle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

const handleCursor = (handle: RefHandle, angle: number) => {
  const deg = HANDLE_ANGLE[handle] + (angle * 180) / Math.PI;
  return RESIZE_CURSORS[((Math.round(deg / 45) % 4) + 4) % 4];
};

const samePlacement = (a: Placement, b: Placement) => a.cx === b.cx && a.cy === b.cy && a.w === b.w && a.h === b.h && a.angle === b.angle;

type RefDrag =
  | { mode: 'move' | RefHandle; id: number; crop: boolean; startX: number; startY: number; ref: Reference }
  | { mode: 'pinch'; dist: number; mid: Point; ref: Reference };

function draftPath(s: Extract<Stroke, { kind: 'select' }>) {
  const path = new Path2D();
  if (s.mode === 'rect') {
    const b = rectBounds(s.start, s.end, s.square);
    path.rect(b.x, b.y, b.w, b.h);
    return path;
  }
  s.points.forEach((pt, i) => (i ? path.lineTo(pt.x + 0.5, pt.y + 0.5) : path.moveTo(pt.x + 0.5, pt.y + 0.5)));
  path.closePath();
  return path;
}

const zoomAround = (v: View, zoom: number, mx: number, my: number): View => ({
  zoom,
  x: mx - ((mx - v.x) * zoom) / v.zoom,
  y: my - ((my - v.y) * zoom) / v.zoom,
});

function makeChecker(dark: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = dark ? '#2a2b35' : '#ffffff';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = dark ? '#33343f' : '#ececf1';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  return c;
}

export function CanvasView(props: Props) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [composite] = useState(() => document.createElement('canvas'));
  const [onionCanvas] = useState(() => document.createElement('canvas'));
  const checkers = useRef<Record<string, HTMLCanvasElement>>({});
  const p = useRef(props);
  p.current = props;
  const stroke = useRef<Stroke | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const hoverPx = useRef<Point | null>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const loupeHex = useRef<HTMLSpanElement>(null);
  const keys = useRef({ space: false });
  const raf = useRef(0);
  const refImg = useRef<HTMLImageElement | null>(null);
  const refDrag = useRef<RefDrag | null>(null);
  const refPointers = useRef(new Map<number, Point>());
  const antsPhase = useRef(0);
  const [grabbing, setGrabbing] = useState<'none' | 'grab' | 'grabbing'>('none');
  const [overSelection, setOverSelection] = useState(false);
  const [live, setLive] = useState<Placement | null>(null);

  const override = () => {
    const s = stroke.current;
    if (!s || !('cel' in s)) return null;
    return { frame: p.current.frame, layerId: p.current.layer.id, cel: s.cel };
  };

  const draw = () => {
    raf.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { doc, frame, view, grid, onion, reference, dark, tool, options, primary } = p.current;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!view.zoom) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { zoom, x, y } = view;
    const w = doc.width * zoom;
    const h = doc.height * zoom;

    ctx.save();
    ctx.shadowColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(40,36,60,.16)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = dark ? '#2a2b35' : '#fff';
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    const key = dark ? 'dark' : 'light';
    checkers.current[key] ??= makeChecker(dark);
    const pattern = ctx.createPattern(checkers.current[key], 'repeat')!;
    pattern.setTransform(new DOMMatrix().translate(x, y));
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, w, h);

    ctx.imageSmoothingEnabled = false;
    const img = refImg.current;
    const drawRef = () => {
      if (!reference || !img) return;
      const c = cropOf(reference);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = reference.opacity / 100;
      ctx.drawImage(
        img,
        c.x * img.naturalWidth,
        c.y * img.naturalHeight,
        c.w * img.naturalWidth,
        c.h * img.naturalHeight,
        x + reference.x * zoom,
        y + reference.y * zoom,
        reference.width * zoom,
        reference.height * zoom,
      );
      ctx.restore();
    };
    if (reference?.visible && !reference.above) drawRef();

    if (onion && doc.frames.length > 1) {
      for (const [f, alpha] of [[frame - 1, 0.3], [frame + 1, 0.14]] as const) {
        if (f < 0 || f >= doc.frames.length) continue;
        composeFrame(onionCanvas, doc, f);
        ctx.globalAlpha = alpha;
        ctx.drawImage(onionCanvas, x, y, w, h);
      }
      ctx.globalAlpha = 1;
    }

    composeFrame(composite, doc, frame, override());
    ctx.drawImage(composite, x, y, w, h);
    if (reference?.visible && reference.above) drawRef();

    if (p.current.refEdit && reference?.visible && img) {
      const cropping = p.current.refMode === 'crop';
      const ghost = cropping ? fullRect(reference) : reference;
      const c = cropping ? { x: 0, y: 0, w: 1, h: 1 } : cropOf(reference);
      const rx = x + reference.x * zoom;
      const ry = y + reference.y * zoom;
      const ix = Math.max(x, rx);
      const iy = Math.max(y, ry);
      const iw = Math.min(x + w, rx + reference.width * zoom) - ix;
      const ih = Math.min(y + h, ry + reference.height * zoom) - iy;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + ghost.x * zoom, y + ghost.y * zoom, ghost.width * zoom, ghost.height * zoom);
      if (iw > 0 && ih > 0) ctx.rect(ix, iy, iw, ih);
      ctx.clip('evenodd');
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.3;
      ctx.drawImage(
        img,
        c.x * img.naturalWidth,
        c.y * img.naturalHeight,
        c.w * img.naturalWidth,
        c.h * img.naturalHeight,
        x + ghost.x * zoom,
        y + ghost.y * zoom,
        ghost.width * zoom,
        ghost.height * zoom,
      );
      ctx.restore();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dx = (v: number) => Math.round(v * dpr) + 0.5;
    if (grid && zoom >= 4) {
      const x0 = Math.max(0, Math.floor(-x / zoom));
      const x1 = Math.min(doc.width, Math.ceil((canvas.width / dpr - x) / zoom));
      const y0 = Math.max(0, Math.floor(-y / zoom));
      const y1 = Math.min(doc.height, Math.ceil((canvas.height / dpr - y) / zoom));
      ctx.beginPath();
      for (let i = x0; i <= x1; i++) {
        ctx.moveTo(dx(x + i * zoom), dx(y));
        ctx.lineTo(dx(x + i * zoom), dx(y + h));
      }
      for (let j = y0; j <= y1; j++) {
        ctx.moveTo(dx(x), dx(y + j * zoom));
        ctx.lineTo(dx(x + w), dx(y + j * zoom));
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = dark ? 'rgba(150,150,170,.22)' : 'rgba(110,112,130,.22)';
      ctx.stroke();
    }

    const painting = tool === 'pencil' || tool === 'eraser' || tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'fill';
    if (options.mirror && painting) {
      ctx.beginPath();
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.moveTo(dx(x + w / 2), dx(y));
      ctx.lineTo(dx(x + w / 2), dx(y + h));
      ctx.strokeStyle = 'rgba(114,87,232,.7)';
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const sel = p.current.selection;
    const cur = stroke.current;
    const draft = cur?.kind === 'select' && cur.moved ? draftPath(cur) : null;
    const outlines: Path2D[] = [];
    const moving = cur?.kind === 'selmove' ? cur : null;
    if (moving) outlines.push(sel?.outline ?? moving.lift.sel.outline);
    else if (sel && cur?.kind !== 'seltransform' && (!draft || (cur?.kind === 'select' && cur.op !== 'replace'))) outlines.push(sel.outline);
    if (draft) outlines.push(draft);
    const ox = moving ? (moving.dx - (sel ? moving.lift.dx : 0)) * zoom : 0;
    const oy = moving ? (moving.dy - (sel ? moving.lift.dy : 0)) * zoom : 0;
    for (const outline of outlines) {
      const unit = 1 / zoom;
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (x + ox), dpr * (y + oy));
      ctx.lineWidth = unit;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.stroke(outline);
      ctx.setLineDash([4 * unit, 4 * unit]);
      ctx.lineDashOffset = -antsPhase.current * unit;
      ctx.strokeStyle = 'rgba(20,20,30,.95)';
      ctx.stroke(outline);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    const hp = hoverPx.current;
    const busy = stroke.current && (stroke.current.kind === 'pan' || stroke.current.kind === 'pinch');
    if (hp && !busy && tool !== 'hand' && tool !== 'move' && !keys.current.space) {
      const size = tool === 'pencil' || tool === 'eraser' || tool === 'line' || tool === 'rect' || tool === 'ellipse' ? options.brush : 1;
      const off = Math.floor((size - 1) / 2);
      const spots = [hp.x - off];
      if (options.mirror && painting) spots.push(doc.width - 1 - hp.x - ((size + 1) % 2) - off);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const sx of spots) {
        const rx = x + sx * zoom;
        const ry = y + (hp.y - off) * zoom;
        if (tool === 'pencil' && !stroke.current) {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = primary;
          ctx.fillRect(rx, ry, size * zoom, size * zoom);
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = 1 / dpr;
        ctx.strokeStyle = 'rgba(255,255,255,.9)';
        ctx.strokeRect(rx - 1 / dpr, ry - 1 / dpr, size * zoom + 2 / dpr, size * zoom + 2 / dpr);
        ctx.strokeStyle = 'rgba(20,20,30,.85)';
        ctx.strokeRect(rx, ry, size * zoom, size * zoom);
      }
    }
  };

  const invalidate = () => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  };

  useEffect(invalidate);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useEffect(() => {
    if (!props.selection) return;
    const id = setInterval(() => {
      antsPhase.current = (antsPhase.current + 1) % 8;
      invalidate();
    }, 120);
    return () => clearInterval(id);
  }, [props.selection]);

  useEffect(() => {
    if (props.tool !== 'picker' && loupeRef.current) loupeRef.current.hidden = true;
  }, [props.tool]);

  useEffect(() => {
    const src = props.reference?.src;
    if (!src) {
      refImg.current = null;
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      refImg.current = img;
      invalidate();
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [props.reference?.src]);

  useEffect(() => {
    const stage = stageRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = stage.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (!p.current.view.zoom && width > 0) p.current.onViewChange(fitView(p.current.doc.width, p.current.doc.height, width, height));
      p.current.onViewportChange?.({ width, height });
      draw();
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  const stageCenter = () => {
    const r = stageRef.current!.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  const cancelStroke = () => {
    if (stroke.current?.kind === 'selmove') setGrabbing(keys.current.space ? 'grab' : 'none');
    stroke.current = null;
    setLive(null);
    invalidate();
  };

  props.apiRef.current = {
    fit: () => {
      const { w, h } = stageCenter();
      p.current.onViewChange(fitView(p.current.doc.width, p.current.doc.height, w, h));
    },
    zoomStep: (dir) => {
      const { w, h } = stageCenter();
      const v = p.current.view;
      p.current.onViewChange(zoomAround(v, stepZoom(v.zoom, dir), w / 2, h / 2));
    },
    cancel: cancelStroke,
  };

  useEffect(() => {
    const stage = stageRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = p.current.view;
      if (!v.zoom) return;
      const r = stage.getBoundingClientRect();
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
      if (!e.ctrlKey && !mouseWheel) {
        p.current.onViewChange({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
        return;
      }
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const zoom = clampZoom(v.zoom * Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018)));
      p.current.onViewChange(zoomAround(v, zoom, e.clientX - r.left, e.clientY - r.top));
    };
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        e.preventDefault();
        if (!keys.current.space) {
          keys.current.space = true;
          setGrabbing('grab');
          invalidate();
        }
      }
      if (e.key === 'Escape' && stroke.current) cancelStroke();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        keys.current.space = false;
        setGrabbing('none');
        invalidate();
      }
    };
    const onBlur = () => {
      keys.current.space = false;
      setGrabbing('none');
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const toArt = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { zoom, x, y } = p.current.view;
    return { x: Math.floor((e.clientX - r.left - x) / zoom), y: Math.floor((e.clientY - r.top - y) / zoom) };
  };

  const inBounds = (pt: Point) => pt.x >= 0 && pt.y >= 0 && pt.x < p.current.doc.width && pt.y < p.current.doc.height;

  const canMoveSelection = (pt: Point, alt: boolean, shift: boolean) => {
    const { selection, tool } = p.current;
    if (!selection) return false;
    if (tool === 'move') return true;
    return tool === 'select' && !alt && !shift && isSelected(selection, pt.x, pt.y);
  };

  const updateHover = (pt: Point | null) => {
    hoverPx.current = pt && inBounds(pt) ? pt : null;
    const hp = hoverPx.current;
    if (!hp) setHover(null);
    else {
      const v = topPixel(p.current.doc, p.current.frame, hp.x, hp.y);
      setHover({ x: hp.x, y: hp.y, color: v ? unpackHex(v) : null });
    }
    invalidate();
  };

  const hideLoupe = () => {
    const el = loupeRef.current;
    if (el && !el.hidden) el.hidden = true;
  };

  const updateLoupe = (e: ReactPointerEvent<HTMLCanvasElement>, pt: Point) => {
    const el = loupeRef.current;
    const stage = stageRef.current;
    const s = stroke.current;
    const picking = s?.kind === 'pick' || (!s && (p.current.tool === 'picker' || (e.altKey && p.current.tool !== 'select')) && !keys.current.space);
    if (!el || !stage || !picking || !inBounds(pt)) return hideLoupe();
    const v = topPixel(p.current.doc, p.current.frame, pt.x, pt.y);
    const hex = v ? unpackHex(v) : null;
    el.style.setProperty('--loupe-color', hex ?? 'transparent');
    el.classList.toggle('empty', !hex);
    loupeHex.current!.textContent = hex ? hex.toUpperCase() : t('Empty');
    el.hidden = false;
    const r = stage.getBoundingClientRect();
    const gap = e.pointerType === 'touch' ? 40 : 16;
    let lx = e.clientX - r.left + gap;
    let ly = e.clientY - r.top + gap;
    if (lx + el.offsetWidth > r.width) lx = e.clientX - r.left - gap - el.offsetWidth;
    if (ly + el.offsetHeight > r.height) ly = e.clientY - r.top - gap - el.offsetHeight;
    el.style.transform = `translate(${lx}px, ${ly}px)`;
  };

  const plot = (cel: Cel, x: number, y: number, value: number, size: number) => {
    const { doc, options } = p.current;
    let changed = stamp(cel, doc.width, doc.height, x, y, size, value);
    if (options.mirror) changed = stamp(cel, doc.width, doc.height, doc.width - 1 - x - ((size + 1) % 2), y, size, value) || changed;
    return changed;
  };

  const pick = (pt: Point, secondary: boolean) => {
    if (!inBounds(pt)) return;
    const v = topPixel(p.current.doc, p.current.frame, pt.x, pt.y);
    if (v) p.current.onPick(unpackHex(v), secondary);
  };

  const renderShape = (s: Extract<Stroke, { kind: 'shape' }>, end: Point, constrain: boolean) => {
    const { options } = p.current;
    if (s.base) s.cel.set(s.base);
    else s.cel.fill(0);
    let e = end;
    const ddx = end.x - s.start.x;
    const ddy = end.y - s.start.y;
    if (constrain && s.shape === 'line') {
      if (Math.abs(ddx) > 2 * Math.abs(ddy)) e = { x: end.x, y: s.start.y };
      else if (Math.abs(ddy) > 2 * Math.abs(ddx)) e = { x: s.start.x, y: end.y };
      else {
        const d = Math.max(Math.abs(ddx), Math.abs(ddy));
        e = { x: s.start.x + Math.sign(ddx) * d, y: s.start.y + Math.sign(ddy) * d };
      }
    } else if (constrain) {
      const d = Math.max(Math.abs(ddx), Math.abs(ddy));
      e = { x: s.start.x + (Math.sign(ddx) || 1) * d, y: s.start.y + (Math.sign(ddy) || 1) * d };
    }
    const visit = (x: number, y: number) => {
      plot(s.cel, x, y, s.value, options.brush);
    };
    if (s.shape === 'line') linePoints(s.start, e, visit);
    else if (s.shape === 'rect') rectPoints(s.start, e, options.fillShapes, visit);
    else ellipsePoints(s.start, e, options.fillShapes, visit);
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    stroke.current = {
      kind: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: p.current.view,
    };
    hoverPx.current = null;
    invalidate();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const props = p.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    props.onInteract();
    if (e.pointerType === 'touch' && pointers.current.size === 2) {
      startPinch();
      return;
    }
    if (stroke.current) return;
    if (e.button === 1 || keys.current.space || props.tool === 'hand') {
      e.preventDefault();
      stroke.current = { kind: 'pan', id: e.pointerId, startX: e.clientX, startY: e.clientY, view: props.view };
      setGrabbing('grabbing');
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const secondary = e.button === 2;
    const pt = toArt(e);
    if ((e.altKey && props.tool !== 'select') || props.tool === 'picker') {
      pick(pt, secondary);
      stroke.current = { kind: 'pick', id: e.pointerId, secondary };
      updateLoupe(e, pt);
      return;
    }
    if (!secondary && canMoveSelection(pt, e.altKey, e.shiftKey)) {
      if (!props.layer.visible) {
        props.onBlocked(t('This layer is hidden. Show it to move pixels.'));
        return;
      }
      const lift = props.liftSelection();
      if (!lift) return;
      stroke.current = { kind: 'selmove', id: e.pointerId, lift, cel: liftedCel(lift, lift.dx, lift.dy), start: pt, dx: lift.dx, dy: lift.dy };
      setGrabbing('grabbing');
      invalidate();
      return;
    }
    if (props.tool === 'select') {
      if (secondary) return;
      const op: SelectOp = e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : props.options.selectOp;
      const shiftOp = e.shiftKey;
      stroke.current = { kind: 'select', id: e.pointerId, mode: props.options.selectMode, op, shiftOp, start: pt, end: pt, points: [pt], moved: false, square: e.shiftKey && !shiftOp };
      invalidate();
      return;
    }
    if (!props.layer.visible) {
      props.onBlocked(t('This layer is hidden. Show it to draw.'));
      return;
    }
    const { doc, frame, layer, tool, options } = props;
    const base = getCel(doc, frame, layer.id);
    const cel = base ? base.slice() : new Uint32Array(doc.width * doc.height);
    const value = tool === 'eraser' ? 0 : packHex(secondary ? props.secondary : props.primary);
    if (tool === 'fill') {
      if (!inBounds(pt)) return;
      let changed = floodFill(cel, doc.width, doc.height, pt.x, pt.y, value, options.contiguous);
      if (options.mirror) changed = floodFill(cel, doc.width, doc.height, doc.width - 1 - pt.x, pt.y, value, options.contiguous) || changed;
      if (changed) props.onCommit(cel, value);
      return;
    }
    if (tool === 'pencil' || tool === 'eraser') {
      const changed = plot(cel, pt.x, pt.y, value, options.brush);
      stroke.current = { kind: 'paint', id: e.pointerId, base, cel, value, last: pt, changed };
    } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      const s: Stroke = { kind: 'shape', id: e.pointerId, base, cel, value, start: pt, shape: tool };
      stroke.current = s;
      renderShape(s, pt, e.shiftKey);
    } else if (tool === 'move') {
      stroke.current = { kind: 'move', id: e.pointerId, base: base ?? cel, cel, start: pt };
    }
    invalidate();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = stroke.current;
    if (s?.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const r = canvasRef.current!.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoom = clampZoom((s.view.zoom * dist) / s.dist);
      const zoomed = zoomAround(s.view, zoom, s.mid.x - r.left, s.mid.y - r.top);
      p.current.onViewChange({ zoom, x: zoomed.x + mid.x - s.mid.x, y: zoomed.y + mid.y - s.mid.y });
      return;
    }
    const pt = toArt(e);
    if (e.pointerType !== 'touch' || s) {
      updateHover(pt);
      updateLoupe(e, pt);
    }
    const over = !s && p.current.tool === 'select' && canMoveSelection(pt, e.altKey, e.shiftKey);
    if (over !== overSelection) setOverSelection(over);
    if (!s || s.id !== e.pointerId) return;
    const { doc, options } = p.current;
    if (s.kind === 'pan') {
      p.current.onViewChange({ ...s.view, x: s.view.x + e.clientX - s.startX, y: s.view.y + e.clientY - s.startY });
    } else if (s.kind === 'pick') {
      pick(pt, s.secondary);
    } else if (s.kind === 'select') {
      s.square = e.shiftKey && !s.shiftOp;
      if (pt.x !== s.end.x || pt.y !== s.end.y) {
        s.moved = true;
        s.end = pt;
        if (s.mode === 'lasso') s.points.push(pt);
      }
      invalidate();
    } else if (s.kind === 'paint') {
      linePoints(s.last, pt, (x, y) => {
        if (plot(s.cel, x, y, s.value, options.brush)) s.changed = true;
      });
      s.last = pt;
      invalidate();
    } else if (s.kind === 'shape') {
      renderShape(s, pt, e.shiftKey);
      invalidate();
    } else if (s.kind === 'move') {
      s.cel = shiftCel(s.base, doc.width, doc.height, pt.x - s.start.x, pt.y - s.start.y);
      invalidate();
    } else if (s.kind === 'selmove') {
      const dx = s.lift.dx + pt.x - s.start.x;
      const dy = s.lift.dy + pt.y - s.start.y;
      if (dx === s.dx && dy === s.dy) return;
      s.dx = dx;
      s.dy = dy;
      s.cel = liftedCel(s.lift, dx, dy);
      invalidate();
    }
  };

  const finish = (e: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    const s = stroke.current;
    if (!s) return;
    if (s.kind === 'pinch') {
      if (pointers.current.size === 0) stroke.current = null;
      return;
    }
    if (s.id !== e.pointerId) return;
    const { doc } = p.current;
    stroke.current = null;
    if (s.kind === 'pan' || s.kind === 'selmove') setGrabbing(keys.current.space ? 'grab' : 'none');
    if (s.kind === 'pick') p.current.onPickEnd();
    if (!cancelled) {
      if (s.kind === 'select') {
        const { width, height } = doc;
        if (!s.moved) {
          if (s.op === 'replace') p.current.onSelect(null);
        } else {
          const next = s.mode === 'rect' ? selectRect(width, height, rectBounds(s.start, s.end, s.square)) : selectLasso(width, height, s.points);
          p.current.onSelect(combineSelection(p.current.selection, next, s.op));
        }
      } else if (s.kind === 'selmove') {
        if (s.dx !== s.lift.dx || s.dy !== s.lift.dy) p.current.onMoveSelection(s.lift, s.dx, s.dy);
      } else if (s.kind === 'paint' && s.changed) p.current.onCommit(s.cel, s.value);
      else if ((s.kind === 'shape' || s.kind === 'move') && !sameCel(s.base, s.cel)) p.current.onCommit(s.cel, s.kind === 'shape' ? s.value : 0);
    }
    if (e.pointerType === 'touch') {
      updateHover(null);
      hideLoupe();
    }
    invalidate();
  };

  const startTransform = (handle: TransformHandle, e: ReactPointerEvent<HTMLElement>) => {
    const props = p.current;
    e.preventDefault();
    e.stopPropagation();
    if (stroke.current) return;
    if (e.button === 1 || keys.current.space) {
      canvasRef.current!.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stroke.current = { kind: 'pan', id: e.pointerId, startX: e.clientX, startY: e.clientY, view: props.view };
      setGrabbing('grabbing');
      return;
    }
    if (e.button !== 0) return;
    props.onInteract();
    const lift = props.liftSelection();
    if (!lift) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const from = liftPlacement(lift);
    stroke.current = { kind: 'seltransform', id: e.pointerId, lift, cel: liftedCel(lift, lift.dx, lift.dy), handle, start: { x: e.clientX, y: e.clientY }, from, pl: from };
    setLive(from);
    invalidate();
  };

  const moveTransform = (e: ReactPointerEvent<HTMLElement>) => {
    const s = stroke.current;
    if (s?.kind !== 'seltransform' || s.id !== e.pointerId) return;
    const { view } = p.current;
    const { from } = s;
    let pl: Placement;
    if (s.handle === 'rotate') {
      const r = canvasRef.current!.getBoundingClientRect();
      const cx = r.left + view.x + from.cx * view.zoom;
      const cy = r.top + view.y + from.cy * view.zoom;
      const turn = Math.PI * 2;
      let angle = from.angle + Math.atan2(e.clientY - cy, e.clientX - cx) - Math.atan2(s.start.y - cy, s.start.x - cx);
      angle = ((((angle + Math.PI) % turn) + turn) % turn) - Math.PI;
      const step = e.shiftKey ? Math.PI / 12 : Math.PI / 2;
      const snapped = Math.round(angle / step) * step;
      if (e.shiftKey || Math.abs(angle - snapped) < 0.05) angle = snapped;
      if (Math.abs(Math.abs(angle) - Math.PI) < 1e-9) angle = Math.PI;
      pl = { ...from, angle };
    } else {
      const cos = Math.cos(from.angle);
      const sin = Math.sin(from.angle);
      const ddx = (e.clientX - s.start.x) / view.zoom;
      const ddy = (e.clientY - s.start.y) / view.zoom;
      const lx = ddx * cos + ddy * sin;
      const ly = ddy * cos - ddx * sin;
      const sx = s.handle.includes('e') ? 1 : s.handle.includes('w') ? -1 : 0;
      const sy = s.handle.includes('s') ? 1 : s.handle.includes('n') ? -1 : 0;
      const k = e.altKey ? 2 : 1;
      let w = from.w + sx * lx * k;
      let h = from.h + sy * ly * k;
      if (sx && sy && e.shiftKey) {
        const f = Math.max(w / from.w, h / from.h);
        w = from.w * f;
        h = from.h * f;
      }
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));
      const ox = e.altKey ? 0 : (sx * (w - from.w)) / 2;
      const oy = e.altKey ? 0 : (sy * (h - from.h)) / 2;
      pl = { ...from, w, h, cx: from.cx + ox * cos - oy * sin, cy: from.cy + ox * sin + oy * cos };
    }
    pl = snapPlacement(pl);
    if (samePlacement(pl, s.pl)) return;
    s.pl = pl;
    const next = withPlacement(s.lift, pl);
    s.cel = liftedCel(next.lift, next.dx, next.dy);
    setLive(pl);
    invalidate();
  };

  const endTransform = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = stroke.current;
    if (s?.kind !== 'seltransform' || s.id !== e.pointerId) return;
    stroke.current = null;
    setLive(null);
    if (!cancelled && !samePlacement(s.pl, s.from)) {
      const next = withPlacement(s.lift, s.pl);
      p.current.onMoveSelection(next.lift, next.dx, next.dy);
    }
    invalidate();
  };

  const startRefDrag = (mode: RefHandle | 'move', e: ReactPointerEvent<HTMLElement>) => {
    const props = p.current;
    const ref = props.reference;
    if (!ref) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 1 || keys.current.space || props.tool === 'hand') {
      if (stroke.current) return;
      canvasRef.current!.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stroke.current = { kind: 'pan', id: e.pointerId, startX: e.clientX, startY: e.clientY, view: props.view };
      setGrabbing('grabbing');
      return;
    }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    refPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (refPointers.current.size === 2) {
      const [a, b] = [...refPointers.current.values()];
      refDrag.current = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ref };
      return;
    }
    if (refPointers.current.size > 2) return;
    refDrag.current = { mode, id: e.pointerId, crop: props.refMode === 'crop', startX: e.clientX, startY: e.clientY, ref };
  };

  const moveRefDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (refPointers.current.has(e.pointerId)) refPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = refDrag.current;
    if (!d) return;
    const { view, onReferenceChange } = p.current;
    if (d.mode === 'pinch') {
      if (refPointers.current.size < 2) return;
      const [a, b] = [...refPointers.current.values()];
      const r = canvasRef.current!.getBoundingClientRect();
      const toDoc = (pt: Point) => ({ x: (pt.x - r.left - view.x) / view.zoom, y: (pt.y - r.top - view.y) / view.zoom });
      const from = toDoc(d.mid);
      const to = toDoc({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const scaled = scaleReference(d.ref, (Math.hypot(a.x - b.x, a.y - b.y) || 1) / d.dist, from.x, from.y);
      onReferenceChange({ ...scaled, x: scaled.x + to.x - from.x, y: scaled.y + to.y - from.y });
      return;
    }
    if (d.id !== e.pointerId) return;
    const dx = (e.clientX - d.startX) / view.zoom;
    const dy = (e.clientY - d.startY) / view.zoom;
    if (d.mode === 'move') onReferenceChange(d.crop ? panCrop(d.ref, dx, dy) : { ...d.ref, x: d.ref.x + dx, y: d.ref.y + dy });
    else onReferenceChange(d.crop ? cropReference(d.ref, d.mode, dx, dy) : resizeReference(d.ref, d.mode, dx, dy, e.shiftKey));
  };

  const endRefDrag = (e: ReactPointerEvent<HTMLElement>) => {
    refPointers.current.delete(e.pointerId);
    const d = refDrag.current;
    if (!d) return;
    if (d.mode === 'pinch' ? refPointers.current.size < 2 : d.id === e.pointerId) refDrag.current = null;
  };

  const { view, reference, refEdit, refMode, tool, doc } = props;
  const cursor =
    grabbing === 'grabbing' ? 'grabbing' : grabbing === 'grab' || tool === 'hand' ? 'grab' : tool === 'move' || (overSelection && tool === 'select' && props.selection) ? 'move' : 'crosshair';
  const cropping = refMode === 'crop';
  const full = reference && cropping ? fullRect(reference) : null;
  const boxW = reference ? reference.width * view.zoom : 0;
  const boxH = reference ? reference.height * view.zoom : 0;
  const editingRef = refEdit && reference && view.zoom > 0;
  const transformable = !editingRef && view.zoom > 0 && (tool === 'select' || tool === 'move') && props.selection && props.layer.visible && grabbing !== 'grabbing';
  const placed = live ?? (transformable ? liftPlacement(props.liftSelection()!) : null);
  const boxPx = placed && { w: placed.w * view.zoom, h: placed.h * view.zoom };

  return (
    <div
      ref={stageRef}
      className="canvas-stage"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const file = e.dataTransfer.files[0];
        if (!file?.type.startsWith('image/')) return;
        e.preventDefault();
        props.onDropImage(file);
      }}
    >
      <canvas
        ref={canvasRef}
        className="art-canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onPointerLeave={() => {
          if (!stroke.current) {
            updateHover(null);
            hideLoupe();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div ref={loupeRef} className="picker-loupe" hidden aria-hidden="true">
        <span className="picker-loupe-swatch" />
        <span ref={loupeHex} className="picker-loupe-hex" />
      </div>
      {transformable && placed && boxPx && (
        <div
          className={`selection-transform ${boxPx.w < 40 || boxPx.h < 40 ? 'compact' : ''}`}
          style={{
            left: view.x + placed.cx * view.zoom - boxPx.w / 2,
            top: view.y + placed.cy * view.zoom - boxPx.h / 2,
            width: boxPx.w,
            height: boxPx.h,
            transform: placed.angle ? `rotate(${placed.angle}rad)` : undefined,
          }}
        >
          {REF_HANDLES.map((handle) => (
            <span
              key={handle}
              className={`reference-resize ${handle}`}
              style={{ cursor: handleCursor(handle, placed.angle) }}
              aria-label={t('Resize selection')}
              onPointerDown={(e) => startTransform(handle, e)}
              onPointerMove={moveTransform}
              onPointerUp={(e) => endTransform(e, false)}
              onPointerCancel={(e) => endTransform(e, true)}
              onContextMenu={(e) => e.preventDefault()}
            />
          ))}
          <span
            className="selection-rotate"
            aria-label={t('Rotate selection')}
            title={t('Rotate (hold Shift to snap 15°)')}
            onPointerDown={(e) => startTransform('rotate', e)}
            onPointerMove={moveTransform}
            onPointerUp={(e) => endTransform(e, false)}
            onPointerCancel={(e) => endTransform(e, true)}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      )}
      {editingRef && full && (
        <div
          className="reference-full"
          style={{ left: view.x + full.x * view.zoom, top: view.y + full.y * view.zoom, width: full.width * view.zoom, height: full.height * view.zoom }}
        />
      )}
      {editingRef && (
        <div
          className={`reference-transform ${cropping ? 'cropping' : ''} ${boxW < 56 || boxH < 56 ? 'compact' : ''}`}
          style={{ left: view.x + reference.x * view.zoom, top: view.y + reference.y * view.zoom, width: boxW, height: boxH, cursor: grabbing !== 'none' || tool === 'hand' ? cursor : undefined }}
          onPointerDown={(e) => startRefDrag('move', e)}
          onPointerMove={moveRefDrag}
          onPointerUp={endRefDrag}
          onPointerCancel={endRefDrag}
          onContextMenu={(e) => e.preventDefault()}
        >
          {REF_HANDLES.map((handle) => (
            <span
              key={handle}
              className={`reference-resize ${handle}`}
              aria-label={cropping ? t('Crop reference') : t('Resize reference')}
              onPointerDown={(e) => startRefDrag(handle, e)}
              onPointerMove={moveRefDrag}
              onPointerUp={endRefDrag}
              onPointerCancel={endRefDrag}
            />
          ))}
        </div>
      )}
      {editingRef && (
        <div className="reference-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <div className="segmented small">
            <button className={!cropping ? 'active' : ''} onClick={() => props.onRefModeChange('move')} title={t('Move and resize the image')}>
              <Icon name="move" size={13} /> {t('Move')}
            </button>
            <button className={cropping ? 'active' : ''} onClick={() => props.onRefModeChange('crop')} title={t('Choose which part of the image shows')}>
              <Icon name="crop" size={13} /> {t('Crop')}
            </button>
          </div>
          <span className="reference-toolbar-sep" />
          <button className="reference-tool" title={t('Fit inside the canvas')} onClick={() => props.onReferenceChange(placeReference(reference, doc.width, doc.height, false))}>
            <Icon name="fit" size={13} /> {t('Fit')}
          </button>
          <button className="reference-tool" title={t('Fill the whole canvas')} onClick={() => props.onReferenceChange(placeReference(reference, doc.width, doc.height, true))}>
            <Icon name="resize" size={13} /> {t('Fill')}
          </button>
          {reference.crop && (
            <button className="reference-tool" title={t('Show the whole image again')} onClick={() => props.onReferenceChange(resetCrop(reference))}>
              <Icon name="undo" size={13} /> {t('Uncrop')}
            </button>
          )}
          <button className="reference-done" onClick={props.onRefEditDone}>
            <Icon name="check" size={13} /> {t('Done')}
          </button>
        </div>
      )}
    </div>
  );
}
