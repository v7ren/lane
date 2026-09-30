import { useEffect } from 'react';
import type { CloseRequestedEvent } from '@tauri-apps/api/window';
import { isTauriRuntime } from '../lib/is-tauri';
import {
  isAppCloseConfirmed,
  markAppCloseConfirmed,
  requestCloseConfirm,
} from '../lib/window-close-request';
import { tauri, type PaneInfo } from '../lib/tauri';

export type CloseRequestReason = 'user-gesture' | 'unknown';

const LIST_PANES_TIMEOUT_MS = 2_000;
const CLOSE_HANDLER_TIMEOUT_MS = 20_000;

function logCloseRequest(reason: CloseRequestReason, agentPaneCount: number): void {
  const detail = { reason, agentPaneCount, at: new Date().toISOString() };
  console.info('[loomria] close requested', detail);
}

function isAgentPane(agentType: string | undefined): boolean {
  if (!agentType) return false;
  if (agentType === 'powershell') return false;
  return !agentType.includes('orchestrator');
}

async function listPanesWithTimeout(): Promise<PaneInfo[]> {
  try {
    return await Promise.race([
      tauri.listPanes(),
      new Promise<PaneInfo[]>((_, reject) => {
        window.setTimeout(() => reject(new Error('listPanes timeout')), LIST_PANES_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.warn('[loomria] listPanes during close failed; allowing close path', err);
    return [];
  }
}

async function exitAppAfterConfirm(): Promise<void> {
  if (isAppCloseConfirmed()) {
    await tauri.closeCurrentWindow();
    return;
  }
  markAppCloseConfirmed();
  try {
    await tauri.killAllPanes();
  } catch (err) {
    console.warn('[loomria] killAllPanes during close failed', err);
  }
  await tauri.closeCurrentWindow();
}

export function useWindowCloseGuard(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    void tauri
      .onCurrentWindowCloseRequested(async (event: CloseRequestedEvent) => {
        if (isAppCloseConfirmed()) {
          return;
        }

        const panes = await listPanesWithTimeout();
        const agents = panes.filter((p) => isAgentPane(p.agent_type));
        logCloseRequest('user-gesture', agents.length);
        if (agents.length === 0) {
          return;
        }
        event.preventDefault();

        let settled = false;
        const forceCloseTimer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          console.warn('[loomria] close confirmation timed out; forcing window close');
          void exitAppAfterConfirm();
        }, CLOSE_HANDLER_TIMEOUT_MS);

        try {
          const ok = await requestCloseConfirm(agents.length);
          if (settled) return;
          settled = true;
          window.clearTimeout(forceCloseTimer);
          if (ok) {
            await exitAppAfterConfirm();
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            window.clearTimeout(forceCloseTimer);
            console.warn('[loomria] close confirmation failed; forcing window close', err);
            await exitAppAfterConfirm();
          }
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
