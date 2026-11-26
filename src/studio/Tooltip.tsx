import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY = 350;
const GAP = 8;
const EDGE = 6;

type Tip = { text: string; rect: DOMRect };

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let saved = '';
    let timer = 0;

    const release = () => {
      window.clearTimeout(timer);
      if (target && saved && !target.hasAttribute('title')) target.setAttribute('title', saved);
      target = null;
      saved = '';
      setTip(null);
      setPos(null);
    };

    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest<HTMLElement>('[title]');
      if (!el || el === target) return;
      const text = el.getAttribute('title');
      if (!text) return;
      release();
      target = el;
      saved = text;
      el.removeAttribute('title');
      timer = window.setTimeout(() => {
        if (target === el && el.isConnected) setTip({ text, rect: el.getBoundingClientRect() });
      }, SHOW_DELAY);
    };

    const out = (e: PointerEvent) => {
      if (!target) return;
      const to = e.relatedTarget as Node | null;
      if (to && target.contains(to)) return;
      release();
    };

    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', release);
    document.addEventListener('keydown', release);
    document.addEventListener('scroll', release, true);
    window.addEventListener('blur', release);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', release);
      document.removeEventListener('keydown', release);
      document.removeEventListener('scroll', release, true);
      window.removeEventListener('blur', release);
      release();
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const { rect } = tip;
    const below = rect.top - height - GAP < EDGE;
    const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - EDGE);
    const top = below ? rect.bottom + GAP : rect.top - height - GAP;
    setPos({ left, top, below });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={ref} role="tooltip" className={`tooltip ${pos ? 'show' : ''} ${pos?.below ? 'below' : ''}`} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}>
      {tip.text}
    </div>,
    document.body,
  );
}
