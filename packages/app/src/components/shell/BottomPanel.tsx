import type { AgentCatalog } from '@loomria/shared';
import type { ReactNode } from 'react';
import type { BottomPanelTab } from '../../lib/shell-selection-context';

export function BottomPanel({
  tab,
  onTabChange,
  agentContent,
  terminalContent,
}: {
  tab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  agentContent: ReactNode;
  terminalContent: ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-0 h-full bg-surface border-t border-border-subtle" data-testid="bottom-panel">
      <div className="flex shrink-0 border-b border-border-subtle">
        <PanelTab
          label="AGENT"
          active={tab === 'agent'}
          onClick={() => onTabChange('agent')}
          testId="bottom-tab-agent"
        />
        <PanelTab
          label="TERMINAL"
          active={tab === 'terminal'}
          onClick={() => onTabChange('terminal')}
          testId="bottom-tab-terminal"
        />
      </div>
      <div className="flex-1 min-h-0 relative">
        <div
          className={`absolute inset-0 flex flex-col min-h-0 ${tab === 'agent' ? '' : 'hidden'}`}
          data-bottom-panel-view="agent"
        >
          {agentContent}
        </div>
        <div
          className={`absolute inset-0 flex flex-col min-h-0 ${tab === 'terminal' ? '' : 'hidden'}`}
          data-bottom-panel-view="terminal"
        >
          {terminalContent}
        </div>
      </div>
    </div>
  );
}

function PanelTab({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`px-4 py-2 text-section-label transition-colors duration-ui border-b-2 ${
        active ? 'text-text border-accent' : 'text-text-3 border-transparent hover:text-text-2'
      }`}
    >
      {label}
    </button>
  );
}
