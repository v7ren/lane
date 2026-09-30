import { tauri } from '../lib/tauri';
import { TerminalSession } from './terminal-session.js';
import type { PaneDataListener } from './types.js';

export const TERMINAL_PARK_ID = 'loomria-terminal-park';

type RegistryEntry = {
  session: TerminalSession;
  sessionKey: number;
  wrapper: HTMLDivElement;
};

const entries = new Map<string, RegistryEntry>();

export function getTerminalParkElement(): HTMLElement {
  const el = document.getElementById(TERMINAL_PARK_ID);
  if (!el) {
    throw new Error(`Missing #${TERMINAL_PARK_ID} — mount TerminalPark in the shell`);
  }
  return el;
}

export function getTerminalSessionEntry(paneId: string): RegistryEntry | undefined {
  return entries.get(paneId);
}

export function ensureTerminalSession(
  paneId: string,
  sessionKey: number,
  subscribePaneData: (paneId: string, cb: PaneDataListener) => () => void,
): TerminalSession {
  const existing = entries.get(paneId);
  if (existing && existing.sessionKey === sessionKey) {
    return existing.session;
  }
  if (existing) {
    existing.session.dispose();
    existing.wrapper.remove();
    entries.delete(paneId);
  }

  const park = getTerminalParkElement();
  const wrapper = document.createElement('div');
  wrapper.className = 'h-full w-full overflow-hidden terminal-host';
  wrapper.dataset.paneTerminalWrapper = paneId;
  park.appendChild(wrapper);

  const session = new TerminalSession({
    paneId,
    onResize: (cols, rows) => {
      void tauri.resize(paneId, cols, rows);
    },
    onInput: (text, appendNewline = false) => {
      void tauri.writeInput(paneId, text, appendNewline);
    },
  });
  session.mount(wrapper, subscribePaneData);
  entries.set(paneId, { session, sessionKey, wrapper });
  return session;
}

export function reparentTerminalSession(paneId: string, target: HTMLElement | null): void {
  const entry = entries.get(paneId);
  if (!entry) return;
  const dest = target ?? getTerminalParkElement();
  entry.session.reparent(dest);
}

export function disposeTerminalSession(paneId: string): void {
  const entry = entries.get(paneId);
  if (!entry) return;
  entry.session.dispose();
  entry.wrapper.remove();
  entries.delete(paneId);
}

/** @internal test helper */
export function clearTerminalSessionRegistryForTests(): void {
  for (const [paneId] of entries) {
    disposeTerminalSession(paneId);
  }
}
