import type { MouseEvent as ReactMouseEvent } from 'react';

type Axis = 'horizontal' | 'vertical';

export function ResizableSplitter({
  axis,
  onDragStart,
  onDrag,
  onDoubleClick,
  'data-testid': testId,
}: {
  axis: Axis;
  onDragStart?: () => void;
  onDrag: (delta: number) => void;
  onDoubleClick?: () => void;
  'data-testid'?: string;
}) {
  const onMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault();
    onDragStart?.();
    const start = axis === 'horizontal' ? e.clientX : e.clientY;

    const onMove = (ev: MouseEvent) => {
      const current = axis === 'horizontal' ? ev.clientX : ev.clientY;
      onDrag(current - start);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const className =
    axis === 'horizontal'
      ? 'w-px shrink-0 cursor-col-resize bg-border-subtle hover:bg-accent/60 transition-colors duration-ui touch-none'
      : 'h-px shrink-0 cursor-row-resize bg-border-subtle hover:bg-accent/60 transition-colors duration-ui touch-none';

  return (
    <div
      role="separator"
      aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
      className={className}
      data-testid={testId}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
