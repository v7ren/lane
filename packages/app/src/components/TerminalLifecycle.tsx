import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { PaneData } from '../hooks/usePaneRegistry';
import type { BottomPanelTab } from '../lib/shell-selection-context';
import { isAgentSessionPane, isUserShellPane } from '../lib/pane-surface';
import {
  ensureTerminalSession,
  reparentTerminalSession,
} from '../terminal/terminal-session-registry';

export function TerminalLifecycle({
  panes,
  bottomTab,
  agentPaneId,
  showTui,
  selectedTerminalPaneId,
  subscribePaneData,
}: {
  panes: PaneData[];
  bottomTab: BottomPanelTab;
  agentPaneId: string | null;
  showTui: boolean;
  selectedTerminalPaneId: string | null;
  subscribePaneData: (paneId: string, cb: (data: Uint8Array) => void) => () => void;
}) {
  const layoutVersion = useRef(0);
  const paneSignature = useMemo(
    () =>
      panes
        .map((p) => `${p.info.id}:${p.info.created_at}:${p.info.surface ?? ''}`)
        .join('|'),
    [panes],
  );
  const panesRef = useRef(panes);
  panesRef.current = panes;

  useEffect(() => {
    for (const pane of panesRef.current) {
      if (pane.info.surface === 'headless') continue;
      ensureTerminalSession(pane.info.id, pane.info.created_at, subscribePaneData);
    }
  }, [paneSignature, subscribePaneData]);

  useLayoutEffect(() => {
    layoutVersion.current += 1;
    const pass = layoutVersion.current;

    for (const pane of panesRef.current) {
      if (pane.info.surface === 'headless') continue;
      const paneId = pane.info.id;
      ensureTerminalSession(paneId, pane.info.created_at, subscribePaneData);
      const isAgent = isAgentSessionPane(pane.info.agent_type);
      const isShell = isUserShellPane(pane.info.agent_type);

      const agentTuiVisible =
        isAgent && bottomTab === 'agent' && agentPaneId === paneId && showTui;
      const terminalTabVisible =
        isShell && bottomTab === 'terminal' && selectedTerminalPaneId === paneId;

      let host: HTMLElement | null = null;
      if (agentTuiVisible || terminalTabVisible) {
        host = document.querySelector(`[data-terminal-host="${paneId}"]`);
      }
      reparentTerminalSession(paneId, host instanceof HTMLElement ? host : null);
    }

    const frame = requestAnimationFrame(() => {
      if (pass !== layoutVersion.current) return;
      for (const pane of panesRef.current) {
        if (pane.info.surface === 'headless') continue;
        ensureTerminalSession(pane.info.id, pane.info.created_at, subscribePaneData).nudgeReflow();
      }
    });

    return () => {
      layoutVersion.current += 1;
      cancelAnimationFrame(frame);
    };
  }, [agentPaneId, bottomTab, paneSignature, selectedTerminalPaneId, showTui, subscribePaneData]);

  return null;
}
