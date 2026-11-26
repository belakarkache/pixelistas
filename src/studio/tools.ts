import { msg } from './i18n';
import type { SelectMode, SelectOp } from './selection';

export type Tool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'ellipse' | 'move' | 'select' | 'hand';

export type ToolOptions = { brush: number; mirror: boolean; fillShapes: boolean; contiguous: boolean; selectMode: SelectMode; selectOp: SelectOp };

export type View = { zoom: number; x: number; y: number };

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'pencil', label: msg('Pencil'), key: 'B', hint: msg('Left click: main color · Right click: second color') },
  { id: 'eraser', label: msg('Eraser'), key: 'E', hint: msg('Drag to erase pixels') },
  { id: 'fill', label: msg('Fill'), key: 'G', hint: msg('Click an area to fill it') },
  { id: 'picker', label: msg('Color picker'), key: 'I', hint: msg('Click a pixel to grab its color · Tip: hold Alt with any tool') },
  { id: 'line', label: msg('Line'), key: 'L', hint: msg('Drag to draw a line · Shift snaps to 45°') },
  { id: 'rect', label: msg('Rectangle'), key: 'U', hint: msg('Drag to draw · Shift makes a square') },
  { id: 'ellipse', label: msg('Ellipse'), key: 'O', hint: msg('Drag to draw · Shift makes a circle') },
  { id: 'move', label: msg('Move layer'), key: 'V', hint: msg('Drag to move the layer, or only the selected pixels · Arrow keys nudge 1px') },
  { id: 'select', label: msg('Select'), key: 'S', hint: msg('Drag to select · Drag inside the selection to move it · Arrows nudge · Shift adds · Alt subtracts · Shift+Alt intersects · S switches rectangle / lasso') },
  { id: 'hand', label: msg('Hand'), key: 'H', hint: msg('Drag to pan · Tip: hold Space with any tool') },
];

const ZOOM_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function stepZoom(zoom: number, dir: 1 | -1) {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6) ?? MIN_ZOOM;
}

export function fitView(docW: number, docH: number, stageW: number, stageH: number): View {
  const raw = Math.min((stageW * 0.86) / docW, (stageH * 0.86) / docH);
  const zoom = clampZoom(raw >= 1 ? Math.floor(raw) : raw);
  return { zoom, x: Math.round((stageW - docW * zoom) / 2), y: Math.round((stageH - docH * zoom) / 2) };
}
