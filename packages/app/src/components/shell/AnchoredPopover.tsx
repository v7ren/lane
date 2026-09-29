import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

function clampToViewport(rect: DOMRect, width: number, height: number): { left: number; top: number } {
  const pad = 8;
  const left = Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad));
  const top = Math.max(pad, Math.min(rect.bottom + 4, window.innerHeight - height - pad));
  return { left, top };
}

export function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  children,
  testId,
  minWidth = 200,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  minWidth?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const w = panel?.offsetWidth ?? minWidth;
      const h = panel?.offsetHeight ?? 200;
      setPos(clampToViewport(rect, w, h));
    };
    update();
    requestAnimationFrame(update);
  }, [anchorRef, minWidth, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  const anchor = anchorRef.current;
  const fallback =
    anchor != null
      ? clampToViewport(anchor.getBoundingClientRect(), minWidth, 200)
      : { left: 8, top: 8 };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[200]" onMouseDown={onClose} aria-hidden />
      <div
        ref={panelRef}
        className="fixed z-[201] rounded-lg border border-border bg-elevated shadow-xl py-1"
        style={{ left: (pos ?? fallback).left, top: (pos ?? fallback).top, minWidth }}
        data-testid={testId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
