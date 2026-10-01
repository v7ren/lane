import { useCallback, useEffect, useState } from 'react';
import { sessionAgentInfo } from './agent-session';

export type ClaudeModel = { value: string; displayName: string; description?: string };
export type ClaudeCommand = { name: string; description?: string; argumentHint?: string };

export type ClaudeInfo = {
  models: ClaudeModel[];
  commands: ClaudeCommand[];
  permissionMode: string;
  model: string | null;
  account?: string;
};

/** Modes the GUI offers. bypassPermissions is deliberately not here. */
export const CLAUDE_PERMISSION_MODES: ReadonlyArray<{ id: string; label: string; detail: string }> = [
  { id: 'default', label: 'Ask', detail: 'Ask before edits and commands' },
  { id: 'acceptEdits', label: 'Accept edits', detail: 'Allow file edits, still ask for commands' },
  { id: 'plan', label: 'Plan', detail: 'Read only: plan first, change nothing' },
];

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Reads the reply Claude gives to `initialize`; null while it is missing or unreadable. */
export function parseClaudeInfo(raw: unknown): ClaudeInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const models = Array.isArray(data.models) ? data.models : [];
  const commands = Array.isArray(data.commands) ? data.commands : [];
  const account = data.account as Record<string, unknown> | undefined;
  return {
    models: models
      .map((m) => m as Record<string, unknown>)
      .filter((m) => asString(m.value) !== '')
      .map((m) => ({
        value: asString(m.value),
        displayName: asString(m.displayName) || asString(m.value),
        description: asString(m.description) || undefined,
      })),
    commands: commands
      .map((c) => c as Record<string, unknown>)
      .filter((c) => asString(c.name) !== '')
      .map((c) => ({
        name: asString(c.name),
        description: asString(c.description) || undefined,
        argumentHint: asString(c.argumentHint) || undefined,
      })),
    permissionMode: asString(data.current_permission_mode) || 'default',
    model: asString(data.current_model) || null,
    account: account ? asString(account.subscriptionType) || undefined : undefined,
  };
}

const POLL_MS = 1000;
const MAX_POLLS = 30;

/** Claude answers `initialize` a moment after it starts, so poll until its info is there. */
export function useClaudeInfo(paneId: string, enabled: boolean): {
  info: ClaudeInfo | null;
  update: (patch: Partial<Pick<ClaudeInfo, 'permissionMode' | 'model'>>) => void;
} {
  const [info, setInfo] = useState<ClaudeInfo | null>(null);

  useEffect(() => {
    setInfo(null);
    if (!enabled) return;
    let cancelled = false;
    let polls = 0;
    let timer: number | undefined;
    const poll = async () => {
      polls += 1;
      try {
        const parsed = parseClaudeInfo(await sessionAgentInfo(paneId));
        if (cancelled) return;
        if (parsed) {
          setInfo(parsed);
          return;
        }
      } catch {
        // Not ready yet; try again below.
      }
      if (!cancelled && polls < MAX_POLLS) timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, paneId]);

  const update = useCallback((patch: Partial<Pick<ClaudeInfo, 'permissionMode' | 'model'>>) => {
    setInfo((current) => (current ? { ...current, ...patch } : current));
  }, []);

  return { info, update };
}
