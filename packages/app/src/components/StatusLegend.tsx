import type { DisplayStatus } from '../lib/display-status';
import { DISPLAY_STATUS_LABEL, displayStatusTextClass } from '../lib/display-status';
import { DisplayStatusDot } from './DisplayStatusDot';

const LEGEND: DisplayStatus[] = [
  'needs_approval',
  'waiting',
  'working',
  'done',
  'idle',
  'error',
  'rate_limited',
];

export function StatusLegend({ compact }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] ${compact ? '' : 'px-3 py-1 border-t border-lr-border'}`}
      role="list"
      aria-label="Session status legend"
    >
      {LEGEND.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5" role="listitem">
          <DisplayStatusDot status={status} />
          <span className={displayStatusTextClass(status)}>{DISPLAY_STATUS_LABEL[status]}</span>
        </span>
      ))}
    </div>
  );
}
