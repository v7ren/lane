import type { DisplayStatus } from '../lib/display-status';
import { DISPLAY_STATUS_LABEL, displayStatusCssVar } from '../lib/display-status';

export function DisplayStatusDot({
  status,
  pulse,
  className = '',
}: {
  status: DisplayStatus;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${pulse ? 'lr-status-pulse' : ''} ${className}`}
      style={{ backgroundColor: displayStatusCssVar(status) }}
      title={DISPLAY_STATUS_LABEL[status]}
      aria-label={DISPLAY_STATUS_LABEL[status]}
    />
  );
}
