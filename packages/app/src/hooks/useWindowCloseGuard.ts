import { useEffect } from 'react';
import type { CloseRequestedEvent } from '@tauri-apps/api/window';
import { isTauriRuntime } from '../lib/is-tauri';
import { tauri } from '../lib/tauri';

export type CloseRequestReason = 'user-gesture' | 'unknown';

function logCloseRequest(reason: CloseRequestReason, agentPaneCount: number): void {
  const detail = { reason, agentPaneCount, at: new Date().toISOString() };
  console.info('[loomria] close requested', detail);
}

function isAgentPane(agentType: string | undefined): boolean {
  if (!agentType) return false;
  if (agentType === 'powershell') return false;
  return !agentType.includes('orchestrator');
}

export function useWindowCloseGuard(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    void tauri
      .onCurrentWindowCloseRequested(async (event: CloseRequestedEvent) => {
        const panes = await tauri.listPanes();
        const agents = panes.filter((p) => isAgentPane(p.agent_type));
        logCloseRequest('user-gesture', agents.length);
        if (agents.length === 0) {
          return;
        }
        event.preventDefault();
        const n = agents.length;
        const ok = window.confirm(
          `${n} agent session${n === 1 ? '' : 's'} are running — close Loomria?`,
        );
        if (ok) {
          await tauri.closeCurrentWindow();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, []);
}
