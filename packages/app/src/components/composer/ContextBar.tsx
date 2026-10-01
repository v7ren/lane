export type ContextLevel = 'ok' | 'warn' | 'critical';

export function contextPercent(tokens: number, window: number): number {
  if (!(window > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((tokens / window) * 100)));
}

/** Amber at 80 % or more, red at 95 % or more. */
export function contextLevel(percent: number): ContextLevel {
  if (percent >= 95) return 'critical';
  if (percent >= 80) return 'warn';
  return 'ok';
}

const FILL: Record<ContextLevel, string> = {
  ok: 'bg-accent',
  warn: 'bg-amber-500',
  critical: 'bg-status-error',
};

/** 48x4 bar plus percentage. Renders nothing when the window or the token count is unknown. */
export function ContextBar({ tokens, window }: { tokens?: number | null; window?: number | null }) {
  if (typeof tokens !== 'number' || typeof window !== 'number' || !(window > 0)) return null;
  const percent = contextPercent(tokens, window);
  const level = contextLevel(percent);
  return (
    <div
      className="inline-flex items-center gap-1 shrink-0 text-meta text-text-3"
      data-testid="context-bar"
      data-level={level}
      title={`${tokens.toLocaleString('en-US')} of ${window.toLocaleString('en-US')} tokens`}
    >
      <span className="block w-12 h-1 rounded-full bg-border-subtle overflow-hidden">
        <span className={`block h-full ${FILL[level]}`} style={{ width: `${percent}%` }} />
      </span>
      <span>{percent}%</span>
    </div>
  );
}
