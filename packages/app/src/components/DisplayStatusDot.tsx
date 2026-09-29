import type { DisplayStatus } from '../lib/display-status';
import { DISPLAY_STATUS_LABEL, displayStatusDotClass } from '../lib/display-status';

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
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${displayStatusDotClass(status)} ${pulse ? 'lr-status-pulse' : ''} ${className}`}
      title={DISPLAY_STATUS_LABEL[status]}
      aria-label={DISPLAY_STATUS_LABEL[status]}
    />
  );
}
