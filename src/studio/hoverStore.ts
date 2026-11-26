import { useSyncExternalStore } from 'react';

type Hover = { x: number; y: number; color: string | null } | null;

let hover: Hover = null;
const listeners = new Set<() => void>();

export function setHover(next: Hover) {
  if (next === hover || (next && hover && next.x === hover.x && next.y === hover.y && next.color === hover.color)) return;
  hover = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useHover = () => useSyncExternalStore(subscribe, () => hover);
