import { useT } from './i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { isHex, normalizeHex } from './model';
import { checkerOver, hexAlpha, hexToHsv, hsvToHex, withAlpha, type Hsv } from './colorUtils';

type PickerProps = {
  value: string;
  label: string;
  className: string;
  pulse?: number;
  onChange: (hex: string) => void;
};

const WIDTH = 220;

function useDrag(onMove: (x: number, y: number) => void) {
  const move = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
    },
    [onMove],
  );
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
    },
  };
}

export function ColorPicker({ value, label, className, pulse, onChange }: PickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hex, setHex] = useState(value);
  const [alpha, setAlpha] = useState(() => hexAlpha(value));
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const chip = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const own = useRef(value);

  useEffect(() => {
    if (value === own.current) return;
    own.current = value;
    setHsv(hexToHsv(value));
    setAlpha(hexAlpha(value));
    setHex(value);
  }, [value]);

  useEffect(() => {
    const el = chip.current;
    if (!pulse || !el?.animate) return;
    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || 'currentColor';
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const anim = el.animate(
      [
        { boxShadow: `0 0 0 1px ${accent}`, transform: 'scale(1)' },
        { boxShadow: `0 0 0 4px ${accent}`, transform: still ? 'scale(1)' : 'scale(1.12)', offset: 0.35 },
        { boxShadow: `0 0 0 1px transparent`, transform: 'scale(1)' },
      ],
      { duration: 420, easing: 'ease-out' },
    );
    return () => anim.cancel();
  }, [pulse]);

  const place = useCallback(() => {
    const r = chip.current?.getBoundingClientRect();
    if (!r) return;
    const height = pop.current?.offsetHeight ?? 270;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - WIDTH - 8);
    const below = r.bottom + 8;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 8) : below;
    setPos({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (mounted) place();
  }, [mounted, place]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || chip.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  const apply = (next: Hsv, a = alpha) => {
    setHsv(next);
    setAlpha(a);
    const out = withAlpha(hsvToHex(next), a);
    own.current = out;
    setHex(out);
    onChange(out);
  };

  const area = useDrag((x, y) => apply({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => apply({ ...hsv, h: x * 360 }));
  const alphaDrag = useDrag((x) => apply(hsv, Math.round(x * 255)));
  const solid = hsvToHex(hsv);

  const toggle = () => {
    if (open) return setOpen(false);
    setMounted(true);
    setOpen(true);
  };

  return (
    <>
      <button ref={chip} type="button" className={`color-chip ${className}`} style={{ backgroundImage: checkerOver(value) }} aria-label={label} title={label} aria-expanded={open} onClick={toggle} />
      {mounted &&
        createPortal(
          <div
            ref={pop}
            role="dialog"
            aria-label={label}
            className={`color-popover ${open ? 'is-open' : 'is-closing'}`}
            style={{ left: pos.left, top: pos.top, width: WIDTH }}
            onAnimationEnd={() => !open && setMounted(false)}
          >
            <div className="cp-area" style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} {...area}>
              <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
            </div>
            <div className="cp-hue" {...hue}>
              <span className="cp-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }} />
            </div>
            <div className="cp-alpha" style={{ ['--cp-color' as string]: solid }} {...alphaDrag}>
              <span className="cp-knob" style={{ left: `${(alpha / 255) * 100}%`, backgroundImage: checkerOver(withAlpha(solid, alpha)) }} />
            </div>
            <div className="cp-row">
              <span className="cp-preview" style={{ backgroundImage: checkerOver(withAlpha(solid, alpha)) }} />
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
                    if (v && (len === 6 || len === 8)) {
                      own.current = v;
                      setHsv(hexToHsv(v));
                      setAlpha(hexAlpha(v));
                      onChange(v);
                    }
                  }}
                  onBlur={() => setHex(own.current)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
