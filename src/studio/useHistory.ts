import { useCallback, useRef, useState } from 'react';

const LIMIT = 100;

export function useHistory<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const current = useRef(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastKey = useRef<string | null>(null);

  const commit = useCallback((next: T, key?: string) => {
    if (next === current.current) return;
    if (!key || key !== lastKey.current) {
      past.current.push(current.current);
      if (past.current.length > LIMIT) past.current.shift();
    }
    future.current = [];
    lastKey.current = key ?? null;
    current.current = next;
    setValue(next);
  }, []);

  const step = useCallback((from: typeof past, to: typeof past) => {
    const target = from.current.pop();
    if (target === undefined) return false;
    to.current.push(current.current);
    lastKey.current = null;
    current.current = target;
    setValue(target);
    return true;
  }, []);

  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

  return {
    value,
    current,
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
