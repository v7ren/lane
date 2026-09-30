import type { ReactNode } from 'react';
import { FolderKanban, LayoutList, Network, Settings } from 'lucide-react';
import type { ActivityRailSection } from '../../lib/shell-selection-context';

const iconClass = 'shrink-0';

export function ActivityRail({
  section,
  onSectionChange,
  onOpenSettings,
  onOpenPorts,
}: {
  section: ActivityRailSection;
  onSectionChange: (section: ActivityRailSection) => void;
  onOpenSettings: () => void;
  onOpenPorts?: () => void;
}) {
  return (
    <nav
      className="w-12 shrink-0 flex flex-col items-center border-r border-border-subtle bg-canvas py-2 gap-1"
      aria-label="Activity"
      data-testid="activity-rail"
    >
      <RailButton
        label="Sessions"
        active={section === 'sessions'}
        onClick={() => onSectionChange('sessions')}
      >
        <LayoutList size={16} strokeWidth={1.5} className={iconClass} />
      </RailButton>
      <RailButton
        label="Workspaces"
        active={section === 'workspaces'}
        onClick={() => onSectionChange('workspaces')}
      >
        <FolderKanban size={16} strokeWidth={1.5} className={iconClass} />
      </RailButton>
      <div className="flex-1" />
      {onOpenPorts && (
        <RailButton label="Ports" active={false} onClick={onOpenPorts}>
          <Network size={16} strokeWidth={1.5} className={iconClass} />
        </RailButton>
      )}
      <RailButton label="Settings" active={false} onClick={onOpenSettings}>
        <Settings size={16} strokeWidth={1.5} className={iconClass} />
      </RailButton>
    </nav>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`w-9 h-9 flex items-center justify-center rounded-md transition-colors duration-ui ${
        active ? 'bg-elevated text-text' : 'text-text-3 hover:text-text-2 hover:bg-hover'
      }`}
    >
      {children}
    </button>
  );
}
