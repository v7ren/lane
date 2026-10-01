import { useEffect, useState } from 'react';
import { getTerminalSessionEntry } from '../terminal/terminal-session-registry';
import { tauri } from './tauri';

const TRUST_PROMPT = /Yes, I trust this folder/;
const POLL_MS = 500;
const KEY_DOWN = '\x1b[B';
const KEY_ENTER = '\r';

export function isClaudeTrustPrompt(screenText: string): boolean {
  return TRUST_PROMPT.test(screenText);
}

/** True while Claude's "trust this folder" screen is showing in the given terminal pane. */
export function useClaudeTrustPrompt(terminalPaneId: string | undefined): boolean {
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    if (!terminalPaneId) {
      setShowing(false);
      return;
    }
    const check = () => {
      const text = getTerminalSessionEntry(terminalPaneId)?.session.readVisibleText() ?? '';
      setShowing(isClaudeTrustPrompt(text));
    };
    check();
    const timer = window.setInterval(check, POLL_MS);
    return () => window.clearInterval(timer);
  }, [terminalPaneId]);
  return showing;
}

/** Picks "Yes, I trust this folder" (second option) in Claude's trust screen. */
export async function answerClaudeTrustPrompt(terminalPaneId: string): Promise<void> {
  await tauri.writeInput(terminalPaneId, KEY_DOWN, false);
  await tauri.writeInput(terminalPaneId, KEY_ENTER, false);
}
