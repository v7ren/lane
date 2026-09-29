import type { DisplayStatus } from '../lib/display-status';
import { DISPLAY_STATUS_LABEL, displayStatusCssVar } from '../lib/display-status';
import { DisplayStatusDot } from './DisplayStatusDot';

const LEGEND: DisplayStatus[] = [
  'needs_approval',
  'working',
  'done',
  'idle',
  'error',
  'rate_limited',
];

export function StatusLegend({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-lr-muted ${compact ? '' : 'px-3 py-1 border-t border-lr-border'}`}
      role="list"
      aria-label="Session status legend"
    >
      {LEGEND.map((status) => (
        <span key={status} className="inline-flex items-center gap-1" role="listitem">
          <DisplayStatusDot status={status} />
          <span style={{ color: displayStatusCssVar(status) }}>{DISPLAY_STATUS_LABEL[status]}</span>
        </span>
      ))}
    </div>
  );
}
