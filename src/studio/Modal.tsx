import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useT } from './i18n';

type Props = { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string };

export function Modal({ title, subtitle, onClose, children, wide, className }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, button.primary-button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const shades = document.querySelectorAll('.modal-shade');
      if (shades[shades.length - 1] !== ref.current?.parentElement) return;
      if (document.querySelector('.context-menu, .color-popover.is-open')) return;
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="modal-shade" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''} ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button className="icon-button dialog-close" onClick={onClose} aria-label={t('Close')}>
          <Icon name="close" size={16} />
        </button>
        <h2>{title}</h2>
        {subtitle && <p className="dialog-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirm,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal title={title} onClose={onClose}>
      <p className="dialog-text">{message}</p>
      <div className="dialog-actions">
        <button className="ghost-button" onClick={onClose}>
          {t('Cancel')}
        </button>
        <button
          className={danger ? 'danger-button' : 'primary-button'}
          data-autofocus
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirm}
        </button>
      </div>
    </Modal>
  );
}

export function PromptDialog({
  title,
  label,
  initial,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  initial: string;
  confirm: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = String(new FormData(e.currentTarget).get('value') ?? '').trim();
          if (!value) return;
          onConfirm(value);
          onClose();
        }}
      >
        <label className="field-label" htmlFor="prompt-value">
          {label}
        </label>
        <input id="prompt-value" name="value" className="text-input" defaultValue={initial} maxLength={60} onFocus={(e) => e.currentTarget.select()} />
        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="primary-button">
            {confirm}
          </button>
        </div>
      </form>
    </Modal>
  );
}
