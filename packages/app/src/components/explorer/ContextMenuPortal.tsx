import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const MENU_MIN_W = 160;
const MENU_EST_H = 220;

function clampPosition(x: number, y: number): { left: number; top: number } {
  const pad = 8;
  const maxX = window.innerWidth - MENU_MIN_W - pad;
  const maxY = window.innerHeight - MENU_EST_H - pad;
  return {
    left: Math.max(pad, Math.min(x, maxX)),
    top: Math.max(pad, Math.min(y, maxY)),
  };
}

export function ContextMenuPortal({
  x,
  y,
  onClose,
  children,
  testId,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const menuRef = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState(() => clampPosition(x, y));

  useLayoutEffect(() => {
    const el = menuRef.current;
    const h = el?.offsetHeight ?? MENU_EST_H;
    const w = el?.offsetWidth ?? MENU_MIN_W;
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(x, window.innerWidth - w - pad)),
      top: Math.max(pad, Math.min(y, window.innerHeight - h - pad)),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[200]" onClick={onClose} aria-hidden />
      <ul
        ref={menuRef}
        className="fixed z-[201] min-w-[10rem] py-1 rounded-md border border-border-subtle bg-elevated shadow-lg text-meta"
        style={{ left: pos.left, top: pos.top }}
        data-testid={testId}
      >
        {children}
      </ul>
    </>,
    document.body,
  );
}
